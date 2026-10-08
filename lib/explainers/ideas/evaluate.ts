import type { Questions } from '@typesafe-ai/sdk';

import type { ExplainersDb } from '@/lib/explainers/db';
import type { ExplainersJevRunner } from '@/lib/explainers/jev/runner';
import {
  DUPLICATE_GATE,
  DUPLICATE_PAIRS,
  DUPLICATE_YES,
  PAIR_KEYS,
} from '@/lib/explainers/jev/questions/duplicate';
import { IDEA_SCORING, IDEA_SCORING_FIELDS } from '@/lib/explainers/jev/questions/idea-scoring';
import { getTopic, listPool, listRecentlyRendered } from '@/lib/explainers/repository';
import { failedGates, weightedScore, type TopicScores } from '@/lib/explainers/scoring';
import type { ExplainersSettings } from '@/lib/explainers/settings';
import { SCORE_KEYS, type ScoreKey, type TopicRow } from '@/lib/explainers/types';
import { untrusted } from '@/lib/reels/jev/state';

export type EvaluateDeps = {
  db: ExplainersDb;
  jev: ExplainersJevRunner;
  settings: ExplainersSettings;
  themeBrief: string;
  now?: Date;
};

export type TopicRef = { topic_title: string; topic_scope: string | null };

export function topicRef(topic: Pick<TopicRow, 'title' | 'scope'>): TopicRef {
  return { topic_title: topic.title, topic_scope: topic.scope };
}

// ── Scoring states (pure) ───────────────────────────────────────────────────

type StateValue = string | { untrusted_content: string } | null;

function fieldValue(
  field: (typeof IDEA_SCORING_FIELDS)[ScoreKey][number],
  topic: Pick<TopicRow, 'title' | 'scope' | 'source_text'>,
  themeBrief: string,
): [string, StateValue] | null {
  switch (field) {
    case 'topic_title':
      return ['topic_title', topic.title];
    case 'topic_scope':
      return ['topic_scope', topic.scope];
    case 'theme_brief':
      return ['theme_brief', themeBrief];
    case 'source_text, if present':
      // Source text is untrusted input; it goes under an explicit key.
      return topic.source_text ? ['source_text', untrusted(topic.source_text)] : null;
  }
}

export type ScoringCall = { keys: ScoreKey[]; state: Record<string, StateValue> };

/**
 * Each E-15 question sees only the state fields the packet lists for it.
 * Questions whose resulting state is identical share one call. With no source
 * text that is three calls; with source text, also three (Q2/Q4/Q5 gain it).
 */
export function scoringCalls(
  topic: Pick<TopicRow, 'title' | 'scope' | 'source_text'>,
  themeBrief: string,
): ScoringCall[] {
  const calls = new Map<string, ScoringCall>();
  for (const key of SCORE_KEYS) {
    const state: Record<string, StateValue> = {};
    for (const field of IDEA_SCORING_FIELDS[key]) {
      const entry = fieldValue(field, topic, themeBrief);
      if (entry) state[entry[0]] = entry[1];
    }
    const id = JSON.stringify(state);
    const call = calls.get(id);
    if (call) call.keys.push(key);
    else calls.set(id, { keys: [key], state });
  }
  return [...calls.values()];
}

function subset<Q extends Questions>(questions: Q, keys: readonly string[]): Questions {
  const out: Questions = {};
  for (const key of keys) out[key] = questions[key as keyof Q] as Questions[string];
  return out;
}

