/**
 * The render review, `stories-render-review@1` (S-33; DRAFT until Lucas
 * approves the prompt, plan §8.2). One Haiku 5.5 look at a rendered set's
 * contact sheet. The model answers fixed questions per frame and picks one
 * change from a fixed menu of frame SETTINGS; code applies it and the
 * renderer rebuilds the frame. The model never edits text, HTML or CSS.
 *
 *   round 1   review → apply the changes → re-render; a change that breaks
 *             the renderer's code checks is thrown away and the frame flagged
 *   round 2   one more look; a changed frame still failing goes to Lucas
 *             flagged (no third try). A frame flagged with no fix on the menu
 *             is flagged at once.
 *
 * Modeled on Tommy's lib/social/render/review.ts (not imported).
 *
 * Caching: tools → system are the stable prefix (one breakpoint on the last
 * tool, one on the system block); the contact sheet and the frame list are
 * the per-set suffix. Haiku 5.5 caches prefixes of 512 tokens and up.
 * Thinking stays on at low effort; tool_choice is auto (a forced tool call
 * would skip thinking), and the tool is strict so its input is schema-valid.
 */
import type Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText, withToolCache } from '@/lib/anthropic-cache';
import { priceCall, type CallUsage } from '@/lib/stories/cost';

import { contactSheetJpeg, type RenderResult } from './render';
import { BACKDROPS, GTN_FAMILIES, framePhoto, type Backdrop, type Frame, type GtnFamily } from './types';

export const REVIEW_ID = 'stories-render-review@1';
export const REVIEW_MODEL = 'claude-haiku-5-5';

export const CHANGES = ['none', 'backdrop', 'crop', 'family', 'drop_photo'] as const;
export type Change = (typeof CHANGES)[number];

export const REVIEW_SYSTEM = `You check how a finished Instagram Story set LOOKS before it is posted. You get one contact sheet: every frame of the set, numbered left to right, top to bottom, starting at 1, and a list saying what each frame is. Judge only the look. The words were written and checked already: never judge or ask to change any text, and never judge whether a fact is right.

Two styles exist. "polished" frames follow the Helios brand: clean type, a round orange sun logo, photos that fade into the background colour. "homemade" frames are meant to look typed out in Instagram's own story editor: tilted lines, rounded highlight boxes behind text, hand-drawn pen arrows, emoji and photo stickers are all intended, not mistakes. Text close to the top or bottom edge is checked by code; don't judge it.

For each frame answer these questions:
1. hard_to_read: is any text hard to read (too little contrast, a busy photo behind it, or very small)?
2. clipped: is any text, logo, sticker or arrow cut off, overlapping something, or crammed?
3. bad_photo: is the photo blurry, oddly cropped (a face or the main subject cut off), or plainly out of place?
4. logo_broken: is the Helios logo cut off, covered or distorted? (homemade frames have no logo: answer false)
5. out_of_place: does the frame look like it belongs to a different set than the frames around it?
6. broken: does the frame look broken or empty?

For a frame with any "yes", pick ONE change from this menu, the one most likely to fix it:
- backdrop: put the frame on another background colour (give backdrop: black, white, orange or green)
- crop: move the photo's crop (give crop_x and crop_y, 0 to 1: where the photo's centre of interest should sit; 0.5 0.3 moves a face up)
- family: a Guess the Number frame only: use another layout (give family: photo, marquee or type)
- drop_photo: show the frame without its photo
- none: nothing on the menu helps

List only frames with at least one "yes", with a one-line reason each. If every frame looks right, submit an empty list. Call submit_review exactly once.`;

const obj = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

