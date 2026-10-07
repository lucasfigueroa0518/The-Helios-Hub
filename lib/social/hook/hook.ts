/**
 * Hook pass (Lucas's proposal; Tommy approved with edits 2026-10-06).
 * Prototype: Editor → Hook pass → Fact-checker → mechanical → render, run
 * on saved drafts only. Not wired into runDay until Lucas has reviewed.
 *
 *   classification: new stage · Hook pass · +1 stage · +1 AI call
 *
 * Claude submits at most one added line per story slide (submit_hooks);
 * code checks it with one retry, like every stage:
 *   always fail (both attempts): a slide that doesn't exist, two entries for
 *     one slide, a line without a kind, a tag that isn't a brief ID;
 *   per line (first attempt: back to the model; after the retry: that line
 *     is dropped and logged, the rest stand; adding nothing is a good
 *     answer): over the slide's measured budget, quotation marks, a number
 *     not in the tagged entries, a second why-it-matters line, C8 (the line
 *     repeats a number or a 4-word phrase of its own slide).
 * Existing text can't change: the tool only returns added lines.
 */
import type Anthropic from '@anthropic-ai/sdk';

import { checkRepetition, numbersIn } from '@/lib/social/mechanical/checks';
import { STAGE_MODELS, type StageModelConfig } from '@/lib/social/pipeline/models';
import { checkShape, type Brief, type BriefError } from '@/lib/social/reporter/brief';
import type { MessagesCreate, TurnUsage } from '@/lib/social/reporter/reporter';
import { HOOK_KINDS, fillDraft, type DraftSubmission, type FilledDraft, type HookKind, type SlideHook } from '@/lib/social/writer/draft';
import { runStructuredCall, type StructuredFailure } from '@/lib/social/writer/structured-call';

import { HOOK_SYSTEM, hookUserMessage } from './prompt';

export type HookEntry = { slide: number; line: string | null; kind: HookKind | null; facts: string[] };
export type HooksSubmission = { hooks: HookEntry[] };

const obj = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

export const HOOKS_SCHEMA = obj({
  hooks: {
    type: 'array',
    description: 'One entry per story slide.',
    items: obj({
      slide: { type: 'integer', description: 'Slide number (story slides start at 2).' },
      line: { type: ['string', 'null'], description: 'The one added line, or null to leave the slide alone.' },
      kind: { type: ['string', 'null'], enum: [...HOOK_KINDS, null], description: 'lead-in, tease or why-it-matters; null when line is null.' },
      facts: { type: 'array', items: { type: 'string' }, description: 'Brief IDs the line rests on (F3, B1, Q2, N1). Empty if it rests only on what the next slide says.' },
    }),
  },
});

/** Not strict (same reason as the other submit tools); checked in code. */
export const SUBMIT_HOOKS_TOOL = {
  name: 'submit_hooks',
  description: 'Submit the added lines. Call it once, as your final step.',
  input_schema: HOOKS_SCHEMA,
} as unknown as Anthropic.Tool;

export class HooksValidationError extends Error {
  constructor(readonly errors: BriefError[]) {
    super(`hooks invalid: ${errors.map((e) => `${e.section}: ${e.message}`).join('; ')}`);
  }
}

export type CheckedHooks = { hooks: Array<SlideHook | null>; dropped: string[] };

