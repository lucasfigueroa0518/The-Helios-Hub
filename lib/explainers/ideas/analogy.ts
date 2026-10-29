import type { Queryable } from '@/lib/explainers/db';
import {
  ANALOGY_CALLS,
  ANALOGY_WRITER_VERSION,
  GOLDEN_ANALOGIES,
  ideaUsd,
  MAX_ANALOGY_ROWS,
  MAX_ANALOGY_SENTENCES,
  MIN_ANALOGY_ROWS,
  MIN_ANALOGY_SENTENCES,
  type IdeaModel,
} from '@/lib/explainers/ideas/generator';
import type { ExplainersJevRunner } from '@/lib/explainers/jev/runner';
import { ANALOGY_COMPARE, ANALOGY_GATES, GOLDEN_MATCH } from '@/lib/explainers/jev/questions/analogy-check';
import { recordCost } from '@/lib/explainers/repository';
import {
  ANALOGY_GATE_KEYS,
  type AnalogyCandidate,
  type AnalogyComparison,
  type AnalogyGates,
  type AnalogyNote,
  type AnalogyPickReason,
  type AnalogyTry,
  type Mode,
  type TopicRow,
} from '@/lib/explainers/types';

/**
 * The idea phase owns the analogy (Explainers 3.0, EX3-30; named analogies in 3.9, EX3-123, EX3-124,
 * EX3-125). When a topic makes the pool:
 *
 * 1. Jev reads each of Lucas's golden examples against the topic and hides the ones that teach the
 *    same concept (the leave-one-out, decided by meaning, not by name).
 * 2. Two identical Opus calls each write one named analogy from the golden-set prompt.
 * 3. Code checks each (sentences, rows, the term), then Jev gates it: a false mapping, the real system
 *    at work, a real name. Jev never sees the golden set.
 * 4. Both pass: the same analogy (by name) is taken; two different ones are compared by Jev, twice,
 *    with the order swapped. One passes: it wins. Neither: a third call. Still none: the render fails
 *    with a reason and the topic stays in the pool (EX3-125; supersedes the drop of EX3-104).
 *
 * The pick is BRIEF.md's `## Analogy`; the director stages it (EX3-128). A topic with no pick gets the
 * same pass as its render's first stage (EX3-31).
 */

/** A golden example is hidden from the writer at or above this (EX3-124). */
export const GOLDEN_HIDE_AT = 0.5;
/** A candidate fails a gate at or above this (EX3-124). */
export const ANALOGY_GATE_MAX = 0.5;
/**
 * The render's failure when the writer produced no usable analogy at all in three calls (every reply
 * unreadable). Explainers 4.2: when candidates exist but none passed, the render goes on with the
 * least-bad one and an `analogy:no_pass` warning (fail open; supersedes EX3-125's failed render).
 */
export const NO_ANALOGY_REASON =
  'The analogy writer returned no usable analogy in three calls. The topic stays in the pool; the next render tries again.';

const GATE_MISS: Record<(typeof ANALOGY_GATE_KEYS)[number], string> = {
  false_mapping: 'its mapping teaches something false or misleading',
  is_the_system: 'it is the real system at work, not a comparison',
  real_names: 'it names a real brand, person or character',
};

/** Sentences, split where a full stop, question or exclamation mark is followed by a capital or a digit. */
export function sentenceCount(text: string): number {
  return String(text)
    .trim()
    .split(/(?<=[.!?])["”’')\]]*\s+(?=["“‘(]?[\p{Lu}\p{N}])/u)
    .filter((s) => s.trim()).length;
}