export const SUBMIT_REVIEW_TOOL = {
  name: 'submit_review',
  description: 'Submit the review of the set. Call it exactly once.',
  strict: true,
  input_schema: obj({
    frames: {
      type: 'array',
      items: obj({
        frame: { type: 'integer', description: '1 = the first frame.' },
        hard_to_read: { type: 'boolean' },
        clipped: { type: 'boolean' },
        bad_photo: { type: 'boolean' },
        logo_broken: { type: 'boolean' },
        out_of_place: { type: 'boolean' },
        broken: { type: 'boolean' },
        change: { type: 'string', enum: [...CHANGES] },
        // Strict tools reject a union type with an enum holding null; anyOf keeps null out of the string enum.
        backdrop: { anyOf: [{ type: 'string', enum: [...BACKDROPS] }, { type: 'null' }] },
        family: { anyOf: [{ type: 'string', enum: [...GTN_FAMILIES] }, { type: 'null' }] },
        crop_x: { type: ['number', 'null'] },
        crop_y: { type: ['number', 'null'] },
        reason: { type: 'string' },
      }),
    },
  }),
} as unknown as Anthropic.Tool;

export type FrameFlag = {
  frame: number;
  hard_to_read: boolean;
  clipped: boolean;
  bad_photo: boolean;
  logo_broken: boolean;
  out_of_place: boolean;
  broken: boolean;
  change: Change;
  backdrop: Backdrop | null;
  family: GtnFamily | null;
  crop_x: number | null;
  crop_y: number | null;
  reason: string;
};

const QUESTIONS = ['hard_to_read', 'clipped', 'bad_photo', 'logo_broken', 'out_of_place', 'broken'] as const;
export const isFlagged = (f: FrameFlag) => QUESTIONS.some((k) => f[k]);
const flagNames = (f: FrameFlag) => QUESTIONS.filter((k) => f[k]).join(', ');

/** What each frame is, as text beside the contact sheet. */
export function frameList(frames: Frame[]): string {
  return frames
    .map((f, i) => {
      const d = f.data;
      const variant = d.role === 'question' || d.role === 'answer' ? `, ${d.family} layout` : '';
      const p = framePhoto(d);
      const photo = p ? (p.kind === 'logo' ? ', a logo' : p.kind === 'person' ? ', photo of a person' : ', scene photo') : ', no photo';
      return `${i + 1}. ${d.role}, ${f.style ?? 'polished'}, ${f.backdrop} background${variant}${photo}`;
    })
    .join('\n');
}

/** The roles a family change applies to together: a question and its answer share a layout. */
const PAIRED = new Set(['question', 'answer']);

/**
 * Apply one menu change to a set: the new frames, or why it doesn't apply.
 * Only settings move (backdrop, crop, layout family, whether the photo shows);
 * `copy` text is never touched.
 */
export function applyChange(frames: Frame[], f: FrameFlag): { frames: Frame[]; note: string } | { frames: null; note: string } {
  const i = f.frame - 1;
  const frame = frames[i];
  if (!frame) return { frames: null, note: `no frame ${f.frame}` };
  const d = frame.data;
  const photo = framePhoto(d);
  const put = (next: Frame) => frames.map((x, j) => (j === i ? next : x));
  switch (f.change) {
    case 'backdrop':
      if (!f.backdrop || !(BACKDROPS as readonly string[]).includes(f.backdrop)) return { frames: null, note: 'backdrop: no colour given' };
      if (f.backdrop === frame.backdrop) return { frames: null, note: `backdrop: already ${f.backdrop}` };
      return { frames: put({ ...frame, backdrop: f.backdrop }), note: `backdrop → ${f.backdrop}` };
    case 'crop': {
      if (!photo || photo.kind === 'logo' || f.crop_x === null || f.crop_y === null) return { frames: null, note: 'crop: no photo or no position' };
      if (d.role === 'paid' || d.role === 'free' || d.role === 'closer' || d.role === 'intro') return { frames: null, note: 'crop: no photo' };
      const clamp = (v: number) => Math.min(1, Math.max(0, v));
      const focus = { x: clamp(f.crop_x), y: clamp(f.crop_y) };
      return { frames: put({ ...frame, data: { ...d, photo: { ...photo, focus } } } as Frame), note: `crop → ${focus.x.toFixed(2)} ${focus.y.toFixed(2)}` };
    }
    case 'family': {
      if (!PAIRED.has(d.role)) return { frames: null, note: 'family: only Guess the Number frames have layouts' };
      if (!f.family || !(GTN_FAMILIES as readonly string[]).includes(f.family)) return { frames: null, note: 'family: no layout given' };
      const family = f.family;
      // The question and its answer change together.
      return {
        frames: frames.map((x) => (x.data.role === 'question' || x.data.role === 'answer' ? ({ ...x, data: { ...x.data, family } } as Frame) : x)),
        note: `layout → ${family} (question and answer)`,
      };
    }
    case 'drop_photo': {
      if (!photo || d.role === 'paid' || d.role === 'free' || d.role === 'closer' || d.role === 'intro') return { frames: null, note: 'drop_photo: no photo to drop' };
      const { photo: _p, ...rest } = d as typeof d & { photo?: unknown };
      void _p;
      return { frames: put({ ...frame, data: rest } as Frame), note: 'photo dropped (type-led frame)' };
    }
    default:
      return { frames: null, note: 'none' };
  }
}

