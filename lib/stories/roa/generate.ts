/**
 * Real or AI? image helpers: our AI images (gpt-image-2 portrait through
 * lib/reels/visual/image.ts, RA-2), the JPEG every candidate is stored as, and
 * the image key (sha1 of those bytes, first 16 hex: the same image never
 * enters twice).
 *
 * Tests pass a stub generator; nothing here runs offline against the API.
 */
import { createHash } from 'node:crypto';

import sharp from 'sharp';

import { VISUAL_IMAGE_MODEL } from '@/lib/reels/config';
import { generateBackground } from '@/lib/reels/visual/image';
import type { StoriesDb } from '@/lib/stories/db';
import { recordCost, type CostEvent } from '@/lib/stories/repository';

import type { Provenance } from './types';

/** Stored candidates: long side at most this, JPEG at this quality, metadata stripped. */
export const STORE_MAX_SIDE = 2048;
export const STORE_JPEG_QUALITY = 90;

export type RoaImageGen = (prompt: string) => Promise<{ png: Buffer; usage: { usd: number } }>;

/** The live generator: gpt-image-2, 1152×2048 portrait. */
export const liveImageGen: RoaImageGen = (prompt) => generateBackground(prompt);

/** Any PNG or JPEG as the stored JPEG: rotated upright, long side ≤ maxSide, no metadata. */
export async function toJpeg(bytes: Buffer, maxSide = STORE_MAX_SIDE, quality = STORE_JPEG_QUALITY): Promise<Buffer> {
  return sharp(bytes).rotate().resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer();
}

/**
 * A real photo as the Story shows it (RA-23): cut to the 9:16 phone frame around its most salient region (sharp's
 * attention strategy), never enlarged, so the subject is centred and the viewer, Jev and the lab all see the same
 * frame. AI images are made at 9:16 and need no cut. Null when the photo is wider than MAX_WIDE: too little of it
 * would survive.
 */
export const FRAME_W = 9;
export const FRAME_H = 16;
export const MAX_WIDE = 16 / 9;

export async function toStoryFrame(bytes: Buffer, maxSide = STORE_MAX_SIDE, quality = STORE_JPEG_QUALITY): Promise<Buffer | null> {
  const upright = await sharp(bytes).rotate().toBuffer();
  const { width = 0, height = 0 } = await sharp(upright).metadata();
  if (!width || !height || width / height > MAX_WIDE) return null;
  const tall = width / height < FRAME_W / FRAME_H;
  const h = tall ? Math.round(Math.min(width, Math.round((maxSide * FRAME_W) / FRAME_H)) * (FRAME_H / FRAME_W)) : Math.min(height, maxSide);
  const w = Math.round((h * FRAME_W) / FRAME_H);
  return sharp(upright)
    .resize({ width: w, height: h, fit: 'cover', position: sharp.strategy.attention })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}

export const imageKeyOf = (bytes: Buffer) => createHash('sha1').update(bytes).digest('hex').slice(0, 16);

export type MadeImage = { jpeg: Buffer; imageKey: string; provenance: Extract<Provenance, { kind: 'generated' }>; usd: number };

/**
 * Generate one AI image from the writer's prompt. The provenance keeps the exact prompt sent (shown on the reveal when
 * there is no tell to circle, RA-17). The cost row is component `roa-image`; see recordImageCost.
 */
export async function generateAiImage(deps: { db: StoriesDb; image: RoaImageGen; now: Date }, prompt: string): Promise<MadeImage & { costNote?: string }> {
  const { png, usage } = await deps.image(prompt);
  const jpeg = await toJpeg(png);
  const costNote = await recordImageCost(deps.db, usage.usd);
  return {
    jpeg,
    imageKey: imageKeyOf(jpeg),
    provenance: { kind: 'generated', model: VISUAL_IMAGE_MODEL, prompt, createdAt: deps.now.toISOString() },
    usd: usage.usd,
    ...(costNote ? { costNote } : {}),
  };
}

/**
 * The image's cost row (vendor `openai`, component `roa-image`). stories.cost_events allows only anthropic, jev and
 * web_search today, so until the schema adds `openai` the insert fails; the failure is returned as a note (the daily
 * record keeps the dollars either way) and never fails the run.
 */
export async function recordImageCost(db: StoriesDb, usd: number): Promise<string | undefined> {
  try {
    await recordCost(db, { setId: null, vendor: 'openai' as CostEvent['vendor'], component: 'roa-image', model: VISUAL_IMAGE_MODEL, usd });
    return undefined;
  } catch (err) {
    return `roa-image cost row not written: ${err instanceof Error ? err.message : String(err)}`;
  }
}
