import { noul } from '@typesafe-ai/sdk';

import type { DramaJevRunner } from '@/lib/reel-ai-drama/jev';
import type { FactSheet, ScriptLine, WriterDraft } from '@/lib/reel-ai-drama/types';
import { defineQuestionSet } from '@/lib/reels/jev/question-set';

/**
 * C1, the facts check (MD-39): loose and semantic, a Jev judgment per line. It flags only a claim the
 * fact sheet doesn't support or a line that changes the facts' meaning — never wording, tone, rounding
 * that keeps a figure true, or compression. Lucas: "I really hate when these are sensitive and
 * constantly being set off." A line is flagged only when Jev is fairly sure it fails (below
 * FACTS_FLAG_BELOW); the runner gives each flagged line one fix, then cuts it.
 */
export const FACTS_SET = defineQuestionSet({
  id: 'reel-ai-drama-facts',
  version: 'reel-ai-drama-facts-v1',
  questions: {
    supported: noul({
      question: 'Does the fact sheet support what this line claims?',
      judge:
        "Read line (narration from a short documentary) and on_screen (the words shown with it), then facts (the verified fact sheet; cited are the entries the writer says the line uses, but any entry may support it). Answer yes when everything the line asserts as fact is supported by the fact sheet in substance, even if it is worded differently, compressed, dramatic in tone, rounded in a way that keeps the figure true, or phrased as a question or a hook. A line that asserts no fact (a question, a transition, a feeling) is yes. Answer no only when the line asserts something the fact sheet does not contain or contradicts: a different person, action, number, date, place or outcome, or a cause or motive the facts don't state.",
    }),
    meaning_kept: noul({
      question: 'Does the line keep the meaning of the facts it draws on?',
      judge:
        'Read line, on_screen, context_before (the line before it) and facts. Answer yes when the line keeps the meaning of the facts: the same people doing the same things, in the same order of cause, with allegations still presented as allegations and disputed points not stated as settled. Differences of wording, emphasis, tone or compression never matter. Answer no only when the line changes the meaning: it turns an allegation into a finding, states a disputed point as settled, reverses who acted, merges separate events into one, or implies an outcome the facts do not.',
    }),
  },
});

/** Flag a line only below this "yes" from Jev: it is fairly sure the line fails, not merely unsure. */
export const FACTS_FLAG_BELOW = 0.3;
const CONCURRENCY = 4;

export type FactsFinding = { line_id: string; why: string };

/** Jev's two answers for one line, mapped to a finding (or none). Exported for tests. */
export function factsVerdict(lineId: string, answers: { supported: number; meaning_kept: number }): FactsFinding | null {
  const reasons: string[] = [];
  if (answers.supported < FACTS_FLAG_BELOW) reasons.push(`the fact sheet doesn't support what it claims (${Math.round(answers.supported * 100)}% supported)`);
  if (answers.meaning_kept < FACTS_FLAG_BELOW) reasons.push(`it changes the meaning of the facts (${Math.round(answers.meaning_kept * 100)}% kept)`);
  return reasons.length ? { line_id: lineId, why: `${lineId}: ${reasons.join('; ')}.` } : null;
}

/** The fact sheet as Jev reads it: plain lines, each with its id and confidence. */
export function factsText(facts: FactSheet, only?: Set<string>): string {
  const keep = (id: string) => !only || only.has(id);
  return [
    ...facts.facts.filter((f) => keep(f.id)).map((f) => `${f.id} (${f.confidence}): ${f.text}`),
    ...facts.quotes.filter((q) => keep(q.id)).map((q) => `${q.id}: ${q.speaker} said "${q.text}" (${q.date ?? 'undated'}; ${q.context})`),
    ...facts.artifacts.filter((a) => keep(a.id)).map((a) => `${a.id} (${a.kind}, ${a.date ?? 'undated'}): "${a.text}"`),
  ].join('\n');
}

function noulOf(answers: unknown, key: string): number {
  const v = (answers as Record<string, { noul?: number }>)[key]?.noul;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Jev returned no ${key} answer`);
  return v;
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

/** C1: one Jev call per line (cheap); returns the lines it flags, in script order. */
export async function checkFacts(
  jev: DramaJevRunner,
  input: { draft: WriterDraft; facts: FactSheet; pitchId?: string | null },
): Promise<{ unsupported: FactsFinding[] }> {
  const lines: ScriptLine[] = input.draft.rungs.flatMap((r) => r.lines);
  const all = factsText(input.facts);
  const findings = await mapLimited(lines, CONCURRENCY, async (line) => {
    const i = lines.indexOf(line);
    const onScreen = [line.id === input.draft.hook.line_id ? input.draft.hook.on_screen : null, line.on_screen].filter(Boolean).join(' / ');
    const asked = await jev.ask({
      component: 'facts_check',
      state: {
        line: line.text,
        on_screen: onScreen,
        context_before: i > 0 ? lines[i - 1]!.text : '',
        cited: factsText(input.facts, new Set(line.fact_ids)),
        facts: all,
      },
      set: FACTS_SET,
      questions: FACTS_SET.questions,
      pitchId: input.pitchId ?? null,
    });
    return factsVerdict(line.id, { supported: noulOf(asked.answers, 'supported'), meaning_kept: noulOf(asked.answers, 'meaning_kept') });
  });
  return { unsupported: findings.filter((f): f is FactsFinding => f !== null) };
}

/** Findings shaped as notes for `reviseScript` (the one fix before a line is cut). */
export function factsNotes(findings: FactsFinding[]): { line_id: string; why: string; suggestion: string }[] {
  return findings.map((f) => ({ line_id: f.line_id, why: f.why, suggestion: 'Say only what the cited facts support, or cut the line.' }));
}
