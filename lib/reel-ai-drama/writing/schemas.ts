import { FOCUS_KINDS } from '@/lib/reel-ai-drama/types';
import type { SubmitTool } from '@/lib/reel-ai-drama/writing/llm';

/** Strict submit tools whose schemas match lib/reel-ai-drama/types.ts. Stable: they sit in the cached prefix. */

const str = { type: 'string' } as const;
const nullableStr = { type: ['string', 'null'] } as const;
const strList = { type: 'array', items: str } as const;

function obj(properties: Record<string, unknown>) {
  return { type: 'object', additionalProperties: false, required: Object.keys(properties), properties } as const;
}

/** The kit's frame treatments (CONTRACT.md § B4). */
export const TREATMENTS = [
  'photo',
  'cutout_lift',
  'collision',
  'page',
  'map',
  'document',
  'post',
  'headline',
  'lower_third',
  'number',
  'board',
  'whiteboard',
  'newspaper',
  'tableau',
  'collage',
  'stat',
  'lift',
  'close',
] as const;
export type Treatment = (typeof TREATMENTS)[number];

/**
 * Treatments that show a found or made asset, so a frame using one must name it. `lower_third` and
 * `number` are overlays: they render over the frame's first asset (kit/FRAME.md), so they need one too.
 * `lift` lifts a person or picture off an artifact asset, the original left visible; `stat` (an animated
 * counter, bar or scale comparison) is code-built and needs none.
 */
export const ASSET_TREATMENTS: readonly Treatment[] = ['photo', 'cutout_lift', 'collision', 'page', 'post', 'document', 'headline', 'lower_third', 'number', 'tableau', 'collage', 'lift'];

/** The only treatments a person's banked character image may appear in (MD-41: it represents them, staged or lifted). */
export const CHARACTER_TREATMENTS: readonly Treatment[] = ['cutout_lift', 'collision', 'tableau', 'collage', 'lift'];

/** What the director may ask to be made (MD-59): drawn, traced or code-built, never photoreal. */
export const MAKE_KINDS = ['setting', 'expression', 'collage', 'drawing'] as const;

export const MUSIC_CUES = ['start', 'change', 'drop', 'hold', 'end'] as const;

const nullableNum = { type: ['number', 'null'] } as const;

/** What a wish asks for (MD-135, MD-139): the search's want kind and route. */
export const WISH_AS = ['photo', 'logo', 'product', 'object', 'place'] as const;

/** One picture beat of a frame (types.ts `FrameShot`, MD-136). */
const FRAME_SHOT = obj({ at: str, shows: str, asset_ids: strList, introduces: nullableStr });

/** How the voice says names it would get wrong; captions keep the spelling. */
const PRONOUNCE = { type: 'array', items: obj({ word: str, say: str }) } as const;

/** A label's kind (MD-130): 'date' for a date label (`L1`'s always is), else null. */
const ON_SCREEN_KIND = { anyOf: [{ type: 'string', enum: ['date'] }, { type: 'null' }] } as const;

const SCRIPT_LINE = obj({ id: str, text: str, on_screen: nullableStr, on_screen_kind: ON_SCREEN_KIND, fact_ids: strList, must_show: nullableStr, pause_after: nullableNum });

/** A rung: `purpose` says what it does in the story. */
const RUNG = obj({ id: str, purpose: str, lines: { type: 'array', items: SCRIPT_LINE } });

/** The writer's script (types.ts `WriterDraft`, iteration 5): `central` names who gets cutouts (MD-100). */
export const SUBMIT_SCRIPT_TOOL: SubmitTool = {
  name: 'submit_script',
  description: 'Submit the finished script, once, at the end.',
  strict: false,
  input_schema: obj({
    title: str,
    hook: obj({ on_screen: str, line_id: str }),
    rungs: { type: 'array', items: RUNG },
    peak_rung_id: str,
    landing_rung_id: str,
    close_question: str,
    central: strList,
    pronounce: PRONOUNCE,
  }),
};

