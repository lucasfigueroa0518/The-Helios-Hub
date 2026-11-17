/**
 * The Jev vision screen (roa-screen@4; R4, RA-3, RA-6, RA-17, RA-22, RA-23, RA-28). First a code check, then up to four calls
 * per image, each with the image and the experimental images header:
 *
 *   light   code, no call: an image too dark to read on a phone outdoors is rejected (`too_dark`)
 *   glance  blind: reject an AI image with a tell visible in a 3-second look; reject any image with an identifiable
 *           person, a brand or readable text, with no clear subject, or that is off-putting to look at;
 *           difficulty = the chance a viewer guesses wrong
 *   subject images that passed: where the subject is (model jev-preview), so the slide text keeps off it (layout.ts);
 *           no answer leaves it to the pixel read
 *   close   AI images that passed: is there a subtle tell on close inspection
 *   box     when there is: where (model jev-preview, the only model that answers `box`)
 *
 * Stories' own Jev log and cost rows (component `roa-screen`). The transport is
 * Real or AI?'s own (it needs images, a model override and the header, which
 * lib/stories/jev.ts does not carry); tests pass a stub.
 */
import { TypeSafeClient, image, type Questions, type RequestOptions, type SystemOneRequest, type SystemOneResult } from '@typesafe-ai/sdk';

import sharp from 'sharp';

import { JEV_MODEL } from '@/lib/reels/config';
import { jevUsd } from '@/lib/reels/jev/runner';
import type { StoriesDb } from '@/lib/stories/db';
import { recordCost, recordJevLog } from '@/lib/stories/repository';

import { CLOSE_CONTEXT, GLANCE_CONTEXT, GLANCE_KEYS, ROA_SCREEN } from './questions';
import { toJpeg } from './generate';
import type { RoaScreen, TellBox, Truth } from './types';

/** The long side of the copy Jev sees (2026-11-15 probe: 1024 accepted, 2048 rejected). */
export const SCREEN_MAX_SIDE = 1024;

export const ROA_IMAGES_HEADER = { 'TypeSafe-Danger-Zone-Images': 'true' } as const;
export const JEV_PREVIEW = 'jev-preview';
/**
 * Light (RA-22, Lucas 2026-11-16: dark images read as a black screen on a phone outdoors). Measured on a 64×64
 * greyscale copy, 0–255: the mean, and the share of pixels darker than DARK_PIXEL. Calibrated on the first 15-day lab
 * deck: the three images Lucas named as too dark measured 21–35, the black-sky galaxy shots 31–56.
 */
export const MIN_MEAN_LUMA = 70;
export const DARK_PIXEL = 50;
export const MAX_DARK_SHARE = 0.5;

export type Light = { mean: number; darkShare: number };

export async function lightOf(jpeg: Buffer): Promise<Light> {
  const data = await sharp(jpeg).resize(64, 64, { fit: 'fill' }).greyscale().raw().toBuffer();
  let sum = 0;
  let dark = 0;
  for (const v of data) {
    sum += v;
    if (v < DARK_PIXEL) dark++;
  }
  return { mean: Number((sum / data.length).toFixed(1)), darkShare: Number((dark / data.length).toFixed(3)) };
}

export const tooDark = (l: Light) => l.mean < MIN_MEAN_LUMA || l.darkShare > MAX_DARK_SHARE;

/** A noul at or above this is a yes. */
export const REJECT_AT = 0.5;
/**
 * The 3-second tell rejects an AI image only at or above this (RA-22). Jev answers glance_tell 0.43–0.72 for almost
 * every AI image while judging most viewers would still guess real (looks_ai 0.20–0.44, 2026-11-16 over 23 images):
 * at 0.5 it threw away the hardest AI rounds and left the sets mostly real.
 */
export const VISIBLE_TELL_AT = 0.7;
/** A subtle tell at or above this is boxed. */
export const SUBTLE_AT = 0.6;
/** A box narrower or shorter than this (fraction of the image) is no box. */
export const MIN_BOX = 0.02;

export interface RoaVisionTransport {
  systemOne<const Q extends Questions>(req: SystemOneRequest<Q>, options?: RequestOptions): Promise<SystemOneResult<Q>>;
}

let client: TypeSafeClient | null = null;

/** The live transport: images header on every call, the jev-latest alias by default (D-021), a longer timeout for images. */
export const liveRoaVisionTransport: RoaVisionTransport = {
  systemOne(req, options) {
    if (!client) {
      if (!process.env.TYPESAFE_API_KEY) throw new Error('TYPESAFE_API_KEY is not set; Jev calls cannot run.');
      client = new TypeSafeClient({ defaultModel: JEV_MODEL, defaultHeaders: { ...ROA_IMAGES_HEADER }, timeout: 60_000 });
    }
    return client.systemOne(req, { ...options, headers: { ...ROA_IMAGES_HEADER, ...(options?.headers ?? {}) } });
  },
};

export type ScreenDeps = { db: StoriesDb; vision: RoaVisionTransport; setId?: string | null };
export type ScreenResult = RoaScreen & { answers: Record<string, number>; calls: number };

