/**
 * The over-length rescue (Lucas, 2026-10-08; the Anthropic story was set
 * aside for one body 4 characters over the limit after the Writer's retry).
 *
 * When a Writer or Editor draft still fails after its retry, and the only
 * failures are lines over their character limit (C1: cover, headline, body,
 * caption; a quote is exact text and is never shortened), one small Claude
 * call shortens just those lines. Code checks the result: every line at or
 * under its limit, nothing empty, no number that wasn't in the line before.
 * The patched draft then goes through the stage's full check again.
 *
 *   classification: AI call · shorten · 0 stages · +1 call, only when a draft would be set aside for length
 *
 * Caching: tools (submit_lines) → system (static) → the lines (per draft).
 */
import type Anthropic from '@anthropic-ai/sdk';

import { LIMITS, numbersIn } from '@/lib/social/mechanical/checks';
import { STAGE_MODELS, type StageModelConfig } from '@/lib/social/pipeline/models';
import { checkShape, type Brief, type BriefError } from '@/lib/social/reporter/brief';
import type { MessagesCreate, TurnUsage } from '@/lib/social/reporter/reporter';

import { DraftValidationError, type DraftSubmission } from './draft';
import { runStructuredCall } from './structured-call';

export const SHORTEN_SYSTEM = `You shorten lines from an Instagram carousel about AI news so each fits its character limit.

- Keep the meaning and every fact: names, numbers, dates, hedges ("says," "may," "up to") and attributions ("X says"). Cut words, never facts.
- Keep the voice: confident and lively. Don't flatten a line into a neutral one.
- Keep any quoted words exactly as they are, inside their quotation marks.
- No em dashes, no exclamation marks, no emoji.
- Each line must be at or under its limit. Aim a few characters under.

Call submit_lines with every line, by its id.`;

const obj = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

export const LINES_SCHEMA = obj({
  lines: { type: 'array', items: obj({ id: { type: 'string' }, text: { type: 'string', description: 'The shortened line, at or under its limit.' } }) },
});

export const SUBMIT_LINES_TOOL = { name: 'submit_lines', description: 'Submit the shortened lines. Call it once.', input_schema: LINES_SCHEMA } as unknown as Anthropic.Tool;

/** A line to shorten: where it is ("slide 7 body", "cover", "caption"), its limit and text. */
export type OverLine = { id: string; where: string; limit: number; text: string };

/** The draft lines over their limit (C1), quotes excepted; null when anything else is wrong. */
export function overLimitLines(d: DraftSubmission): OverLine[] {
  const out: OverLine[] = [];
  const add = (where: string, text: string, limit: number) => { if (text.length > limit) out.push({ id: `L${out.length + 1}`, where, limit, text }); };
  add('cover', d.cover_options[d.chosen_cover - 1]?.text ?? '', LIMITS.cover);
  d.slides.forEach((s, i) => {
    add(`slide ${i + 2} headline`, s.headline.text, LIMITS.headline);
    if (s.body) add(`slide ${i + 2} body`, s.body.text, LIMITS.body);
  });
  add('caption', d.caption.text, LIMITS.caption);
  return out;
}

/** Is every failure a line over its limit that this rescue can shorten (C1, not a quote)? */
export const onlyOverLimit = (errors: BriefError[]) => errors.length > 0 && errors.every((e) => /^C1 /.test(e.section) && !/ quote$/.test(e.section));

/** Put shortened lines back in their places. */
export function applyLines(d: DraftSubmission, lines: OverLine[], texts: Map<string, string>): DraftSubmission {
  const out = structuredClone(d);
  for (const l of lines) {
    const t = texts.get(l.id)!;
    if (l.where === 'cover') out.cover_options[out.chosen_cover - 1]!.text = t;
    else if (l.where === 'caption') out.caption.text = t;
    else {
      const m = /^slide (\d+) (headline|body)$/.exec(l.where)!;
      const s = out.slides[Number(m[1]) - 2]!;
      if (m[2] === 'headline') s.headline.text = t;
      else s.body!.text = t;
    }
  }
  return out;
}

