import type { Queryable } from '@/lib/explainers/db';
import { GAP_WRITER_VERSION, GAP_MAX_WORDS, GAP_MIN_WORDS, ideaUsd, type IdeaModel } from '@/lib/explainers/ideas/generator';
import { analogyText } from '@/lib/explainers/ideas/analogy';
import type { ExplainersJevRunner } from '@/lib/explainers/jev/runner';
import { GAP_GATE, GAP_SCORING } from '@/lib/explainers/jev/questions/gap-scoring';
import { recordCost } from '@/lib/explainers/repository';
import { GAP_KEYS, type AnalogyCandidate, type GapCandidate, type GapKey, type GapNote, type GapPass, type GapScores, type Mode, type TopicRow } from '@/lib/explainers/types';
import { countWords, quotedSpans, stem, TOSS_RE } from '../../../explainers/lint/lint-storyboard.mjs';

/**
 * The curiosity gap is written for the most pull and picked by Jev (Explainers 3.8, EX3-120; Lucas,
 * 2026-10-22: "the curiosity gap writer should now write 3 candidates that jev then picks"). Right
 * after a topic's analogy is picked, the gap writer proposes three lines; code checks each against
 * the hard rules, Jev scores the rest on pull, clarity and closable plus a false-claim gate, and code
 * picks one. None can be picked: one more pass, told why. Still none: the render fails, saying so; the
 * topic stays (a new pass may do better). The pick is BRIEF.md's `## Curiosity gap`, and the director
 * says it word for word in frame 2.
 */

/** Points out of 100: pull leads (EX3-120: "the most engagement"). */
export const GAP_POINTS: Record<GapKey, number> = { pull: 50, clarity: 25, closable: 25 };
/** A pick is understood on one listen and answered by the analogy: at least 3 of 4 (the old "4 of 5"). */
export const GAP_FLOORS: Partial<Record<GapKey, number>> = { clarity: 3, closable: 3 };
/** The false-claim gate: at or above this, the line is not picked. */
export const FALSE_CLAIM_MAX = 0.5;
/** The first pass and one retry. */
export const MAX_GAP_PASSES = 2;
export const GAP_BELOW_BAR_REASON = `No curiosity gap could be picked after ${MAX_GAP_PASSES} tries (EX3-120).`;

const fmt = (n: number) => String(Math.round(n * 100) / 100);

export function gapTotal(scores: GapScores): number {
  let total = 0;
  for (const key of GAP_KEYS) total += (scores[key] / 4) * GAP_POINTS[key];
  return Math.round(total * 1000) / 1000;
}

/**
 * Words that never name the analogy's world. gap-writer-v2's mapping rows are whole phrases ("so you
 * go to the store"), not short element names, so pronouns, time words and everyday verbs are skipped
 * too (the cache reel's first live run lost every line to "you" and "second"). Compared after `stem`.
 */
const STOP = new Set([
  'the', 'a', 'an', 'of', 'and', 'or', 'with', 'its', 'on', 'in', 'to', 'for', 'one', 'two', 'three', 'four', 'big', 'small', 'little', 'tiny', 'each', 'every', 'that', 'this', 'from', 'into', 'their', 'his', 'her',
  'you', 'your', 'yours', 'they', 'them', 'she', 'him', 'who', 'what', 'when', 'where', 'why', 'how', 'which', 'there', 'here', 'then', 'than', 'just', 'only', 'also', 'too', 'very', 'more', 'most', 'less', 'some', 'any', 'all', 'other', 'another', 'same', 'new', 'old', 'not', 'never', 'ever', 'still', 'again', 'back', 'first', 'last', 'next', 'once', 'off', 'out', 'over', 'down', 'while', 'without', 'instead', 'before', 'after', 'because', 'but', 'so', 'if', 'can', 'will', 'would', 'could', 'should', 'does', 'did', 'done', 'doe', 'have', 'has', 'had', 'get', 'got', 'make', 'made', 'take', 'use', 'come', 'goe', 'going', 'keep', 'kept', 'time', 'second', 'minute', 'hour', 'day', 'way', 'thing', 'someone', 'something', 'everyone', 'nobody', 'people', 'right', 'away',
]);

