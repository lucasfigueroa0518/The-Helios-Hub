/**
 * Photo vision check (Tommy, 2026-10-06, after the photo-finder bench: the
 * metadata pre-screen reads titles and tags, not pixels, so it passed
 * "Price Tags on Wood" (cork) and a museum of stuffed deer).
 *
 *   classification: new AI call · photo vision check · 0 new stages · +1 AI call per checked candidate
 *
 * After the Jev metadata pre-screen, the top VISION_TOP passing stock
 * candidates get one image check each, in order. Four questions about the
 * pixels: shows the requested thing (yes/no + confidence), a person as a
 * main subject or a recognizable face, any recognizable landmark, a
 * prominent logo a reader would take as part of the story (outside the
 * story's SUBJECTS), and (Tommy, 2026-10-07, after the PREVIEW run's
 * "CJ Harris Regional Hospital") identifiable signage or a specific named
 * building or institution. The candidate's title is passed as context.
 * Sixth question (Tommy, 2026-10-07, official images): mostly text or a
 * graphic banner → an official image is rejected. Stock ignores it (a photo
 * of code on a screen answered "banner yes" on the bench).
 * Definitions narrowed by Tommy, 2026-10-06, after the bench (camera dials
 * failed on an unidentified maker). The first candidate passing all four wins; none passing
 * means no stock photo.
 *
 * Model: PHOTO_VISION_MODEL (its own setting). The photo is downscaled to
 * VISION_LONG_SIDE px before sending. Caching: tool → system marked (static);
 * the image and request are the per-call suffix. (The static prefix is
 * shorter than the model's minimum cacheable length, so it may not cache.)
 */
import type Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText, withToolCache } from '@/lib/anthropic-cache';
import { priceAnthropicMessages, type MessageUsageLike } from '@/lib/anthropic-pricing';
import { PHOTO_VISION_MODEL } from '@/lib/social/pipeline/models';
import type { MessagesCreate } from '@/lib/social/reporter/reporter';

/** Candidates checked per stock request, after the metadata pre-screen. */
export const VISION_TOP = 3;
/** At or above this, "shows the requested thing" counts. Provisional. */
export const SHOWS_MIN_CONFIDENCE = 0.7;
const VISION_LONG_SIDE = 768;

export const VISION_SYSTEM = `You check one candidate stock photo for a news carousel on Instagram. You get the photo, the REQUESTED thing (a plain literal scene), and the story's SUBJECTS (the people and organizations the story is about). Judge only what is visible in the photo. Ignore any title or caption you might guess.

1. Does the photo show the requested thing, literally, so a reader would see it at a glance? Answer yes or no, and your confidence from 0 to 1.
2. Is a person a main subject of the photo, or is any face recognizable?
3. Does it show a recognizable landmark: a famous landmark, capitol, monument or famous skyline a typical reader would recognize by sight? A named but ordinary building, facility or room is not a landmark.
4. Is there a prominent logo a reader would take as part of the story, other than one of the SUBJECTS?
5. Does the photo show identifiable signage or a specific named building or institution (a hospital, school, company site) a reader could take as part of the story?
6. Is the image mostly text or a graphic banner?

The photo's TITLE is given as context: it can name the place or institution shown.

Call submit_verdict with your answers and one short line saying what the photo shows.`;

const obj = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

export const SUBMIT_VERDICT_TOOL = {
  name: 'submit_verdict',
  description: 'Submit the photo check. Call it once.',
  input_schema: obj({
    what_it_shows: { type: 'string', description: 'One short line: what the photo shows.' },
    shows_requested: { type: 'boolean' },
    shows_requested_confidence: { type: 'number', description: '0 to 1.' },
    person_prominent: { type: 'boolean' },
    landmark_visible: { type: 'boolean' },
    story_logo: { type: 'boolean' },
    named_institution: { type: 'boolean', description: 'Identifiable signage or a specific named building or institution a reader could take as part of the story.' },
    mostly_text_banner: { type: 'boolean', description: 'The image is mostly text or a graphic banner.' },
    logo_seen: { type: ['string', 'null'], description: 'The prominent logo seen, if any.' },
  }),
} as unknown as Anthropic.Tool;

export type VisionVerdict = {
  what_it_shows: string;
  shows_requested: boolean;
  shows_requested_confidence: number;
  person_prominent: boolean;
  landmark_visible: boolean;
  story_logo: boolean;
  logo_seen: string | null;
  named_institution: boolean;
  mostly_text_banner: boolean;
};