/** The name, lowercased, without punctuation or a leading article: two calls that agree match on it. */
export function normalizeAnalogyName(name: string): string {
  return String(name)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/^\s*(the|a|an)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sameAnalogy(a: Pick<AnalogyCandidate, 'name'>, b: Pick<AnalogyCandidate, 'name'>): boolean {
  return normalizeAnalogyName(a.name) !== '' && normalizeAnalogyName(a.name) === normalizeAnalogyName(b.name);
}

const said = (text: string, term: string) => {
  const t = term.trim().toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ');
  return Boolean(t) && ` ${text.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ')} `.includes(` ${t} `);
};

/**
 * The rules code checks before any Jev spend: a name, two or three sentences, three to six complete
 * rows, and the term never echoed in the name or the analogy's side of the mapping (the analogy is a
 * comparison, never the concept renamed). Empty when it passes.
 */
export function analogyCheckProblems(candidate: AnalogyCandidate, term: string): string[] {
  const out: string[] = [];
  if (!candidate.name.trim()) out.push('it has no name');
  const sentences = sentenceCount(candidate.explanation);
  if (sentences < MIN_ANALOGY_SENTENCES || sentences > MAX_ANALOGY_SENTENCES) {
    out.push(`its explanation is ${sentences} sentences (${MIN_ANALOGY_SENTENCES} or ${MAX_ANALOGY_SENTENCES})`);
  }
  const rows = candidate.mapping.length;
  if (rows < MIN_ANALOGY_ROWS || rows > MAX_ANALOGY_ROWS) out.push(`its mapping has ${rows} rows (${MIN_ANALOGY_ROWS} to ${MAX_ANALOGY_ROWS})`);
  if (candidate.mapping.some((row) => !row.analogy || !row.concept)) out.push('a mapping row is missing a side');
  if (said(candidate.name, term)) out.push(`its name says the term "${term}"`);
  const echoed = candidate.mapping.filter((row) => said(row.analogy, term));
  if (echoed.length) out.push(`its mapping's analogy side says the term "${term}" (${echoed.map((r) => r.analogy).join('; ')})`);
  return out;
}

/** Why the gates fail a candidate; empty when it passes all three. */
export function gateMisses(gates: AnalogyGates): string[] {
  return ANALOGY_GATE_KEYS.filter((key) => gates[key] >= ANALOGY_GATE_MAX).map((key) => GATE_MISS[key]);
}

/**
 * The swapped-order comparison (EX3-124): Jev is asked "is the first more repeatable than the
 * second?" in both orders. The first's score is the mean of the two readings; it wins at 0.5 or more.
 */
export function compareScore(firstOverSecond: number, secondOverFirst: number): number {
  return Math.round(((firstOverSecond + 1 - secondOverFirst) / 2) * 1000) / 1000;
}

/** The candidate a note picked, or null. */
function pickedTry(note: AnalogyNote): AnalogyTry | null {
  if (!('pick' in note)) return null;
  return (note.pick === 2 ? note.third : note.candidates[note.pick]) ?? null;
}

/**
 * The topic's picked analogy, or null when it has none: never picked, the pass failed, nothing passed,
 * or it came from an older analogy writer (EX3-31), so the render picks again.
 */
export function topicAnalogy(topic: Pick<TopicRow, 'jev_notes'>): AnalogyCandidate | null {
  const note = (topic.jev_notes as { analogy?: AnalogyNote } | null)?.analogy;
  if (!note || note.version !== ANALOGY_WRITER_VERSION) return null;
  return pickedTry(note)?.analogy ?? null;
}

/**
 * Fail open (Explainers 4.2; Lucas, 2026-10-27: "I don't want things to block the reel"): when nothing
 * passed in three calls, the least-bad candidate the writer returned, with why it missed. Gated
 * candidates come before ones the code checks refused; then the fewest misses; then the lowest summed
 * gate probabilities. Null only when no call returned a usable analogy.
 */
export function leastBadAnalogy(note: AnalogyNote): { analogy: AnalogyCandidate; misses: string[] } | null {
  if (!('candidates' in note)) return null;
  const tries = [...note.candidates, ...(note.third ? [note.third] : [])].filter((t): t is AnalogyTry & { analogy: AnalogyCandidate } => Boolean(t.analogy));
  const rank = (t: AnalogyTry) => [t.gates ? 0 : 1, t.misses.length, t.gates ? ANALOGY_GATE_KEYS.reduce((sum, k) => sum + t.gates![k], 0) : 0];
  const best = tries
    .map((t, i) => ({ t, i, r: rank(t) }))
    .sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1] || a.r[2] - b.r[2] || a.i - b.i)[0];
  return best ? { analogy: best.t.analogy, misses: best.t.misses } : null;
}

/** True when this writer's three calls produced nothing that passed (EX3-125). */
export function analogyBelowBar(note: AnalogyNote | null | undefined): boolean {
  return Boolean(note && note.version === ANALOGY_WRITER_VERSION && 'below_bar' in note && note.below_bar);
}