/** The most notes the blind story editor sends (story-editor.md: the ones that matter most). */
export const MAX_STORY_NOTES = 5;

/** The blind story editor's notes (types.ts `StoryNotes`, MD-102): a retelling and notes on named lines. */
export const SUBMIT_STORY_NOTES_TOOL: SubmitTool = {
  name: 'submit_story_notes',
  description: 'Submit your retelling and your notes (at most five, the most important first), once.',
  strict: false,
  input_schema: obj({
    tell_back: str,
    notes: { type: 'array', items: obj({ lines: strList, note: str }) },
  }),
};

export const SUBMIT_REVISION_TOOL: SubmitTool = {
  name: 'submit_revision',
  description: 'Submit the replacement or cut for each noted line you change, once.',
  strict: false,
  input_schema: {
    type: 'object',
    properties: {
      replacements: {
        type: 'array',
        items: obj({ line_id: str, cut: { type: 'boolean' }, text: str, on_screen: nullableStr, on_screen_kind: ON_SCREEN_KIND, fact_ids: strList, must_show: nullableStr, pause_after: nullableNum }),
      },
      pronounce: PRONOUNCE,
      // Optional: what a line change makes stale (the hook's words after an L1 rewrite, a rung's purpose, the close question).
      hook_on_screen: nullableStr,
      close_question: nullableStr,
      purposes: { type: 'array', items: obj({ rung_id: str, purpose: str }) },
    },
    required: ['replacements', 'pronounce'],
    additionalProperties: false,
  },
};

/** An object where only `required` must be given; the rest may be left out. */
function partly(required: Record<string, unknown>, optional: Record<string, unknown>) {
  return { type: 'object', additionalProperties: false, required: Object.keys(required), properties: { ...required, ...optional } } as const;
}

const num = { type: 'number' } as const;
const list = (items: unknown) => ({ type: 'array', items }) as const;

/** What a frame is, in fields (types.ts `Blueprint`, ITERATION-10-CONTRACT §4). Every time is the exact spoken words, never seconds. */
export const BLUEPRINT = partly(
  {
    ground: str,
    style: { type: 'string', enum: ['cutouts', 'paper'] },
    arrangement: { type: 'string', enum: ['face_off', 'lead_inset', 'row', 'pile', 'facing', 'turned_away', 'leads_to', 'solo'] },
    pieces: list(
      partly(
        { id: str, on: str },
        {
          asset: str,
          treatment: { type: 'string', enum: ['page', 'post', 'document', 'headline', 'newspaper', 'map', 'photo', 'number', 'stat', 'board', 'lift', 'lower_third'] },
          opts: { type: 'object' },
          fill: { type: 'boolean' },
          note: str,
          note_role: { type: 'string', enum: ['figure', 'place', 'date', 'body'] },
          role: { type: 'string', enum: ['lead'] },
          side: { type: 'string', enum: ['left', 'right'] },
          belongs: str,
          onto: obj({ piece: str, box: str }),
          crop: obj({ x: num, y: num, w: num, h: num }),
          until: str,
          label: str,
        },
      ),
    ),
    labels: list(partly({ text: str, on: str }, { sub: str, kind: str, for: str })),
    speech: list(partly({ on_piece: str, text: str, on: str }, { until: str })),
    marks: list(partly({ kind: str, on_piece: str, on: str }, { target: str, from: str })),
    arrows: list(obj({ from: str, to: str, on: str })),
    camera: obj({ move: { type: 'string', enum: ['hold', 'push', 'drift', 'slide', 'tour'] }, stops: list(partly({ on: str, aim: str }, { zoom: num })) }),
    sounds: list(partly({ kind: str, what: str, on: str }, { dur: num })),
  },
  {
    hook: obj({ text: str, on: str }),
    peak: { type: 'boolean' },
    ground_tone: list(obj({ on: str, to: num })),
  },
);

