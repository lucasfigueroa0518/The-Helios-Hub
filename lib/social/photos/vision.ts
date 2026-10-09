/**
 * The stock vision check (spec §5.1 Photo chain v1; part of the stock link,
 * accepted and frozen 2026-10-07). Only stock candidates are checked: after
 * the Jev metadata pre-screen v4 (titles and tags), the top VISION_TOP
 * candidates get one image check each, in order. The first that passes wins;
 * none passing means no stock photo.
 *
 *   classification: AI call · photo vision check (Haiku, PHOTO_VISION_MODEL) · 0 stages · 1 call per checked candidate
 *
 * The prompt asks six questions. A candidate passes (passesVision) on five
 * answers: it shows the requested thing (yes, confidence ≥
 * SHOWS_MIN_CONFIDENCE); no person as a main subject and no recognizable
 * face; no recognizable landmark; no prominent logo outside the story's
 * SUBJECTS; no identifiable signage or named building or institution. The
 * sixth answer (mostly text or a graphic banner) is recorded and not used:
 * it was written for official images, which are off.
 *
 * The prompt was FROZEN with the stock link and reopened (Lucas, 2026-10-08):
 * the STORY line and question 1's "in the sense the STORY means" (homonyms);
 * then the person question split in three (any person visible, a person as
 * main subject, a recognizable face) so the 'faces' mode can let hands pass.
 * Change it only by reopening the link. Known wording issue, left as is for that reason: the prompt first
 * says "Ignore any title or caption you might guess", then that the photo's
 * TITLE is given as context. The intent: judge the pixels; use the given
 * title only to recognize a named place or institution.
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

export const VISION_SYSTEM = `You check one candidate stock photo for a news carousel on Instagram. You get the photo, the STORY it is for (the news in one line), the REQUESTED thing (a plain literal scene), and the story's SUBJECTS (the people and organizations the story is about). Judge only what is visible in the photo. Ignore any title or caption you might guess.

1. Does the photo show the requested thing, literally, in the sense the STORY means, so a reader would see it at a glance? The same words in another sense fail (a medical lab for a computing lab, a concert hall for a lecture hall). Answer yes or no, and your confidence from 0 to 1.
2. Is any person, or part of a person (hands, a silhouette, people in the background), visible?
3. Is a person the main subject of the photo?
4. Is any person's face recognizable?
5. Does it show a recognizable landmark: a famous landmark, capitol, monument or famous skyline a typical reader would recognize by sight? A named but ordinary building, facility or room is not a landmark.
6. Is there a prominent logo a reader would take as part of the story, other than one of the SUBJECTS?
7. Does the photo show identifiable signage or a specific named building or institution (a hospital, school, company site) a reader could take as part of the story?
8. Is the image mostly text or a graphic banner?

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
    person_visible: { type: 'boolean', description: 'Any person or part of one (hands, a silhouette, people in the background).' },
    person_main: { type: 'boolean', description: 'A person is the main subject.' },
    face_recognizable: { type: 'boolean', description: "Any person's face is recognizable." },
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
  /** Any person visible, a person as main subject, or a recognizable face (kept for the saved traces and the bench replay). */
  person_prominent: boolean;
  /** 2026-10-08 (the photo experiment): the three person answers apart, so a mode can allow hands but not faces. Absent in older traces. */
  person_visible?: boolean;
  person_main?: boolean;
  face_recognizable?: boolean;
  landmark_visible: boolean;
  story_logo: boolean;
  logo_seen: string | null;
  named_institution: boolean;
  mostly_text_banner: boolean;
};

export type VisionResult = { ok: true; verdict: VisionVerdict; pass: boolean; costUsd: number } | { ok: false; error: string; costUsd: number };

/**
 * `title`: the candidate's title, as context (it can name the institution shown). `story`: the news in one
 * line, so the requested thing is judged in the story's sense (2026-10-08, homonyms).
 */
export type VisionCheck = (input: { url: string; scene: string; subjects: string[]; title?: string; story?: string }) => Promise<VisionResult>;

/**
 * Pass: shows the thing (with confidence), no landmark, no outside logo, no named institution, and on people:
 * 'strict' fails any person at all; 'faces' fails only a person as the main subject or a recognizable face
 * (hands on a keyboard, people far in the background pass). Older verdicts have only person_prominent.
 */
export function passesVision(v: VisionVerdict, mode: 'strict' | 'faces' = 'strict'): boolean {
  const people = v.person_main === undefined ? v.person_prominent : mode === 'strict' ? v.person_prominent : Boolean(v.person_main || v.face_recognizable);
  return v.shows_requested && v.shows_requested_confidence >= SHOWS_MIN_CONFIDENCE && !people && !v.landmark_visible && !v.story_logo && !v.named_institution;
}

export function describeVerdict(v: VisionVerdict): string {
  const who = v.person_main === undefined ? '' : ` (visible ${v.person_visible ? 'yes' : 'no'}, main ${v.person_main ? 'yes' : 'no'}, face ${v.face_recognizable ? 'yes' : 'no'})`;
  return `shows ${v.shows_requested ? 'yes' : 'no'} ${v.shows_requested_confidence.toFixed(2)} · person (main/face) ${v.person_prominent ? 'yes' : 'no'}${who} · landmark ${v.landmark_visible ? 'yes' : 'no'} · story logo ${v.story_logo ? `yes${v.logo_seen ? ` (${v.logo_seen})` : ''}` : 'no'} · named institution ${v.named_institution ? 'yes' : 'no'} · banner ${v.mostly_text_banner ? 'yes' : 'no'} · "${v.what_it_shows}"`;
}

function isVerdict(x: unknown): x is VisionVerdict {
  const v = x as VisionVerdict;
  return !!v && typeof v.what_it_shows === 'string' && typeof v.shows_requested === 'boolean' && typeof v.shows_requested_confidence === 'number'
    && typeof v.person_visible === 'boolean' && typeof v.person_main === 'boolean' && typeof v.face_recognizable === 'boolean' && typeof v.landmark_visible === 'boolean' && typeof v.story_logo === 'boolean' && typeof v.named_institution === 'boolean' && typeof v.mostly_text_banner === 'boolean';
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
  return async ({ url, scene, subjects, title, story }) => {
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
            { type: 'text', text: `STORY: ${story?.trim() || '(none)'}\nREQUESTED: ${scene}\nSUBJECTS: ${subjects.length ? subjects.join('; ') : '(none)'}\nTITLE: ${title?.trim() || '(none)'}` },
          ],
        }],
      } as Anthropic.MessageCreateParamsNonStreaming);
    } catch (err) {
      return { ok: false, error: `vision call failed: ${err instanceof Error ? err.message : String(err)}`, costUsd: 0 };
    }
    const costUsd = Number(priceAnthropicMessages([res as unknown as MessageUsageLike], { modelId: model }).costUsd);
    const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === SUBMIT_VERDICT_TOOL.name);
    if (!block || !isVerdict(block.input)) return { ok: false, error: 'no valid verdict', costUsd };
    const verdict = { ...block.input, person_prominent: Boolean(block.input.person_visible || block.input.person_main || block.input.face_recognizable) };
    return { ok: true, verdict, pass: passesVision(verdict), costUsd };
  };
}
