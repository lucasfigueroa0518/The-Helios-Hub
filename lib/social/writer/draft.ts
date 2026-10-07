/**
 * The draft every editorial stage hands on (Writer M3, Editor M4): one
 * submit_draft shape, so later stages read one format (Tommy, 2026-10-05).
 *
 * The schema mirrors the Writer prompt's OUTPUT section list (prompts file
 * §2): cover options with the chosen index, slides with TYPE / HEADLINE /
 * BODY / quote or numbers by ID / IMAGE, FOLLOW, CAPTION, EDIT NOTES.
 * Quotes and numbers travel by ID only; code fills the exact text from the
 * brief (spec §4.2a). Every text line carries the fact IDs it rests on.
 *
 * Not `strict` (same reason as submit_brief: the API caps the grammar of
 * strict tools). checkDraft enforces it in code; one retry on failure.
 */
import type Anthropic from '@anthropic-ai/sdk';

import { checkShape, type Brief, type BriefError } from '@/lib/social/reporter/brief';

export const SLIDE_TYPES = ['text', 'stat', 'split_stat', 'quote', 'landing', 'image'] as const;
export type SlideType = (typeof SLIDE_TYPES)[number];
/** `none` (Tommy, 2026-10-06): no photo fits; the slide renders without one. Never on a cover. */
export const IMAGE_KINDS = ['subject', 'article', 'stock', 'none'] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

/** A line of slide or caption text and the brief IDs it rests on (claim tags). */
export type TaggedLine = { text: string; facts: string[] };
export type ImageRequest = { kind: ImageKind; value: string };

/** Hook pass (prototype): one short added line; `lead-in` renders above the body, the others below. */
export const HOOK_KINDS = ['lead-in', 'tease', 'why-it-matters'] as const;
export type HookKind = (typeof HOOK_KINDS)[number];
export type SlideHook = { text: string; kind: HookKind; facts: string[] };

export type DraftSlide = {
  type: SlideType;
  headline: TaggedLine;
  body: TaggedLine | null;
  /** Quote slides: the brief quote's ID. */
  quote_id: string | null;
  /** Optional exact excerpt of that quote, with "…" for cuts (spec §5.3). */
  quote_excerpt: string | null;
  /** Stat: one ID; split stat: two. */
  number_ids: string[];
  image: ImageRequest;
  /**
   * The SUBJECTS IDs this slide is about and names (photo spec §3 rule 3;
   * Tommy, 2026-10-07). The Writer must give them (its handoff check); the
   * schema keeps them optional so the Editor's echo of the draft never fails
   * on them.
   */
  subject_ids?: string[];
  /** The icon drawn when no photo is found (render/icons.ts; photo spec §5). Optional in the schema like the tags. */
  icon?: string;
  /** Spread: this slide and the next share one wide photo (this slide's IMAGE). */
  spread_with_next: boolean;
  /** Added by the Hook pass only (never by the Writer or Editor; not in DRAFT_SCHEMA). */
  hook?: SlideHook | null;
};

export type DraftSubmission = {
  cover_options: Array<{ text: string; facts: string[]; image: ImageRequest; subject_ids?: string[]; icon?: string }>;
  /** 1-based index into cover_options. */
  chosen_cover: number;
  slides: DraftSlide[];
  follow: string;
  caption: TaggedLine;
  edit_notes: string[];
};

// ── Schema ────────────────────────────────────────────────────────────

const str = { type: 'string' } as const;
const strList = { type: 'array', items: str } as const;
const obj = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const facts = { ...strList, description: 'IDs of the brief facts/quotes/numbers this line rests on (F3, B1, Q2, N1). Empty if none.' };
const tagged = (description: string) => obj({ text: { type: 'string', description }, facts });
const subjectIds = { ...strList, description: 'SUBJECTS IDs (S1, S2, …) of the people and organizations this slide is about and names in its words. Empty if none.' };
const icon = { type: 'string', description: 'The icon for this slide, from the icon list (drawn when no photo is found, always on stat slides).' };
/** An object schema whose listed keys are optional (present in properties, not required). */
const optional = (schema: ReturnType<typeof obj>, ...keys: string[]) => ({ ...schema, required: schema.required.filter((k) => !keys.includes(k)) });
const image = obj({
  kind: { type: 'string', enum: [...IMAGE_KINDS] },
  value: { type: 'string', description: 'subject: a name from SUBJECTS; article: a photo URL from ARTICLE PHOTOS; stock: a plain 2–3 word literal scene; none: empty (no photo fits). Covers never use none.' },
});