export async function scoreTopic(deps: EvaluateDeps, topic: TopicRow): Promise<TopicScores> {
  const scores = {} as TopicScores;
  for (const call of scoringCalls(topic, deps.themeBrief)) {
    const result = await deps.jev.ask({
      component: 'idea_scoring',
      state: call.state,
      set: IDEA_SCORING,
      questions: subset(IDEA_SCORING.questions, call.keys),
      topicId: topic.id,
    });
    const answers = result.answers as Record<string, { score: number }>;
    for (const key of call.keys) {
      const value = answers[key]?.score;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Jev returned no score for ${key}`);
      }
      scores[key] = Math.min(4, Math.max(0, value));
    }
  }
  return scores;
}

// ── Duplicate stages (A-3) ──────────────────────────────────────────────────

/** Stage 1: one noul against the whole history. No history, no call. */
export async function duplicatesHistory(
  deps: EvaluateDeps,
  candidate: TopicRow,
  history: readonly TopicRow[],
): Promise<boolean> {
  if (history.length === 0) return false;
  const result = await deps.jev.ask({
    component: 'duplicate_gate',
    state: { candidate: topicRef(candidate), history: history.map(topicRef) },
    set: DUPLICATE_GATE,
    questions: DUPLICATE_GATE.questions,
    topicId: candidate.id,
  });
  return result.answers.duplicate_of_existing_topic.noul >= DUPLICATE_YES;
}

export function batchesOfFive<T>(items: readonly T[]): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += PAIR_KEYS.length) {
    batches.push(items.slice(i, i + PAIR_KEYS.length));
  }
  return batches;
}

/**
 * Stage 2: the ranked pool in batches of 5, one call per batch, stopping at
 * the first batch with a match. Returns that batch's matches, best-ranked
 * first; empty means no pool topic matched.
 */
export async function findPoolMatches(
  deps: EvaluateDeps,
  candidate: TopicRow,
  rankedPool: readonly TopicRow[],
): Promise<TopicRow[]> {
  for (const batch of batchesOfFive(rankedPool)) {
    const keys = PAIR_KEYS.slice(0, batch.length);
    const incumbents: Record<string, TopicRef> = {};
    keys.forEach((key, i) => {
      incumbents[key] = topicRef(batch[i]);
    });
    const result = await deps.jev.ask({
      component: 'duplicate_pairs',
      state: { candidate: topicRef(candidate), incumbents },
      set: DUPLICATE_PAIRS,
      questions: subset(DUPLICATE_PAIRS.questions, keys),
      topicId: candidate.id,
    });
    const answers = result.answers as Record<string, { noul: number }>;
    const matches = batch.filter((_, i) => (answers[keys[i]]?.noul ?? 0) >= DUPLICATE_YES);
    if (matches.length > 0) return matches;
  }
  return [];
}

// ── Ranking (pure; mirrors POOL_ORDER_BY) ───────────────────────────────────

const TIE_BREAKS: ScoreKey[] = [
  'teachability_45s',
  'accuracy_under_simplification',
  'audience_fit',
  'visual_potential',
  'hook_strength',
];

type Ranked = Pick<TopicRow, 'weighted_score' | ScoreKey>;

/**
 * Positive when `challenger` outranks `incumbent`. An exact tie on the score
 * and every tie-break keeps the incumbent (E-16 exact_tie_rule).
 */
export function challengerWins(challenger: Ranked, incumbent: Ranked): boolean {
  const order: (keyof Ranked)[] = ['weighted_score', ...TIE_BREAKS];
  for (const key of order) {
    const a = challenger[key] ?? -1;
    const b = incumbent[key] ?? -1;
    if (a !== b) return a > b;
  }
  return false;
}

// ── One candidate, end to end ───────────────────────────────────────────────

export type Evaluation =
  | { outcome: 'not_proposed' }
  | { outcome: 'rejected_history_duplicate' }
  | { outcome: 'rejected_gates'; gates: ScoreKey[]; score: number }
  | { outcome: 'entered_pool'; score: number }
  | { outcome: 'won_head_to_head'; score: number; displacedId: string }
  | { outcome: 'lost_head_to_head'; score: number; winnerId: string };

async function saveScores(
  deps: EvaluateDeps,
  topicId: string,
  scores: TopicScores,
  score: number,
): Promise<void> {
  await deps.db.query(
    `UPDATE explainers.topics
        SET audience_fit = $2, teachability_45s = $3, analogy_potential = $4,
            visual_potential = $5, accuracy_under_simplification = $6, hook_strength = $7,
            weighted_score = $8, scored_at = now(), updated_at = now()
      WHERE id = $1`,
    [
      topicId,
      scores.audience_fit,
      scores.teachability_45s,
      scores.analogy_potential,
      scores.visual_potential,
      scores.accuracy_under_simplification,
      scores.hook_strength,
      score,
    ],
  );
}

async function setStatus(
  deps: EvaluateDeps,
  topicId: string,
  status: TopicRow['status'],
  extra: { reason?: string | null; duplicateOf?: string | null } = {},
): Promise<void> {
  await deps.db.query(
    `UPDATE explainers.topics
        SET status = $2, reject_reason = $3, duplicate_of = $4, updated_at = now()
      WHERE id = $1`,
    [topicId, status, extra.reason ?? null, extra.duplicateOf ?? null],
  );
}

/**
 * E-15 processing order for one proposed topic: duplicate logic, the six
 * scores, the gates, then the E-16 head-to-head if it duplicates a pool topic.
 */
export async function evaluateTopic(deps: EvaluateDeps, topicId: string): Promise<Evaluation> {
  const candidate = await getTopic(deps.db, topicId);
  if (!candidate || candidate.status !== 'proposed') return { outcome: 'not_proposed' };
  // Every topic gets its scope from the model alongside its title (A-9).
  if (!candidate.scope) throw new Error(`topic ${topicId} has no scope`);

  const pool = (await listPool(deps.db)).filter((t) => t.id !== topicId);
  const rendered = await listRecentlyRendered(deps.db, deps.settings.dedupe_lookback_days, deps.now);

  let match: TopicRow | null = null;
  if (await duplicatesHistory(deps, candidate, [...pool, ...rendered])) {
    const matches = await findPoolMatches(deps, candidate, pool);
    if (matches.length === 0) {
      await setStatus(deps, topicId, 'rejected', {
        reason: `Duplicates a topic rendered in the last ${deps.settings.dedupe_lookback_days} days.`,
      });
      return { outcome: 'rejected_history_duplicate' };
    }
    match = matches[0];
  }

  const scores = await scoreTopic(deps, candidate);
  const score = weightedScore(scores);
  await saveScores(deps, topicId, scores, score);

  const gates = failedGates(scores);
  if (gates.length > 0) {
    await setStatus(deps, topicId, 'rejected', { reason: `Failed gate: ${gates.join(', ')}.` });
    return { outcome: 'rejected_gates', gates, score };
  }

  if (!match) {
    await setStatus(deps, topicId, 'pool');
    return { outcome: 'entered_pool', score };
  }

  const scored = { ...candidate, ...scores, weighted_score: score };
  if (challengerWins(scored, match)) {
    await setStatus(deps, match.id, 'displaced', {
      reason: 'Lost a duplicate head-to-head.',
      duplicateOf: topicId,
    });
    await setStatus(deps, topicId, 'pool');
    return { outcome: 'won_head_to_head', score, displacedId: match.id };
  }
  await setStatus(deps, topicId, 'displaced', {
    reason: 'Lost a duplicate head-to-head.',
    duplicateOf: match.id,
  });
  return { outcome: 'lost_head_to_head', score, winnerId: match.id };
}

/** Keep the best `poolSize`; displace the rest (E-16 step 7). Returns how many. */
export async function trimPool(db: ExplainersDb, poolSize: number): Promise<number> {
  const pool = await listPool(db);
  const cut = pool.slice(poolSize);
  for (const topic of cut) {
    await db.query(
      `UPDATE explainers.topics
          SET status = 'displaced', reject_reason = 'Below the pool cut.', updated_at = now()
        WHERE id = $1`,
      [topic.id],
    );
  }
  return cut.length;
}