const pick = <K extends keyof typeof ROA_SCREEN.questions>(keys: readonly K[]) =>
  Object.fromEntries(keys.map((k) => [k, ROA_SCREEN.questions[k]])) as Pick<typeof ROA_SCREEN.questions, K>;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const noulOf = (a: unknown): number => {
  const v = (a as { noul?: unknown } | undefined)?.noul;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('roa-screen: missing noul answer');
  return clamp01(v);
};

/** Jev's box (edges) as the reveal's TellBox (origin and size); null when degenerate. */
export function toTellBox(b: { top?: unknown; bottom?: unknown; left?: unknown; right?: unknown } | null | undefined): TellBox | null {
  if (!b) return null;
  const [top, bottom, left, right] = [b.top, b.bottom, b.left, b.right].map((v) => (typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : Number.NaN));
  if ([top, bottom, left, right].some((v) => Number.isNaN(v))) return null;
  const box = { x: Math.min(left!, right!), y: Math.min(top!, bottom!), w: Math.abs(right! - left!), h: Math.abs(bottom! - top!) };
  return box.w < MIN_BOX || box.h < MIN_BOX ? null : box;
}

async function ask<const Q extends Questions>(deps: ScreenDeps, call: string, imageKey: string, req: SystemOneRequest<Q>): Promise<SystemOneResult<Q>> {
  const res = await deps.vision.systemOne(req, { headers: { ...ROA_IMAGES_HEADER } });
  const inputTokens = Number(res.usage?.input_tokens ?? 0) || 0;
  // The log keeps the image key, not the bytes.
  await recordJevLog(deps.db, { setId: deps.setId ?? null, component: 'roa-screen', questionSetId: ROA_SCREEN.id, questionSetVersion: ROA_SCREEN.version, resolvedModel: res.model, state: { call, imageKey }, answers: res.answers, inputTokens });
  await recordCost(deps.db, { setId: deps.setId ?? null, vendor: 'jev', component: 'roa-screen', inputTokens, outputTokens: Number(res.usage?.output_tokens ?? 0) || 0, usd: jevUsd(inputTokens) });
  return res;
}

/** Screen one candidate image. Throws only when Jev cannot answer (the caller records it). */
export async function screenImage(deps: ScreenDeps, item: { jpeg: Buffer; imageKey: string; truth: Truth }): Promise<ScreenResult> {
  // Light first: a dark image never reaches Jev.
  const light = await lightOf(item.jpeg);
  if (tooDark(light)) return { pass: false, reasons: ['too_dark'], difficulty: 0, answers: { light_mean: light.mean, light_dark_share: light.darkShare }, calls: 0 };
  // Jev rejects large images ("Invalid image dimensions" at 1152×2048, fine at 1024): screen a 1024 copy.
  const photo = image(await toJpeg(item.jpeg, SCREEN_MAX_SIDE));
  let calls = 1;
  const glance = await ask(deps, 'glance', item.imageKey, { state: { context: GLANCE_CONTEXT, image: photo }, questions: pick(GLANCE_KEYS) });
  const answers: Record<string, number> = {};
  for (const k of GLANCE_KEYS) answers[k] = noulOf(glance.answers[k]);

  const reasons: string[] = [];
  if (item.truth === 'ai' && answers.glance_tell! >= VISIBLE_TELL_AT) reasons.push('visible_tell');
  for (const k of ['real_person', 'brand', 'readable_text', 'off_putting'] as const) if (answers[k]! >= REJECT_AT) reasons.push(k);
  if (answers.clear_subject! < REJECT_AT) reasons.push('no_clear_subject');
  const difficulty = Number((item.truth === 'real' ? answers.looks_ai! : 1 - answers.looks_ai!).toFixed(4));
  if (reasons.length) return { pass: false, reasons, difficulty, answers, calls };

  // Where the subject is (RA-28).
  calls++;
  let subjectBox: TellBox | null = null;
  try {
    const sub = await ask(deps, 'subject', item.imageKey, { state: { context: GLANCE_CONTEXT, image: photo }, questions: pick(['subject_box'] as const), model: JEV_PREVIEW });
    subjectBox = toTellBox(sub.answers.subject_box?.box);
  } catch {
    // No box: layout.ts reads the subject from the pixels.
  }
  const found = subjectBox ? { subjectBox } : {};
  if (item.truth !== 'ai') return { pass: true, reasons, difficulty, ...found, answers, calls };

  // AI images that passed: a subtle tell on close inspection, boxed (RA-17).
  calls++;
  const close = await ask(deps, 'close', item.imageKey, { state: { context: CLOSE_CONTEXT, image: photo }, questions: pick(['subtle_tell'] as const) });
  answers.subtle_tell = noulOf(close.answers.subtle_tell);
  if (answers.subtle_tell < SUBTLE_AT) return { pass: true, reasons, difficulty, ...found, answers, calls };
  calls++;
  let tellBox: TellBox | null = null;
  try {
    const boxed = await ask(deps, 'box', item.imageKey, { state: { context: CLOSE_CONTEXT, image: photo }, questions: pick(['tell_box'] as const), model: JEV_PREVIEW });
    tellBox = toTellBox(boxed.answers.tell_box?.box);
  } catch {
    // No box: the reveal falls back to the prompt or a tell named in words.
  }
  return { pass: true, reasons, difficulty, ...found, ...(tellBox ? { tellBox } : {}), answers, calls };
}