export const DRAFT_SCHEMA = obj({
  cover_options: {
    type: 'array',
    description: 'Exactly 3 cover options.',
    items: optional(obj({ text: { type: 'string', description: '≤90 chars; says who did what on its own.' }, facts, image, subject_ids: subjectIds, icon }), 'subject_ids', 'icon'),
  },
  chosen_cover: { type: 'integer', description: 'Which cover option is chosen: 1, 2 or 3.' },
  slides: {
    type: 'array',
    description: 'Story slides in order (5–8), starting with slide 2.',
    items: optional(obj({
      type: { type: 'string', enum: [...SLIDE_TYPES] },
      headline: tagged('≤60 chars.'),
      body: { ...tagged('≤220 chars.'), type: ['object', 'null'], description: 'Null on landing, quote and stat slides without a body.' },
      quote_id: { type: ['string', 'null'], description: 'Quote slides: the QUOTES ID. Null otherwise.' },
      quote_excerpt: { type: ['string', 'null'], description: 'Optional exact excerpt of that quote, with "…" for cuts. Null to use the whole quote.' },
      number_ids: { ...strList, description: 'Stat: one NUMBERS ID; split stat: two. Empty otherwise.' },
      image,
      subject_ids: subjectIds,
      icon,
      spread_with_next: { type: 'boolean', description: 'True when this slide and the next continue one beat and one wide literal scene fits both; this slide carries the IMAGE, the next slide has IMAGE none. At most one per post.' },
    }), 'subject_ids', 'icon'),
  },
  follow: { type: 'string', description: 'The FOLLOW line.' },
  caption: tagged('The full caption (see the caption section).'),
  edit_notes: { ...strList, description: 'One line per judgment call.' },
});

export const SUBMIT_DRAFT_TOOL = {
  name: 'submit_draft',
  description: 'Submit the finished draft. Call it once, as your final step.',
  input_schema: DRAFT_SCHEMA,
} as unknown as Anthropic.Tool;

// ── Code check ────────────────────────────────────────────────────────

export class DraftValidationError extends Error {
  constructor(readonly errors: BriefError[]) {
    super(`draft invalid: ${errors.map((e) => `${e.section}: ${e.message}`).join('; ')}`);
  }
}

/** "a … b … c" → every piece appears in the quote, in order. */
export function isExactExcerpt(excerpt: string, quote: string): boolean {
  const norm = (s: string) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
  const q = norm(quote);
  let from = 0;
  const pieces = norm(excerpt).split(/\s*(?:…|\.\.\.)\s*/).map((p) => p.trim()).filter(Boolean);
  if (pieces.length === 0) return false;
  for (const piece of pieces) {
    const at = q.indexOf(piece, from);
    if (at === -1) return false;
    from = at + piece.length;
  }
  return true;
}

/**
 * Shape against the schema, then the ID rules the code relies on: chosen
 * cover in range, quote/number IDs exist (never a cut-off quote), excerpts
 * exact, stat slides carry the right number of IDs, claim-tag IDs exist.
 * Writing quality, lengths and voice are not checked here.
 */
