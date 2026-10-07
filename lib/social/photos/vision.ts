/**
 * Photo vision check (Tommy, 2026-10-06, after the photo-finder bench: the
 * metadata pre-screen reads titles and tags, not pixels, so it passed
 * "Price Tags on Wood" (cork) and a museum of stuffed deer).
 *
 *   classification: new AI call · photo vision check · 0 new stages · +1 AI call per checked candidate
 *
 * After the Jev metadata pre-screen, the top VISION_TOP passing stock
 * candidates get one image check each, in order. Four questions about the
 * pixels: shows the requested thing (yes/no + confidence), any person
 * visible, any recognizable landmark, any visible logo or brand outside the
 * story's SUBJECTS. The first candidate passing all four wins; none passing
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
2. Is any person visible: a face, a body, hands, or a silhouette?
3. Does it show a recognizable landmark: a famous landmark, capitol, monument or famous skyline a typical reader would recognize by sight? A named but ordinary building, facility or room is not a landmark.
4. Is any logo or brand visible that is not among the SUBJECTS?

Call submit_verdict with your answers and one short line saying what the photo shows.`;

const obj = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

export const SUBMIT_VERDICT_TOOL = {
  name: 'submit_verdict',
  description: 'Submit the photo check. Call it once.',
  input_schema: obj({
    what_it_shows: { type: 'string', description: 'One short line: what the photo shows.' },
    shows_requested: { type: 'boolean' },
    shows_requested_confidence: { type: 'number', description: '0 to 1.' },
    person_visible: { type: 'boolean' },
    landmark_visible: { type: 'boolean' },
    outside_brand_visible: { type: 'boolean' },
    brand_seen: { type: ['string', 'null'], description: 'The logo or brand seen, if any.' },
  }),
} as unknown as Anthropic.Tool;

export type VisionVerdict = {
  what_it_shows: string;
  shows_requested: boolean;
  shows_requested_confidence: number;
  person_visible: boolean;
  landmark_visible: boolean;
  outside_brand_visible: boolean;
  brand_seen: string | null;
};

export type VisionResult = { ok: true; verdict: VisionVerdict; pass: boolean; costUsd: number } | { ok: false; error: string; costUsd: number };

export type VisionCheck = (input: { url: string; scene: string; subjects: string[] }) => Promise<VisionResult>;

/** All four must pass. */
export function passesVision(v: VisionVerdict): boolean {
  return v.shows_requested && v.shows_requested_confidence >= SHOWS_MIN_CONFIDENCE && !v.person_visible && !v.landmark_visible && !v.outside_brand_visible;
}

export function describeVerdict(v: VisionVerdict): string {
  return `shows ${v.shows_requested ? 'yes' : 'no'} ${v.shows_requested_confidence.toFixed(2)} · person ${v.person_visible ? 'yes' : 'no'} · landmark ${v.landmark_visible ? 'yes' : 'no'} · outside brand ${v.outside_brand_visible ? `yes${v.brand_seen ? ` (${v.brand_seen})` : ''}` : 'no'} · "${v.what_it_shows}"`;
}

function isVerdict(x: unknown): x is VisionVerdict {
  const v = x as VisionVerdict;
  return !!v && typeof v.what_it_shows === 'string' && typeof v.shows_requested === 'boolean' && typeof v.shows_requested_confidence === 'number'
    && typeof v.person_visible === 'boolean' && typeof v.landmark_visible === 'boolean' && typeof v.outside_brand_visible === 'boolean';
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
  return async ({ url, scene, subjects }) => {
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
            { type: 'text', text: `REQUESTED: ${scene}\nSUBJECTS: ${subjects.length ? subjects.join('; ') : '(none)'}` },
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