export const SUBMIT_PLAN_TOOL: SubmitTool = {
  name: 'submit_plan',
  description: 'Submit the storyboard frames, the assets to make, the shots to search for (wishes), and any lines sent back to the writer, once.',
  strict: false,
  input_schema: obj({
    frames: {
      type: 'array',
      items: obj({
        n: { type: 'integer' },
        name: str,
        line_ids: strList,
        treatment: { type: 'string', enum: [...TREATMENTS] },
        asset_ids: strList,
        purpose: str,
        // What the frame is, in fields; null only on the close (the kit's).
        blueprint: { anyOf: [BLUEPRINT, { type: 'null' }] },
        music: { type: 'string', enum: [...MUSIC_CUES] },
        on_screen: nullableStr,
        drop_labels: strList,
        shows: { type: 'array', items: obj({ person: str, asset_id: str, treatment: str }) },
        // What the eye lands on first (MD-131); null for the close.
        focus: { anyOf: [obj({ kind: { type: 'string', enum: [...FOCUS_KINDS] }, what: str }), { type: 'null' }] },
        // The picture beats, in spoken order (MD-136); empty for the close.
        shots: { type: 'array', items: FRAME_SHOT },
      }),
    },
    makes: {
      type: 'array',
      items: obj({ id: str, kind: { type: 'string', enum: [...MAKE_KINDS] }, brief: str, people: strList, from_assets: strList, seed: nullableStr }),
    },
    wishes: {
      type: 'array',
      items: obj({ id: str, person: nullableStr, want: str, query: str, as: { type: 'string', enum: [...WISH_AS] }, count: { type: 'integer' }, cut_out: { type: 'boolean' }, frame_ns: { type: 'array', items: { type: 'integer' } }, fallback: str }),
    },
    lines_back: { type: 'array', items: obj({ line_id: str, why: str, suggestion: str }) },
  }),
};

/** The creative pass (types.ts `Touches`): everything a touch can add. None is a good answer. Not strict: each type uses its own fields. */
export const SUBMIT_TOUCHES_TOOL: SubmitTool = {
  name: 'submit_touches',
  description: 'Submit the touches and custom pieces you add, once. Empty lists mean the reel needs none.',
  strict: false,
  input_schema: obj({
    touches: list(
      partly(
        { id: str, frame: { type: 'integer' }, why: str, type: { type: 'string', enum: ['extra_line', 'in_turn', 'closer_cuts', 'mark', 'ground_tone', 'sound'] } },
        { text: str, for: str, on: {}, piece_ids: strList, from: str, to: {}, aim: str, kind: str, on_piece: str, target: str, what: str, dur: num },
      ),
    ),
    custom: list(partly({ id: str, frame: { type: 'integer' }, why: str, aspect: num, min_width: num, on: str, code: str }, { until: str })),
  }),
};

export const SUBMIT_CAPTION_TOOL: SubmitTool = {
  name: 'submit_caption',
  description: 'Submit the post caption, once.',
  strict: true,
  input_schema: obj({ caption: str }),
};

export const SUBMIT_LOOKS_TOOL: SubmitTool = {
  name: 'submit_looks',
  description: 'Submit one look per numbered image, once.',
  strict: true,
  input_schema: obj({
    looks: {
      type: 'array',
      items: obj({
        image: { type: 'integer' },
        sees: str,
        matches: { type: 'string', enum: ['yes', 'no', 'unsure'] },
        disqualified: { type: 'boolean' },
        why: str,
      }),
    },
  }),
};

export const SUBMIT_VIEWING_TOOL: SubmitTool = {
  name: 'submit_viewing',
  description: 'Submit what you saw and understood, once.',
  strict: true,
  input_schema: obj({
    hook_seconds: { type: ['number', 'null'] },
    muted_followed: { type: 'boolean' },
    hook_pull: { type: 'integer' },
    story_in_my_words: str,
    want_next: str,
    keep_watching: { type: 'integer' },
    confused: { type: 'array', items: obj({ at: { type: ['number', 'null'] }, what: str }) },
  }),
};