export function checkDraft(input: unknown, brief: Brief): DraftSubmission {
  const shape = checkShape(input, DRAFT_SCHEMA, 'draft');
  if (shape.length > 0) throw new DraftValidationError(shape);
  const d = input as DraftSubmission;
  const errors: BriefError[] = [];
  const quotes = new Map(brief.quotes.map((q) => [q.id, q]));
  const numbers = new Set(brief.numbers.map((n) => n.id));
  const known = new Set([...brief.facts, ...brief.background, ...brief.quotes, ...brief.numbers].map((x) => x.id));
  const subjects = new Set(brief.subjects.map((s) => s.name));
  const imageCheck = (where: string, img: ImageRequest) => {
    if (img.kind === 'subject' && !subjects.has(img.value)) {
      errors.push({ section: where, message: `subject image "${img.value}" isn't exactly a SUBJECTS name (one person or organization)` });
    }
  };
  const tagCheck = (where: string, ids: string[]) => {
    for (const id of ids) if (!known.has(id)) errors.push({ section: where, message: `claim tag ${id} isn't in the brief` });
  };

  if (d.cover_options.length !== 3) errors.push({ section: 'cover_options', message: `expected 3, got ${d.cover_options.length}` });
  if (!Number.isInteger(d.chosen_cover) || d.chosen_cover < 1 || d.chosen_cover > d.cover_options.length) {
    errors.push({ section: 'chosen_cover', message: `${d.chosen_cover} is not one of the cover options` });
  }
  d.cover_options.forEach((c, i) => {
    tagCheck(`cover_options[${i}]`, c.facts);
    imageCheck(`cover_options[${i}].image`, c.image);
    // "A cover always has an IMAGE" is the Writer's handoff check (writer.ts), so a request the code
    // dropped on the final attempt can travel as none; the finder gives a cover with none the AI-compute fallback.
  });
  // Spreads (Tommy, 2026-10-06): at most one; its first slide carries a photo, the next slide IMAGE none.
  const spreads = d.slides.map((s, i) => (s.spread_with_next ? i : -1)).filter((i) => i >= 0);
  if (spreads.length > 1) errors.push({ section: 'slides', message: `${spreads.length} spreads (at most one per post)` });
  for (const i of spreads) {
    const at = `slides[${i}]`;
    if (i === d.slides.length - 1) errors.push({ section: at, message: 'spread_with_next on the last slide (there is no next slide to pair with)' });
    if (d.slides[i]!.image.kind === 'none') errors.push({ section: `${at}.image`, message: 'a spread needs a photo on its first slide' });
    const next = d.slides[i + 1];
    if (next && next.image.kind !== 'none') errors.push({ section: `slides[${i + 1}].image`, message: 'the slide after a spread carries no IMAGE (use none); the pair shares the first slide\'s' });
  }

  d.slides.forEach((s, i) => {
    const at = `slides[${i}]`;
    tagCheck(`${at}.headline`, s.headline.facts);
    imageCheck(`${at}.image`, s.image);
    if (s.body) tagCheck(`${at}.body`, s.body.facts);
    if (s.type === 'quote') {
      const q = s.quote_id ? quotes.get(s.quote_id) : undefined;
      if (!s.quote_id) errors.push({ section: at, message: 'quote slide without quote_id' });
      else if (!q) errors.push({ section: at, message: `quote ${s.quote_id} isn't in the brief` });
      else if (q.cut_off) errors.push({ section: at, message: `quote ${s.quote_id} is marked cut off; never use it` });
      else if (s.quote_excerpt && !isExactExcerpt(s.quote_excerpt, q.text)) {
        errors.push({ section: at, message: `excerpt isn't word for word from ${s.quote_id}` });
      }
    } else if (s.quote_id) {
      errors.push({ section: at, message: `quote_id on a ${s.type} slide` });
    }
    const wantNumbers = s.type === 'stat' ? 1 : s.type === 'split_stat' ? 2 : 0;
    if (s.number_ids.length !== wantNumbers) {
      errors.push({ section: at, message: `${s.type} slide needs ${wantNumbers} number ID(s), got ${s.number_ids.length}` });
    }
    for (const id of s.number_ids) if (!numbers.has(id)) errors.push({ section: at, message: `number ${id} isn't in the brief` });
  });
  tagCheck('caption', d.caption.facts);

  if (errors.length > 0) throw new DraftValidationError(errors);
  return d;
}

// ── Code fill-in (spec §4.2a): IDs → exact text from the brief ─────────

export type FilledSlide = DraftSlide & {
  /**
   * Exact quote text (or the checked excerpt) and its speaker. `speaker_subject`: the
   * SUBJECTS name the quote's speaker_id points to (quote slides match photos by it);
   * `speaker_role`: that entry's role, for the type-led quote slide (photo spec §4).
   */
  quote: { text: string; speaker: string; id: string; speaker_subject: string | null; speaker_role: string | null } | null;
  /** Exact number values, as the source wrote them. */
  numbers: Array<{ id: string; value: string; counts: string }>;
};

export type FilledDraft = Omit<DraftSubmission, 'slides'> & { cover: string; slides: FilledSlide[] };

export function fillDraft(d: DraftSubmission, brief: Brief): FilledDraft {
  const quotes = new Map(brief.quotes.map((q) => [q.id, q]));
  const numbers = new Map(brief.numbers.map((n) => [n.id, n]));
  return {
    ...d,
    cover: d.cover_options[d.chosen_cover - 1]!.text,
    slides: d.slides.map((s) => {
      const q = s.quote_id ? quotes.get(s.quote_id)! : null;
      const who = q?.speaker_id ? brief.subjects.find((x) => x.id === q.speaker_id) : undefined;
      return {
        ...s,
        quote: q ? { id: q.id, text: s.quote_excerpt ?? q.text, speaker: q.speaker, speaker_subject: who?.name ?? null, speaker_role: who?.role ?? null } : null,
        numbers: s.number_ids.map((id) => {
          const n = numbers.get(id)!;
          return { id, value: n.value, counts: n.counts };
        }),
      };
    }),
  };
}