export type ReviewCall = (sheet: Buffer, frames: Frame[]) => Promise<{ flags: FrameFlag[]; usage: CallUsage } | { error: string; usage: CallUsage | null }>;

/** The live review call (Haiku 5.5, the contact sheet as one JPEG). */
export function createReviewCall(deps: { create: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>; model?: string }): ReviewCall {
  const model = deps.model ?? REVIEW_MODEL;
  const tools = [withToolCache(SUBMIT_REVIEW_TOOL)];
  return async (sheet, frames) => {
    let res: Anthropic.Message;
    try {
      res = await deps.create({
        model,
        max_tokens: 4000,
        output_config: { effort: 'low' },
        tools,
        tool_choice: { type: 'auto' },
        system: cachedSystemText(REVIEW_SYSTEM),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: `THIS SET (${frames.length} frames):\n${frameList(frames)}` },
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: sheet.toString('base64') } },
            ],
          },
        ],
      } as unknown as Anthropic.MessageCreateParamsNonStreaming);
    } catch (err) {
      return { error: `review call failed: ${err instanceof Error ? err.message : String(err)}`, usage: null };
    }
    const usage = priceCall(model, res.usage);
    if (res.stop_reason === 'refusal') return { error: 'review refused', usage };
    const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === SUBMIT_REVIEW_TOOL.name);
    const input = block?.input as { frames?: FrameFlag[] } | undefined;
    if (!input || !Array.isArray(input.frames)) return { error: 'no valid review', usage };
    const flags = input.frames.filter((f) => Number.isInteger(f.frame) && f.frame >= 1 && f.frame <= frames.length && (CHANGES as readonly string[]).includes(f.change));
    return { flags, usage };
  };
}

export type Renderer = (frames: Frame[]) => Promise<RenderResult>;

export type FrameReview = {
  /** The first look's answers for this frame (null: nothing flagged). */
  round1: FrameFlag | null;
  /** The change applied, if any. */
  change: string | null;
  round2: FrameFlag | null;
  /** Goes to Lucas flagged (S-33). */
  flagged: boolean;
  note: string | null;
};

export type ReviewOutcome = {
  frames: Frame[];
  render: RenderResult;
  reviews: FrameReview[];
  flagged: boolean;
  calls: CallUsage[];
  log: string[];
};

/** Labels under each frame of the review's contact sheet. */
export const sheetLabels = (frames: Frame[]) => frames.map((f, i) => `${i + 1} · ${f.data.role}`);

export async function sheetFor(render: RenderResult, frames: Frame[]): Promise<Buffer> {
  return contactSheetJpeg(render.frames.map((r) => r.jpeg), { cols: Math.min(frames.length, 7), scale: 0.22, labels: sheetLabels(frames) });
}

