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
  'close',
] as const;
export type Treatment = (typeof TREATMENTS)[number];

/**
 * Treatments that show a found or made asset, so a frame using one must name it. `lower_third` and
 * `number` are overlays: they render over the frame's first asset (kit/FRAME.md), so they need one too.
 */
export const ASSET_TREATMENTS: readonly Treatment[] = ['photo', 'cutout_lift', 'collision', 'page', 'post', 'document', 'headline', 'lower_third', 'number', 'tableau', 'collage'];

/** The only treatments a person's banked character image may appear in (MD-41: it represents them, staged or lifted). */
export const CHARACTER_TREATMENTS: readonly Treatment[] = ['cutout_lift', 'collision', 'tableau', 'collage'];

/** What the director may ask to be made (MD-59): drawn, traced or code-built, never photoreal. */
export const MAKE_KINDS = ['setting', 'expression', 'collage', 'drawing'] as const;

export const MUSIC_CUES = ['start', 'change', 'drop', 'hold', 'end'] as const;

const nullableNum = { type: ['number', 'null'] } as const;

/** How the voice says names it would get wrong; captions keep the spelling. */
const PRONOUNCE = { type: 'array', items: obj({ word: str, say: str }) } as const;

const SCRIPT_LINE = obj({ id: str, text: str, on_screen: nullableStr, fact_ids: strList, must_show: nullableStr, pause_after: nullableNum });

export const SUBMIT_SCRIPT_TOOL: SubmitTool = {
  name: 'submit_script',
  description: 'Submit the finished script, once, at the end.',
  strict: false,
  input_schema: obj({
    title: str,
    engine: str,
    hook: obj({ on_screen: str, line_id: str }),
    rungs: { type: 'array', items: obj({ id: str, purpose: str, lines: { type: 'array', items: SCRIPT_LINE } }) },
    turn_rung_id: str,
    landing_rung_id: str,
    close_question: str,
    pronounce: PRONOUNCE,
  }),
};

export const SUBMIT_REVISION_TOOL: SubmitTool = {
  name: 'submit_revision',
  description: 'Submit the replacement or cut for each noted line you change, once.',
  strict: false,
  input_schema: obj({
    replacements: {
      type: 'array',
      items: obj({ line_id: str, cut: { type: 'boolean' }, text: str, on_screen: nullableStr, fact_ids: strList, must_show: nullableStr, pause_after: nullableNum }),
    },
    pronounce: PRONOUNCE,
  }),
};

export const SUBMIT_PLAN_TOOL: SubmitTool = {
  name: 'submit_plan',
  description: 'Submit the storyboard frames, the assets to make, and any lines sent back to the writer, once.',
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
        motion: str,
        marks: str,
        sound: str,
        music: { type: 'string', enum: [...MUSIC_CUES] },
        on_screen: nullableStr,
        shows: { type: 'array', items: obj({ person: str, asset_id: str, treatment: str }) },
      }),
    },
    makes: {
      type: 'array',
      items: obj({ id: str, kind: { type: 'string', enum: [...MAKE_KINDS] }, brief: str, people: strList, from_assets: strList, seed: nullableStr }),
    },
    lines_back: { type: 'array', items: obj({ line_id: str, why: str, suggestion: str }) },
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
    story_in_my_words: str,
    want_next: str,
    keep_watching: { type: 'integer' },
    confused: { type: 'array', items: obj({ at: { type: ['number', 'null'] }, what: str }) },
  }),
};
