/**
 * Fact-checker flags (spec §4.2, §4.2b; prompts file §5 OUTPUT) and the
 * code that applies them. The Fact-checker never writes new sentences:
 * every fix is a SWAP copied from the brief or a CUT, applied here by code.
 *
 *   free fixes first:   swap · cut · next cover option if the chosen fails
 *   fresh draft when:   cuts leave < 5 story slides, the key slide is cut,
 *                       every cover option fails, or the caption is emptied
 *   set aside when:     the story's main claim is false
 */
import type Anthropic from '@anthropic-ai/sdk';

import { checkShape, type Brief, type BriefError } from '@/lib/social/reporter/brief';
import type { DraftSubmission, FilledDraft } from '@/lib/social/writer/draft';

export type FlagWhere = { part: 'cover' | 'slide' | 'caption'; number: number | null };

export type Flag = {
  where: FlagWhere;
  quoted_text: string;
  /** Spec §4.2 always-flag types 1–5. */
  type: 1 | 2 | 3 | 4 | 5;
  fact_id: string | null;
  fix: { kind: 'swap' | 'cut'; replacement: string | null };
};

export type FlagsSubmission = { flags: Flag[]; main_claim_false: boolean };

// ── Schema (mirrors the §5 section list) ───────────────────────────────

const obj = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

export const FLAGS_SCHEMA = obj({
  flags: {
    type: 'array',
    description: 'One per false claim. Empty when nothing is false (FLAGS: none).',
    items: obj({
      where: obj({
        part: { type: 'string', enum: ['cover', 'slide', 'caption'] },
        number: { type: ['integer', 'null'], description: 'Cover option 1–3 or slide number (story slides start at 2). Null for the caption.' },
      }),
      quoted_text: { type: 'string', description: 'The false text, copied exactly from that part.' },
      type: { type: 'integer', enum: [1, 2, 3, 4, 5], description: 'Always-flag type 1–5.' },
      fact_id: { type: ['string', 'null'], description: 'The brief fact ID the truth comes from, if any.' },
      fix: obj({
        kind: { type: 'string', enum: ['swap', 'cut'] },
        replacement: { type: ['string', 'null'], description: 'SWAP: the exact replacement words, copied from the brief. CUT: null.' },
      }),
    }),
  },
  main_claim_false: { type: 'boolean', description: 'MAIN CLAIM FALSE: yes/no.' },
});

/** Not strict (API grammar-size limit, same as the other submit tools); checked in code. */
export const SUBMIT_FLAGS_TOOL = {
  name: 'submit_flags',
  description: 'Submit the fact-check result. Call it once, as your final step.',
  input_schema: FLAGS_SCHEMA,
} as unknown as Anthropic.Tool;

// ── Check ──────────────────────────────────────────────────────────────

export class FlagsValidationError extends Error {
  constructor(readonly errors: BriefError[]) {
    super(`flags invalid: ${errors.map((e) => `${e.section}: ${e.message}`).join('; ')}`);
  }
}

const norm = (s: string) =>
  s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();

/** All text a SWAP may copy from. */
export function briefText(brief: Brief): string {
  return norm(
    [
      brief.the_news.text,
      ...brief.why_it_matters.map((w) => w.text),
      ...[...brief.facts, ...brief.background].flatMap((f) => [f.text, ...f.notes]),
      ...brief.quotes.map((q) => `${q.text} ${q.speaker} ${q.where ?? ''}`),
      ...brief.numbers.map((n) => `${n.value} ${n.counts}`),
      ...brief.terms.map((t) => `${t.name} ${t.definition}`),
      ...brief.subjects.map((s) => `${s.name} ${s.role ?? ''}`),
    ].join('\n'),
  );
}

/** The texts a flag may point into, for its part. */
function partTexts(where: FlagWhere, draft: FilledDraft): string[] | null {
  if (where.part === 'caption') return [draft.caption.text];
  if (where.part === 'cover') {
    const c = where.number ? draft.cover_options[where.number - 1] : undefined;
    return c ? [c.text] : null;
  }
  const s = where.number ? draft.slides[where.number - 2] : undefined;
  return s ? [s.headline.text, s.body?.text ?? '', s.hook?.text ?? '', s.quote?.text ?? ''] : null;
}

export function checkFlags(input: unknown, draft: FilledDraft, brief: Brief): FlagsSubmission {
  const shape = checkShape(input, FLAGS_SCHEMA, 'flags');
  if (shape.length > 0) throw new FlagsValidationError(shape);
  const f = input as FlagsSubmission;
  const errors: BriefError[] = [];
  const ids = new Set([...brief.facts, ...brief.background, ...brief.quotes, ...brief.numbers].map((x) => x.id));
  const source = briefText(brief);
  f.flags.forEach((flag, i) => {
    const at = `flags[${i}]`;
    const texts = partTexts(flag.where, draft);
    if (!texts) {
      errors.push({ section: at, message: `${flag.where.part} ${flag.where.number} doesn't exist` });
      return;
    }
    if (!texts.some((t) => norm(t).includes(norm(flag.quoted_text)))) {
      errors.push({ section: at, message: `quoted text isn't in ${flag.where.part}${flag.where.number ? ` ${flag.where.number}` : ''}` });
    }
    if (flag.fact_id && !ids.has(flag.fact_id)) errors.push({ section: at, message: `fact ID ${flag.fact_id} isn't in the brief` });
    if (flag.fix.kind === 'swap') {
      if (!flag.fix.replacement) errors.push({ section: at, message: 'SWAP without replacement words' });
      else if (!source.includes(norm(flag.fix.replacement))) {
        errors.push({ section: at, message: 'SWAP words aren\'t copied from the brief (never write new words; copy the brief exactly, or CUT)' });
      }
    }
  });
  if (errors.length > 0) throw new FlagsValidationError(errors);
  return f;
}