/**
 * Review a rendered set (S-33). `first` is the render the build already made;
 * `render` re-renders after changes. Returns the frames to publish, their
 * final render, and which frames go to Lucas flagged.
 */
export async function reviewSet(input: { frames: Frame[]; first: RenderResult; render: Renderer; call: ReviewCall }): Promise<ReviewOutcome> {
  const { call, render } = input;
  const reviews: FrameReview[] = input.frames.map(() => ({ round1: null, change: null, round2: null, flagged: false, note: null }));
  const calls: CallUsage[] = [];
  const log: string[] = [];
  // A frame the code checks already fail never reaches the model: it goes to Lucas.
  input.first.frames.forEach((r, i) => {
    if (r.problems.length) {
      reviews[i]!.flagged = true;
      reviews[i]!.note = `render check: ${r.problems.join('; ')}`;
    }
  });

  const r1 = await call(await sheetFor(input.first, input.frames), input.frames);
  if (r1.usage) calls.push(r1.usage);
  if ('error' in r1) {
    log.push(`render review: ${r1.error} → set flagged for Lucas`);
    return { frames: input.frames, render: input.first, reviews, flagged: true, calls, log };
  }

  let current = input.frames;
  const changed = new Set<number>();
  for (const f of r1.flags.filter(isFlagged)) {
    const rv = reviews[f.frame - 1]!;
    rv.round1 = f;
    const a = applyChange(current, f);
    if (!a.frames) {
      rv.flagged = true;
      rv.note = `${flagNames(f)} (${f.reason}); ${a.note}`;
      log.push(`frame ${f.frame}: ${rv.note} → flagged`);
      continue;
    }
    current = a.frames;
    rv.change = a.note;
    changed.add(f.frame);
    log.push(`frame ${f.frame}: ${flagNames(f)} (${f.reason}) → ${a.note}`);
  }
  if (!changed.size) {
    log.push(`render review: ${r1.flags.filter(isFlagged).length} frame(s) flagged, no change applied`);
    return { frames: current, render: input.first, reviews, flagged: reviews.some((r) => r.flagged), calls, log };
  }

  // Re-render; a change that breaks the code checks is undone and its frame flagged.
  let after = await render(current);
  const broke = after.frames.map((r, i) => (r.problems.length && !input.first.frames[i]!.problems.length ? i : -1)).filter((i) => i >= 0);
  if (broke.length) {
    for (const i of broke) {
      current = current.map((x, j) => (j === i ? input.frames[i]! : x));
      const rv = reviews[i]!;
      rv.flagged = true;
      rv.note = `${rv.change ?? 'change'} broke the render check → undone`;
      changed.delete(i + 1);
      log.push(`frame ${i + 1}: ${rv.note}`);
    }
    after = await render(current);
  }

  // Round 2: a changed frame still failing goes to Lucas.
  if (changed.size) {
    const r2 = await call(await sheetFor(after, current), current);
    if (r2.usage) calls.push(r2.usage);
    if ('error' in r2) {
      log.push(`render review, second look: ${r2.error} → changed frames flagged`);
      for (const n of changed) reviews[n - 1]!.flagged = true;
    } else {
      for (const f of r2.flags.filter((x) => isFlagged(x) && changed.has(x.frame))) {
        const rv = reviews[f.frame - 1]!;
        rv.round2 = f;
        rv.flagged = true;
        rv.note = `still ${flagNames(f)} after ${rv.change} (${f.reason})`;
        log.push(`frame ${f.frame}: ${rv.note} → flagged`);
      }
    }
  }
  log.push(`render review: ${changed.size} change(s), $${calls.reduce((s, c) => s + c.usd, 0).toFixed(5)}`);
  return { frames: current, render: after, reviews, flagged: reviews.some((r) => r.flagged), calls, log };
}