/** The pick as BRIEF.md's `## Analogy` body: the name, the explanation, and the mapping table. */
export function analogyMarkdown(candidate: AnalogyCandidate): string {
  const cell = (text: string) => text.replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ');
  return [
    `Name: ${candidate.name}`,
    '',
    candidate.explanation,
    '',
    '| Analogy | Concept |',
    '|---|---|',
    ...candidate.mapping.map((row) => `| ${cell(row.analogy)} | ${cell(row.concept)} |`),
    '',
    'The reel shows the first three or four rows.',
  ].join('\n');
}

export type AnalogyDeps = {
  db: Queryable;
  jev: ExplainersJevRunner;
  ideaModel: IdeaModel;
  /** The analogy writer's model (`analogy_model`, Opus by default; EX3-123). */
  model: string;
  mode: Mode;
  /** The idea cycle the pass belongs to, when the daily cycle runs it. */
  ideaCycleId?: string | null;
  /** The render it belongs to, when a Generate click runs it (EX3-31). */
  jobId?: string | null;
  now?: Date;
};

type AnalogyTopic = Pick<TopicRow, 'id' | 'title' | 'scope' | 'term'>;

async function saveNote(db: Queryable, topicId: string, note: AnalogyNote): Promise<void> {
  await db.query(
    `UPDATE explainers.topics
        SET jev_notes = COALESCE(jev_notes, '{}'::jsonb) || jsonb_build_object('analogy', $2::jsonb),
            updated_at = now()
      WHERE id = $1`,
    [topicId, JSON.stringify(note)],
  );
}

const noul = (answers: unknown, key: string, what: string): number => {
  const p = (answers as Record<string, { noul?: number }>)[key]?.noul;
  if (typeof p !== 'number' || !Number.isFinite(p)) throw new Error(`Jev returned no ${key} answer for ${what}`);
  return p;
};

/** The golden concepts Jev matched to this topic's concept, left out of the writer's prompt (EX3-124). */
export async function hiddenGolden(deps: Pick<AnalogyDeps, 'jev'>, topic: AnalogyTopic): Promise<string[]> {
  const scope = topic.scope ?? topic.title;
  const verdicts = await Promise.all(
    GOLDEN_ANALOGIES.map(async (g) => {
      const result = await deps.jev.ask({
        component: 'analogy_golden_match',
        state: { topic_title: topic.title, topic_scope: scope, example_concept: g.concept, example: `${g.name}: ${g.text}` },
        set: GOLDEN_MATCH,
        questions: GOLDEN_MATCH.questions,
        topicId: topic.id,
      });
      return noul(result.answers, 'same_concept', 'a golden example') >= GOLDEN_HIDE_AT;
    }),
  );
  return GOLDEN_ANALOGIES.filter((_, i) => verdicts[i]).map((g) => g.concept);
}

/** The analogy as Jev reads it: the name, the explanation, and the mapping. */
export function analogyText(candidate: AnalogyCandidate): string {
  return [`${candidate.name}`, candidate.explanation, ...candidate.mapping.map((row) => `- ${row.analogy}: ${row.concept}`)].join('\n');
}

/** One writer call, checked and gated. A reply that cannot be read is a failed candidate, not a failed pass. */
async function writeOne(deps: AnalogyDeps, topic: AnalogyTopic, hidden: string[]): Promise<AnalogyTry> {
  const scope = topic.scope ?? topic.title;
  const term = topic.term?.trim() || topic.title;
  let candidate: AnalogyCandidate;
  try {
    const response = await deps.ideaModel.writeAnalogy({ model: deps.model, term, scope, hidden });
    await recordCost(deps.db, {
      jobId: deps.jobId ?? null,
      ideaCycleId: deps.ideaCycleId ?? null,
      mode: deps.mode,
      vendor: 'anthropic',
      component: 'analogy_writer',
      inputTokens: Number(response.usage.input_tokens ?? 0),
      outputTokens: Number(response.usage.output_tokens ?? 0),
      cacheReadTokens: Number(response.usage.cache_read_input_tokens ?? 0),
      cacheWriteTokens: Number(response.usage.cache_creation_input_tokens ?? 0),
      usd: ideaUsd(response),
    });
    candidate = response.candidate;
  } catch (error) {
    return { analogy: null, gates: null, misses: [`the writer's reply could not be used: ${error instanceof Error ? error.message : String(error)}`] };
  }
  const problems = analogyCheckProblems(candidate, term);
  if (problems.length) return { analogy: candidate, gates: null, misses: problems };
  const result = await deps.jev.ask({
    component: 'analogy_gates',
    state: { topic_title: topic.title, topic_scope: scope, term, analogy: analogyText(candidate) },
    set: ANALOGY_GATES,
    questions: ANALOGY_GATES.questions,
    topicId: topic.id,
  });
  const gates = {} as AnalogyGates;
  for (const key of ANALOGY_GATE_KEYS) gates[key] = noul(result.answers, key, 'an analogy');
  return { analogy: candidate, gates, misses: gateMisses(gates) };
}