// ── Apply (code, no judgment) ──────────────────────────────────────────

export const MIN_STORY_SLIDES = 5;

export type FixOutcome =
  | { kind: 'ok'; draft: DraftSubmission; applied: string[] }
  | { kind: 'fresh-draft'; why: string; applied: string[] }
  | { kind: 'set-aside'; why: string };

/** Remove `cut` from `text` and tidy what's left. Empty when nothing readable remains. */
export function cutText(text: string, cut: string): string {
  const at = text.toLowerCase().indexOf(cut.toLowerCase());
  if (at === -1) return text;
  const out = `${text.slice(0, at)} ${text.slice(at + cut.length)}`
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;:])\s*([.!?])/g, '$2')
    .replace(/^[\s,.;:]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return /[A-Za-z0-9]/.test(out) ? out : '';
}

function swapText(text: string, from: string, to: string): string {
  const at = text.toLowerCase().indexOf(from.toLowerCase());
  return at === -1 ? text : `${text.slice(0, at)}${to}${text.slice(at + from.length)}`;
}

/** The slide that carries THE NEWS: the first story slide tagged with one of its IDs (else the first story slide). */
export function keySlideIndex(draft: DraftSubmission, brief: Brief): number {
  const newsIds = new Set(brief.the_news.ids);
  const i = draft.slides.findIndex((s) => [...s.headline.facts, ...(s.body?.facts ?? [])].some((id) => newsIds.has(id)));
  return i === -1 ? 0 : i;
}

export function applyFlags(draft: DraftSubmission, flags: FlagsSubmission, brief: Brief): FixOutcome {
  if (flags.main_claim_false) return { kind: 'set-aside', why: 'the story\'s main claim is false' };
  const d: DraftSubmission = structuredClone(draft);
  const applied: string[] = [];
  const keyIndex = keySlideIndex(d, brief);
  const dropped = new Set<number>();
  const failedCovers = new Set<number>();
  const fix = (text: string, flag: Flag) =>
    flag.fix.kind === 'swap' && flag.fix.replacement ? swapText(text, flag.quoted_text, flag.fix.replacement) : cutText(text, flag.quoted_text);

  for (const flag of flags.flags) {
    const label = `${flag.fix.kind.toUpperCase()} type ${flag.type} in ${flag.where.part}${flag.where.number ? ` ${flag.where.number}` : ''}: "${flag.quoted_text}"`;
    if (flag.where.part === 'cover') {
      failedCovers.add(flag.where.number!);
      applied.push(`${label} → cover option ${flag.where.number} fails`);
      continue;
    }
    if (flag.where.part === 'caption') {
      d.caption.text = fix(d.caption.text, flag);
      applied.push(label);
      continue;
    }
    const i = flag.where.number! - 2;
    const s = d.slides[i]!;
    const inHeadline = s.headline.text.toLowerCase().includes(flag.quoted_text.toLowerCase());
    const inBody = !!s.body && s.body.text.toLowerCase().includes(flag.quoted_text.toLowerCase());
    const inHook = !!s.hook && s.hook.text.toLowerCase().includes(flag.quoted_text.toLowerCase());
    if (inHeadline) s.headline.text = fix(s.headline.text, flag);
    else if (inBody) s.body!.text = fix(s.body!.text, flag);
    else if (inHook) {
      // A Hook pass line is an addition: a flagged one is fixed like body text, and an emptied one simply goes.
      s.hook!.text = fix(s.hook!.text, flag);
      if (!s.hook!.text) s.hook = null;
      applied.push(label);
      continue;
    }
    else {
      // The flag points into the filled quote or number: those can't be edited, so the slide goes.
      dropped.add(i);
      applied.push(`${label} → slide ${flag.where.number} dropped (quote/number text)`);
      continue;
    }
    if (s.body && !s.body.text) s.body = null;
    if (!s.headline.text) {
      dropped.add(i);
      applied.push(`${label} → slide ${flag.where.number} emptied and dropped`);
    } else {
      applied.push(label);
    }
  }

  if (!d.caption.text) return { kind: 'fresh-draft', why: 'the caption was cut to nothing', applied };
  if (dropped.has(keyIndex)) return { kind: 'fresh-draft', why: `the key slide (slide ${keyIndex + 2}) was cut`, applied };
  const remaining = d.slides.length - dropped.size;
  // Spec §4.2b: only when the cuts leave too few; a short draft as written is not the Fact-checker's to fix.
  if (dropped.size > 0 && remaining < MIN_STORY_SLIDES) return { kind: 'fresh-draft', why: `cuts leave ${remaining} story slides (< ${MIN_STORY_SLIDES})`, applied };

  const order = [d.chosen_cover, ...d.cover_options.map((_, i) => i + 1).filter((n) => n !== d.chosen_cover)];
  const cover = order.find((n) => !failedCovers.has(n));
  if (!cover) return { kind: 'fresh-draft', why: 'every cover option failed', applied };
  if (cover !== d.chosen_cover) applied.push(`chosen cover ${d.chosen_cover} failed → cover option ${cover}`);
  d.chosen_cover = cover;
  d.slides = d.slides.filter((_, i) => !dropped.has(i));
  return { kind: 'ok', draft: d, applied };
}