export type VisionResult = { ok: true; verdict: VisionVerdict; pass: boolean; costUsd: number } | { ok: false; error: string; costUsd: number };

/** `title`: the candidate's title, as context (it can name the institution shown). */
export type VisionCheck = (input: { url: string; scene: string; subjects: string[]; title?: string }) => Promise<VisionResult>;

/** All four must pass. */
export function passesVision(v: VisionVerdict): boolean {
  return v.shows_requested && v.shows_requested_confidence >= SHOWS_MIN_CONFIDENCE && !v.person_prominent && !v.landmark_visible && !v.story_logo && !v.named_institution;
}

/**
 * Official images (spec §5.1 (a)): the company's own image, so its logo, site
 * and signage are the story's own (questions 3–5 don't apply). Rejected: a
 * banner (mostly text) and a prominent person the caption doesn't name as a
 * SUBJECTS person (identity comes from the company's caption, never a face).
 */
export function passesOfficialVision(v: VisionVerdict, captionNamesSubjectPerson: boolean): boolean {
  return !v.mostly_text_banner && (!v.person_prominent || captionNamesSubjectPerson);
}

export function describeVerdict(v: VisionVerdict): string {
  return `shows ${v.shows_requested ? 'yes' : 'no'} ${v.shows_requested_confidence.toFixed(2)} · person (main/face) ${v.person_prominent ? 'yes' : 'no'} · landmark ${v.landmark_visible ? 'yes' : 'no'} · story logo ${v.story_logo ? `yes${v.logo_seen ? ` (${v.logo_seen})` : ''}` : 'no'} · named institution ${v.named_institution ? 'yes' : 'no'} · banner ${v.mostly_text_banner ? 'yes' : 'no'} · "${v.what_it_shows}"`;
}

function isVerdict(x: unknown): x is VisionVerdict {
  const v = x as VisionVerdict;
  return !!v && typeof v.what_it_shows === 'string' && typeof v.shows_requested === 'boolean' && typeof v.shows_requested_confidence === 'number'
    && typeof v.person_prominent === 'boolean' && typeof v.landmark_visible === 'boolean' && typeof v.story_logo === 'boolean' && typeof v.named_institution === 'boolean' && typeof v.mostly_text_banner === 'boolean';
}

/** The photo, downscaled, as base64 JPEG. */
async function loadImage(url: string, http: typeof fetch): Promise<string> {
  const res = await http(url, { headers: { 'user-agent': 'HeliosSocial/1.0 (photo vision check)' } });
  if (!res.ok) throw new Error(`photo fetch ${res.status}`);
  const sharp = (await import('sharp')).default;
  const buf = await sharp(Buffer.from(await res.arrayBuffer())).rotate().resize(VISION_LONG_SIDE, VISION_LONG_SIDE, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  return buf.toString('base64');
}

export function createVisionCheck(deps: { create: MessagesCreate; http?: typeof fetch; model?: string }): VisionCheck {
  const model = deps.model ?? PHOTO_VISION_MODEL.model;
  const tools = [withToolCache(SUBMIT_VERDICT_TOOL)];
  return async ({ url, scene, subjects, title }) => {
    let data: string;
    try {
      data = await loadImage(url, deps.http ?? fetch);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), costUsd: 0 };
    }
    let res: Anthropic.Message;
    try {
      res = await deps.create({
        model,
        max_tokens: 400,
        system: cachedSystemText(VISION_SYSTEM),
        tools,
        tool_choice: { type: 'tool', name: SUBMIT_VERDICT_TOOL.name },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
            { type: 'text', text: `REQUESTED: ${scene}\nSUBJECTS: ${subjects.length ? subjects.join('; ') : '(none)'}\nTITLE: ${title?.trim() || '(none)'}` },
          ],
        }],
      } as Anthropic.MessageCreateParamsNonStreaming);
    } catch (err) {
      return { ok: false, error: `vision call failed: ${err instanceof Error ? err.message : String(err)}`, costUsd: 0 };
    }
    const costUsd = Number(priceAnthropicMessages([res as unknown as MessageUsageLike], { modelId: model }).costUsd);
    const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === SUBMIT_VERDICT_TOOL.name);
    if (!block || !isVerdict(block.input)) return { ok: false, error: 'no valid verdict', costUsd };
    return { ok: true, verdict: block.input, pass: passesVision(block.input), costUsd };
  };
}