/** Jev's swapped-order comparison of two passing candidates (EX3-124). */
async function compare(deps: AnalogyDeps, topic: AnalogyTopic, first: AnalogyCandidate, second: AnalogyCandidate): Promise<AnalogyComparison> {
  const subject = `${topic.title} — ${topic.scope ?? topic.title}`;
  const ask = async (a: AnalogyCandidate, b: AnalogyCandidate) => {
    const result = await deps.jev.ask({
      component: 'analogy_compare',
      state: { topic: subject, a: analogyText(a), b: analogyText(b) },
      set: ANALOGY_COMPARE,
      questions: ANALOGY_COMPARE.questions,
      topicId: topic.id,
    });
    return noul(result.answers, 'a_over_b', 'an analogy comparison');
  };
  const [firstOverSecond, secondOverFirst] = await Promise.all([ask(first, second), ask(second, first)]);
  return { first_over_second: firstOverSecond, second_over_first: secondOverFirst, first_score: compareScore(firstOverSecond, secondOverFirst) };
}

/**
 * Hide, write twice, check, gate and pick; a third call when neither passes. Everything is stored on
 * the topic as `jev_notes.analogy`. Nothing passes: `below_bar`, and the caller keeps the topic.
 */
export async function chooseAnalogy(deps: AnalogyDeps, topic: AnalogyTopic): Promise<AnalogyNote> {
  const now = () => (deps.now ?? new Date()).toISOString();
  const hidden = await hiddenGolden(deps, topic);
  const candidates = await Promise.all(Array.from({ length: ANALOGY_CALLS }, () => writeOne(deps, topic, hidden)));
  const passed = candidates.flatMap((c, i) => (c.misses.length === 0 && c.analogy ? [i as 0 | 1] : []));
  const base = { version: ANALOGY_WRITER_VERSION, golden_hidden: hidden, candidates };

  let note: AnalogyNote;
  if (passed.length === 2) {
    const [a, b] = [candidates[0].analogy!, candidates[1].analogy!];
    if (sameAnalogy(a, b)) {
      note = { ...base, pick: 0, pick_reason: 'same', picked_at: now() };
    } else {
      const comparison = await compare(deps, topic, a, b);
      note = { ...base, comparison, pick: comparison.first_score >= 0.5 ? 0 : 1, pick_reason: 'compared', picked_at: now() };
    }
  } else if (passed.length === 1) {
    note = { ...base, pick: passed[0], pick_reason: 'only_pass' as AnalogyPickReason, picked_at: now() };
  } else {
    const third = await writeOne(deps, topic, hidden);
    note =
      third.misses.length === 0 && third.analogy
        ? { ...base, third, pick: 2, pick_reason: 'third', picked_at: now() }
        : { ...base, third, below_bar: true, checked_at: now() };
  }
  await saveNote(deps.db, topic.id, note);
  return note;
}

/**
 * The idea cycle's version: a failure is recorded on the topic and never stops the cycle
 * (EX3-30); the render runs the pass again.
 */
export async function chooseAnalogySafely(deps: AnalogyDeps, topic: AnalogyTopic): Promise<AnalogyNote> {
  try {
    return await chooseAnalogy(deps, topic);
  } catch (error) {
    const note: AnalogyNote = {
      version: ANALOGY_WRITER_VERSION,
      error: error instanceof Error ? error.message : String(error),
      failed_at: (deps.now ?? new Date()).toISOString(),
    };
    await saveNote(deps.db, topic.id, note);
    return note;
  }
}