const QUOTE_MARKS = /["“”«»„‘]/;

/** Text of each taggable brief entry, by ID (what a line's numbers may come from). */
function entryText(brief: Brief): Map<string, string> {
  return new Map<string, string>([
    ...[...brief.facts, ...brief.background].map((f): [string, string] => [f.id, f.text]),
    ...brief.quotes.map((q): [string, string] => [q.id, q.text]),
    ...brief.numbers.map((n): [string, string] => [n.id, `${n.value} ${n.counts}`]),
  ]);
}

/** Apply checked hooks to the draft (slide i gets hooks[i]). */
export function applyHooks(draft: DraftSubmission, hooks: Array<SlideHook | null>): DraftSubmission {
  return { ...draft, slides: draft.slides.map((s, i) => ({ ...s, hook: hooks[i] ?? null })) };
}

export function checkHooks(input: unknown, draft: DraftSubmission, brief: Brief, budgets: number[], attempt: number): CheckedHooks {
  const shape = checkShape(input, HOOKS_SCHEMA, 'hooks');
  if (shape.length > 0) throw new HooksValidationError(shape);
  const sub = input as HooksSubmission;
  const hard: BriefError[] = [];
  const texts = entryText(brief);
  const seen = new Set<number>();
  for (const [k, h] of sub.hooks.entries()) {
    const at = `hooks[${k}]`;
    if (!Number.isInteger(h.slide) || h.slide < 2 || h.slide > draft.slides.length + 1) hard.push({ section: at, message: `slide ${h.slide} isn't a story slide (2–${draft.slides.length + 1})` });
    else if (seen.has(h.slide)) hard.push({ section: at, message: `a second entry for slide ${h.slide} (at most one line per slide)` });
    seen.add(h.slide);
    if (h.line !== null && h.line.trim() && !h.kind) hard.push({ section: at, message: 'a line needs a kind (lead-in, tease or why-it-matters)' });
    for (const id of h.facts) if (!texts.has(id)) hard.push({ section: at, message: `tag ${id} isn't a brief ID` });
  }
  if (hard.length > 0) throw new HooksValidationError(hard);

  const hooks: Array<SlideHook | null> = draft.slides.map(() => null);
  const problems: Array<{ slide: number; message: string }> = [];
  let why = 0;
  for (const h of [...sub.hooks].sort((a, b) => a.slide - b.slide)) {
    const text = h.line?.trim();
    if (!text || !h.kind) continue;
    const i = h.slide - 2;
    const lineProblems: string[] = [];
    if (text.length > budgets[i]!) lineProblems.push(`${text.length} characters, over the slide's budget of ${budgets[i]}`);
    if (QUOTE_MARKS.test(text)) lineProblems.push('quotation marks (none allowed)');
    const allowed = new Set(h.facts.flatMap((id) => numbersIn(texts.get(id) ?? '')));
    for (const n of numbersIn(text)) if (!allowed.has(n)) lineProblems.push(`the number ${n} isn't in the tagged entries`);
    if (h.kind === 'why-it-matters' && ++why > 1) lineProblems.push('a second why-it-matters line (at most one per post)');
    const hook: SlideHook = { text, kind: h.kind, facts: h.facts };
    // C8 against its own slide.
    const one = fillDraft(applyHooks(draft, draft.slides.map((_, j) => (j === i ? hook : null))), brief);
    for (const f of checkRepetition(one, brief)) if (f.where === `slide ${h.slide}` && /\bhook\b/.test(f.detail)) lineProblems.push(`C8: ${f.detail}`);
    if (lineProblems.length === 0) hooks[i] = hook;
    else problems.push(...lineProblems.map((message) => ({ slide: h.slide, message })));
  }
  if (problems.length > 0 && attempt <= 1) {
    throw new HooksValidationError(problems.map((p) => ({ section: `slide ${p.slide}`, message: p.message })));
  }
  return { hooks, dropped: problems.map((p) => `slide ${p.slide}: line dropped (${p.message})`) };
}

export type HookResult =
  | { ok: true; draft: DraftSubmission; filled: FilledDraft; hooks: Array<SlideHook | null>; dropped: string[]; raw: string; costUsd: number; turns: number; retries: number; retryErrors: string[]; turnUsage: TurnUsage[] }
  | { ok: false; reason: StructuredFailure; detail: string; raw: string | null; costUsd: number; turns: number; retries: number; retryErrors: string[]; turnUsage: TurnUsage[] };

export type HookDeps = { create: MessagesCreate; config?: StageModelConfig };

/** `budgets[i]`: story slide i's measured character budget (0 = full). */
export async function runHookPass(brief: Brief, edited: DraftSubmission, budgets: number[], deps: HookDeps): Promise<HookResult> {
  const r = await runStructuredCall({
    create: deps.create,
    config: deps.config ?? STAGE_MODELS.hook,
    system: HOOK_SYSTEM,
    tool: SUBMIT_HOOKS_TOOL,
    user: hookUserMessage(edited, brief, budgets),
    check: (input, attempt) => checkHooks(input, edited, brief, budgets, attempt),
  });
  const common = { costUsd: r.costUsd, turns: r.turns, retries: r.retries, retryErrors: r.retryErrors, turnUsage: r.turnUsage };
  if (!r.ok) return { ok: false, reason: r.reason, detail: r.detail, raw: r.raw, ...common };
  const draft = applyHooks(edited, r.value.hooks);
  return { ok: true, draft, filled: fillDraft(draft, brief), hooks: r.value.hooks, dropped: r.value.dropped, raw: r.raw, ...common };
}