/** The content words of a text, stemmed. */
function words(text: string, skip: Set<string>): Set<string> {
  return new Set(
    String(text)
      .split(/[^\p{L}\p{N}']+/u)
      .map((w) => stem(w))
      .filter((w) => w.length >= 3 && !STOP.has(w) && !skip.has(w)),
  );
}

/**
 * The hard rules code can check before any Jev spend (gap writer constraints 2, 4, 5, 6): ends on its
 * question, no toss, no term, the word range, and nothing from the analogy: its name or the analogy
 * side of its mapping (gap-writer-v2); and no quotation marks (Explainers 4.1 round 2: the line is
 * said word for word, and a listener cannot hear quotes, EX3-106, so the voice lint refuses them).
 * Empty when it passes.
 */
export function gapCheckProblems(candidate: GapCandidate, input: { term: string; analogy: Pick<AnalogyCandidate, 'name' | 'mapping'>; topic?: string }): string[] {
  const out: string[] = [];
  const line = candidate.line.trim().replace(/["”’']+$/, '');
  const last = line.split(/(?<=[.?!])\s+/).pop() ?? '';
  if (!line.endsWith('?')) out.push('does not end on its question');
  else if (last.trim().replace(/[^\p{L}\p{N}?]+/gu, ' ').toLowerCase() !== candidate.question.trim().replace(/["”’']+$/, '').replace(/[^\p{L}\p{N}?]+/gu, ' ').toLowerCase()) {
    out.push('its question is not the last sentence of the line');
  }
  const quoted = quotedSpans(line);
  if (quoted.length) out.push(`puts words in quotation marks (${quoted.map((q) => `"${q}"`).join(', ')}): the line is said word for word, so say the words with no quotes`);
  const toss = TOSS_RE.exec(line);
  if (toss) out.push(`tosses to the next beat ("${toss[0]}")`);
  const term = input.term.trim().toLowerCase();
  if (term && ` ${line.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ')} `.includes(` ${term.replace(/[^\p{L}\p{N}' ]+/gu, ' ')} `)) out.push(`says the term "${input.term}"`);
  const n = countWords(line);
  if (n < GAP_MIN_WORDS || n > GAP_MAX_WORDS) out.push(`${n} words (${GAP_MIN_WORDS} to ${GAP_MAX_WORDS})`);
  const termWords = words(input.term, new Set());
  // A word the real technology shares with the analogy is not the analogy's world: skip what the
  // topic, the term, and the mapping's concept side say (DNS: a "numbered page" stands for a
  // "numeric IP address", so "number" is the real thing too).
  const real = words([input.term, input.topic ?? '', ...input.analogy.mapping.map((row) => row.concept)].join(' '), new Set());
  // Word families match loosely, on the first three letters of words of five or more ("numbered"
  // and "numeric"). A missed leak is caught later by the lint (gap_scene) and the director's picture.
  const family = (w: string) => (w.length >= 5 ? w.slice(0, 3) : w);
  const realFamilies = new Set([...real].map(family));
  const isReal = (w: string) => real.has(w) || realFamilies.has(family(w));
  const spoken = new Set([...words(line, new Set())].filter((w) => !isReal(w)));
  const named = [input.analogy.name, ...input.analogy.mapping.map((row) => row.analogy)].flatMap((text) => [...words(text, new Set())].filter((w) => !isReal(w) && spoken.has(w)));
  if (named.length) out.push(`names the analogy's world (${[...new Set(named)].join(', ')})`);
  return out;
}

/** Why a scored candidate cannot be picked; empty when it can. */
export function gapMisses(scores: GapScores, falseClaim: number): string[] {
  const out: string[] = [];
  for (const key of GAP_KEYS) {
    const floor = GAP_FLOORS[key];
    if (floor !== undefined && scores[key] < floor) out.push(`${key} ${fmt(scores[key])} of 4, under ${floor}`);
  }
  if (falseClaim >= FALSE_CLAIM_MAX) out.push('may state something untrue');
  return out;
}

/** Index of the best candidate among those given: the highest total, then pull, clarity, closable; ties keep the earlier one. */
export function pickGap(scores: readonly GapScores[]): number {
  if (scores.length === 0) throw new Error('no gap candidates to pick from');
  let best = 0;
  for (let i = 1; i < scores.length; i += 1) {
    const order: number[][] = [[gapTotal(scores[i]), gapTotal(scores[best])], ...GAP_KEYS.map((key) => [scores[i][key], scores[best][key]])];
    for (const [a, b] of order) {
      if (a !== b) {
        if (a > b) best = i;
        break;
      }
    }
  }
  return best;
}

/** The topic's gap note when it holds a current pick for this analogy; null when never picked, failed, older, or written for another analogy. */
export function topicGapNote(topic: Pick<TopicRow, 'jev_notes'>, analogy: Pick<AnalogyCandidate, 'name'> | null): GapNote | null {
  const note = (topic.jev_notes as { gap?: GapNote } | null)?.gap;
  if (!note || note.version !== GAP_WRITER_VERSION || !('pick' in note) || !analogy || note.analogy_name !== analogy.name) return null;
  return note.passes[note.pick.pass]?.candidates[note.pick.index] ? note : null;
}

/** The topic's picked gap for this analogy, or null. */
export function topicGap(topic: Pick<TopicRow, 'jev_notes'>, analogy: Pick<AnalogyCandidate, 'name'> | null): GapCandidate | null {
  const note = topicGapNote(topic, analogy);
  return note && 'pick' in note ? note.passes[note.pick.pass].candidates[note.pick.index] : null;
}

export function gapBelowBar(note: GapNote | null | undefined): boolean {
  return Boolean(note && note.version === GAP_WRITER_VERSION && 'below_bar' in note && note.below_bar);
}

/** BRIEF.md's `## Curiosity gap` body: the pick, said word for word, and the others for reference. */
export function gapMarkdown(note: GapNote): string {
  if (!('pick' in note)) return '';
  const pass = note.passes[note.pick.pass];
  const pick = pass.candidates[note.pick.index];
  const lines = [
    'Say this line in frame 2, word for word (written by the gap writer, picked by Jev, EX3-120):',
    '',
    `> ${pick.line}`,
    '',
    `- gap_question: ${pick.question}`,
    `- way in: ${pick.way_in}`,
    ...(pass.totals[note.pick.index] !== null ? [`- score: ${fmt(pass.totals[note.pick.index] as number)} of 100`] : []),
    '',
    'The other candidates (for reference only; never use them):',
    ...pass.candidates.flatMap((c, i) =>
      i === note.pick.index ? [] : [`- "${c.line}" (${pass.totals[i] !== null ? `${fmt(pass.totals[i] as number)} of 100` : 'not scored'}${pass.misses[i].length ? `; ${pass.misses[i].join('; ')}` : ''})`],
    ),
  ];
  return lines.join('\n');
}

export type GapDeps = {
  db: Queryable;
  jev: ExplainersJevRunner;
  ideaModel: IdeaModel;
  model: string;
  mode: Mode;
  themeBrief: string;
  ideaCycleId?: string | null;
  jobId?: string | null;
  now?: Date;
};

type GapTopic = Pick<TopicRow, 'id' | 'title' | 'scope' | 'term'>;

async function saveNote(db: Queryable, topicId: string, note: GapNote): Promise<void> {
  await db.query(
    `UPDATE explainers.topics
        SET jev_notes = COALESCE(jev_notes, '{}'::jsonb) || jsonb_build_object('gap', $2::jsonb),
            updated_at = now()
      WHERE id = $1`,
    [topicId, JSON.stringify(note)],
  );
}

async function writePass(deps: GapDeps, topic: GapTopic, analogy: AnalogyCandidate, previous: GapPass[]): Promise<GapPass> {
  const scope = topic.scope ?? topic.title;
  const term = topic.term ?? '';
  const response = await deps.ideaModel.writeGaps({
    model: deps.model,
    themeBrief: deps.themeBrief,
    title: topic.title,
    scope,
    term,
    analogy,
    ...(previous.length ? { retry: { previous: previous.flatMap((p) => p.candidates.map((c, i) => ({ line: c.line, misses: p.misses[i] }))) } } : {}),
  });
  await recordCost(deps.db, {
    jobId: deps.jobId ?? null,
    ideaCycleId: deps.ideaCycleId ?? null,
    mode: deps.mode,
    vendor: 'anthropic',
    component: 'gap_writer',
    inputTokens: Number(response.usage.input_tokens ?? 0),
    outputTokens: Number(response.usage.output_tokens ?? 0),
    cacheReadTokens: Number(response.usage.cache_read_input_tokens ?? 0),
    cacheWriteTokens: Number(response.usage.cache_creation_input_tokens ?? 0),
    usd: ideaUsd(response),
  });

  const pass: GapPass = { candidates: response.candidates, checks: [], scores: [], totals: [], false_claim: [], misses: [] };
  for (const candidate of response.candidates) {
    const problems = gapCheckProblems(candidate, { term, analogy, topic: `${topic.title} ${scope}` });
    pass.checks.push(problems);
    if (problems.length) {
      pass.scores.push(null);
      pass.totals.push(null);
      pass.false_claim.push(null);
      pass.misses.push(problems);
      continue;
    }
    const state = { topic_title: topic.title, topic_scope: scope, term, analogy: analogyText(analogy), candidate: candidate.line };
    const result = await deps.jev.ask({ component: 'gap_scoring', state, set: GAP_SCORING, questions: GAP_SCORING.questions, topicId: topic.id });
    const answers = result.answers as Record<string, { score: number }>;
    const row = {} as GapScores;
    for (const key of GAP_KEYS) {
      const value = answers[key]?.score;
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Jev returned no ${key} score for a gap`);
      row[key] = Math.min(4, Math.max(0, value));
    }
    const gate = await deps.jev.ask({ component: 'gap_gate', state, set: GAP_GATE, questions: GAP_GATE.questions, topicId: topic.id });
    const p = (gate.answers as Record<string, { noul?: number }>).false_claim?.noul;
    if (typeof p !== 'number' || !Number.isFinite(p)) throw new Error('Jev returned no false_claim answer for a gap');
    pass.scores.push(row);
    pass.totals.push(gapTotal(row));
    pass.false_claim.push(p);
    pass.misses.push(gapMisses(row, p));
  }
  return pass;
}

/** Write, check, score and pick, up to two passes, and store it all on the topic as `jev_notes.gap`. */
export async function chooseGap(deps: GapDeps, topic: GapTopic, analogy: AnalogyCandidate): Promise<GapNote> {
  const passes: GapPass[] = [];
  for (let attempt = 1; attempt <= MAX_GAP_PASSES; attempt += 1) {
    const pass = await writePass(deps, topic, analogy, passes);
    passes.push(pass);
    const eligible = pass.misses.flatMap((m, i) => (m.length === 0 && pass.scores[i] ? [i] : []));
    if (eligible.length > 0) {
      const index = eligible[pickGap(eligible.map((i) => pass.scores[i] as GapScores))];
      const note: GapNote = { version: GAP_WRITER_VERSION, analogy_name: analogy.name, passes, pick: { pass: passes.length - 1, index }, picked_at: (deps.now ?? new Date()).toISOString() };
      await saveNote(deps.db, topic.id, note);
      return note;
    }
  }
  const note: GapNote = { version: GAP_WRITER_VERSION, analogy_name: analogy.name, passes, below_bar: true, checked_at: (deps.now ?? new Date()).toISOString() };
  await saveNote(deps.db, topic.id, note);
  return note;
}

/** The idea cycle's version: a failure is recorded on the topic and never stops the cycle; the render runs it again. */
export async function chooseGapSafely(deps: GapDeps, topic: GapTopic, analogy: AnalogyCandidate): Promise<GapNote> {
  try {
    return await chooseGap(deps, topic, analogy);
  } catch (error) {
    const note: GapNote = { version: GAP_WRITER_VERSION, analogy_name: analogy.name, error: error instanceof Error ? error.message : String(error), failed_at: (deps.now ?? new Date()).toISOString() };
    await saveNote(deps.db, topic.id, note);
    return note;
  }
}