export function checkLines(input: unknown, lines: OverLine[]): Map<string, string> {
  const shape = checkShape(input, LINES_SCHEMA, 'lines');
  if (shape.length) throw new DraftValidationError(shape);
  const got = new Map((input as { lines: Array<{ id: string; text: string }> }).lines.map((l) => [l.id, l.text.trim()]));
  const errors: BriefError[] = [];
  for (const l of lines) {
    const t = got.get(l.id);
    if (!t) { errors.push({ section: l.id, message: `missing line ${l.id} (${l.where})` }); continue; }
    if (t.length > l.limit) errors.push({ section: l.id, message: `${t.length} characters, limit ${l.limit}` });
    const before = new Set(numbersIn(l.text));
    for (const n of numbersIn(t)) if (!before.has(n)) errors.push({ section: l.id, message: `the number ${n} wasn't in the line` });
  }
  if (errors.length) throw new DraftValidationError(errors);
  return got;
}

export type ShortenResult = { ok: true; draft: DraftSubmission; costUsd: number; turnUsage: TurnUsage[]; note: string } | { ok: false; detail: string; costUsd: number; turnUsage: TurnUsage[] };

/** One call (one retry inside, like every stage) that shortens the over-limit lines of `d`. */
export async function shortenOverLimit(d: DraftSubmission, create: MessagesCreate, config: StageModelConfig = STAGE_MODELS.shorten): Promise<ShortenResult> {
  const lines = overLimitLines(d);
  if (!lines.length) return { ok: false, detail: 'no line over its limit', costUsd: 0, turnUsage: [] };
  const r = await runStructuredCall({
    create,
    config,
    system: SHORTEN_SYSTEM,
    tool: SUBMIT_LINES_TOOL,
    user: `LINES\n${JSON.stringify(lines.map(({ id, where, limit, text }) => ({ id, where, limit, length: text.length, text })), null, 2)}`,
    check: (input) => checkLines(input, lines),
  });
  if (!r.ok) return { ok: false, detail: r.detail, costUsd: r.costUsd, turnUsage: r.turnUsage };
  return { ok: true, draft: applyLines(d, lines, r.value), costUsd: r.costUsd, turnUsage: r.turnUsage, note: `shortened to fit: ${lines.map((l) => `${l.where} ${l.text.length}→${r.value.get(l.id)!.length}`).join(', ')}` };
}

/**
 * After a stage's retry failed: when the last submission's only failures are lines over their limit,
 * shorten them and run the stage's own check once more. Returns the checked draft, or null.
 */
export async function rescueOverLength<T>(raw: string | null, create: MessagesCreate, finalCheck: (input: unknown) => T): Promise<{ value: T; costUsd: number; turnUsage: TurnUsage[]; note: string } | { value: null; costUsd: number; turnUsage: TurnUsage[]; note: string | null }> {
  if (!raw) return { value: null, costUsd: 0, turnUsage: [], note: null };
  let input: DraftSubmission | null = null;
  try {
    input = JSON.parse(raw) as DraftSubmission;
    finalCheck(input);
    return { value: null, costUsd: 0, turnUsage: [], note: null }; // nothing to rescue (it passes)
  } catch (err) {
    if (!(err instanceof DraftValidationError) || !onlyOverLimit(err.errors)) return { value: null, costUsd: 0, turnUsage: [], note: null };
  }
  if (!input) return { value: null, costUsd: 0, turnUsage: [], note: null };
  const s = await shortenOverLimit(input, create);
  if (!s.ok) return { value: null, costUsd: s.costUsd, turnUsage: s.turnUsage, note: `shorten failed: ${s.detail}` };
  try {
    return { value: finalCheck(s.draft), costUsd: s.costUsd, turnUsage: s.turnUsage, note: s.note };
  } catch (err) {
    return { value: null, costUsd: s.costUsd, turnUsage: s.turnUsage, note: `shortened, still failing: ${err instanceof Error ? err.message : String(err)}` };
  }
}
