import {
  BALL_KNOWLEDGE_BUMP,
  BLOCKBUSTER_BAR,
  BLOCKBUSTER_BONUS,
  CARRYOVER_MISSES,
  FRAMEWORK_GAP,
  SCORE_TOP_LEVEL,
  VIABLE_FRAMEWORK,
} from '@/lib/reels/config';
import { zoneDateParts } from '@/lib/reels/schedule';

/**
 * The scoring rules from D-074, D-075, D-076, D-077, D-079, D-080, and D-085.
 * Pure functions. They do not call Jev. Question wording lives in
 * lib/reels/jev/questions/scoring-pass1.ts and scoring-pass2.ts (approved, D-086).
 */

export const FRAMEWORK_IDS = ['curiosity', 'arousal', 'identity'] as const;
export type FrameworkId = (typeof FRAMEWORK_IDS)[number];

/** Spec order. This is also the bucket tie-break order (D-075). */
export const BUCKET_IDS = [
  'ball_knowledge',
  'the_number',
  'the_saga',
  'personal_profile',
  'the_warning',
  'the_callout',
] as const;
export type BucketId = (typeof BUCKET_IDS)[number];

/**
 * D-074. A viable framework opens every bucket that lists it, first or second.
 * Curiosity does not open The Callout. Identity does not open The Saga,
 * The Number, or The Warning.
 */
export const BUCKETS_FOR_FRAMEWORK: Record<FrameworkId, readonly BucketId[]> = {
  curiosity: ['ball_knowledge', 'the_number', 'the_saga', 'personal_profile', 'the_warning'],
  arousal: ['the_number', 'the_saga', 'the_warning', 'the_callout'],
  identity: ['ball_knowledge', 'personal_profile', 'the_callout'],
};

export const FRAMEWORKS_FOR_BUCKET: Record<BucketId, readonly FrameworkId[]> = {
  ball_knowledge: ['curiosity', 'identity'],
  the_number: ['arousal', 'curiosity'],
  the_saga: ['curiosity', 'arousal'],
  personal_profile: ['identity', 'curiosity'],
  the_warning: ['arousal', 'curiosity'],
  the_callout: ['identity', 'arousal'],
};

export type FrameworkScores = Record<FrameworkId, number>;

/** Compare thresholds at hundredths of a hundredth so 0.25 is exact. */
function units(score: number): number {
  return Math.round(score * 10_000);
}

const VIABLE_UNITS = units(VIABLE_FRAMEWORK);
const GAP_UNITS = units(FRAMEWORK_GAP);
const BLOCKBUSTER_UNITS = units(BLOCKBUSTER_BAR);

/** D-075. Raw Jev score on levels 0–SCORE_TOP_LEVEL, clamped onto 0–1. */
export function normalizeJevScore(raw: number, topLevel = SCORE_TOP_LEVEL): number {
  if (!Number.isFinite(raw) || !Number.isFinite(topLevel) || topLevel <= 0) {
    throw new Error('normalizeJevScore requires a finite raw score and a positive top level');
  }
  return Math.min(1, Math.max(0, raw / topLevel));
}

/** Frameworks at or above 0.60 that do not trail the leader by 0.25 or more. */
export function survivingFrameworks(scores: FrameworkScores): FrameworkId[] {
  const viable = FRAMEWORK_IDS.filter((id) => units(scores[id]) >= VIABLE_UNITS);
  if (viable.length === 0) return [];
  const leader = Math.max(...viable.map((id) => units(scores[id])));
  return viable.filter((id) => leader - units(scores[id]) < GAP_UNITS);
}

/** Union of the buckets those frameworks open, in spec order. */
export function openBuckets(frameworks: readonly FrameworkId[]): BucketId[] {
  const open = new Set<BucketId>();
  for (const framework of frameworks) {
    for (const bucket of BUCKETS_FOR_FRAMEWORK[framework]) open.add(bucket);
  }
  return BUCKET_IDS.filter((bucket) => open.has(bucket));
}

/**
 * The psychology number that would enter the net if this bucket won.
 * The higher surviving framework score among the frameworks the bucket lists.
 * A framework the gate dropped cannot supply it.
 */
export function psychologyTerm(
  bucket: BucketId,
  scores: FrameworkScores,
  surviving: readonly FrameworkId[],
): number {
  const eligible = FRAMEWORKS_FOR_BUCKET[bucket].filter((id) => surviving.includes(id));
  if (eligible.length === 0) {
    throw new Error(`Bucket ${bucket} has no surviving framework`);
  }
  return Math.max(...eligible.map((id) => scores[id]));
}

export type BucketJudgment = {
  bucket: BucketId;
  score: number;
  confidence: number;
};

/**
 * Highest bucket score. Ties break by psychology term, then bucket-score
 * confidence, then spec order (D-075). Buckets the gate did not open are ignored.
 */
export function pickBucket(
  judgments: readonly BucketJudgment[],
  scores: FrameworkScores,
  surviving: readonly FrameworkId[],
): BucketId | null {
  const open = new Set(openBuckets(surviving));
  const candidates = judgments.filter((judgment) => open.has(judgment.bucket));
  if (candidates.length === 0) return null;

  const ranked = [...candidates].sort((a, b) => {
    const byScore = units(b.score) - units(a.score);
    if (byScore !== 0) return byScore;
    const byPsych =
      units(psychologyTerm(b.bucket, scores, surviving)) -
      units(psychologyTerm(a.bucket, scores, surviving));
    if (byPsych !== 0) return byPsych;
    const byConfidence = units(b.confidence) - units(a.confidence);
    if (byConfidence !== 0) return byConfidence;
    return BUCKET_IDS.indexOf(a.bucket) - BUCKET_IDS.indexOf(b.bucket);
  });
  return ranked[0].bucket;
}

/** D-076. The net uses the higher of the two value scores. */
export function valueTerm(knowledge: number, entertainment: number): number {
  return Math.max(knowledge, entertainment);
}

/** D-077. One bonus if any subject question clears the bar. They do not stack. */
export function blockbusterBonus(nouls: {
  frontierDrop: number;
  company: number;
  person: number;
}): number {
  const hit = [nouls.frontierDrop, nouls.company, nouls.person].some(
    (probability) => units(probability) >= BLOCKBUSTER_UNITS,
  );
  return hit ? BLOCKBUSTER_BONUS : 0;
}

/** 0.08 when this story won as Ball Knowledge, otherwise 0. */
export function ballKnowledgeBump(bucket: BucketId | null): number {
  return bucket === 'ball_knowledge' ? BALL_KNOWLEDGE_BUMP : 0;
}

/** D-079. Straight sum. Cooldown is absent until publishing exists. */
export function netScore(parts: {
  psychology: number;
  bucket: number;
  value: number;
  blockbuster: number;
  ballKnowledge?: number;
}): number {
  return parts.psychology + parts.bucket + parts.value + parts.blockbuster + (parts.ballKnowledge ?? 0);
}

export type RankedIdea = {
  id: string;
  /** Null when no framework cleared 0.60. Those ideas are stored and never selected. */
  net: number | null;
  bucketScore: number;
  psychologyScore: number;
  /** Epoch milliseconds. Newer wins a tie that survived the score keys (D-085). */
  lastJoinedMs: number;
  /** Stored and shown. It does not change rank (D-085). */
  confidence: number;
};

function compareIdeas(a: RankedIdea, b: RankedIdea): number {
  const byNet = units(b.net ?? 0) - units(a.net ?? 0);
  if (byNet !== 0) return byNet;
  const byBucket = units(b.bucketScore) - units(a.bucketScore);
  if (byBucket !== 0) return byBucket;
  const byPsych = units(b.psychologyScore) - units(a.psychologyScore);
  if (byPsych !== 0) return byPsych;
  if (b.lastJoinedMs !== a.lastJoinedMs) return b.lastJoinedMs - a.lastJoinedMs;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Ideas with a net, best first. Confidence is not a sort key. */
export function rankForSlate(ideas: readonly RankedIdea[]): RankedIdea[] {
  return ideas.filter((idea) => idea.net != null).sort(compareIdeas);
}

/** D-080 / D-082. The three highest nets. A bucket may fill all three. */
export function selectTopThree(ideas: readonly RankedIdea[]): RankedIdea[] {
  return rankForSlate(ideas).slice(0, 3);
}

/**
 * D-080 / D-085. The best misses from a previous night, excluding that night's
 * selected three. The window is 10, and every idea tied with the 10th joins it.
 * Ideas with no net are not misses and do not consume a slot.
 */
export function carryoverMisses(
  yesterday: readonly RankedIdea[],
  selectedIds: readonly string[],
): RankedIdea[] {
  const selected = new Set(selectedIds);
  const misses = yesterday.filter((idea) => idea.net != null && !selected.has(idea.id));
  const ordered = [...misses].sort(compareIdeas);
  if (ordered.length <= CARRYOVER_MISSES) return ordered;
  const cutoff = units(ordered[CARRYOVER_MISSES - 1].net ?? 0);
  return ordered.filter((idea, index) => index < CARRYOVER_MISSES || units(idea.net ?? 0) === cutoff);
}

export function nyDateKey(at: Date): string {
  const { year, month, day } = zoneDateParts(at);
  const monthText = String(month).padStart(2, '0');
  const dayText = String(day).padStart(2, '0');
  return `${year}-${monthText}-${dayText}`;
}

function shiftDateKey(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

export function isSameNyDay(a: Date, b: Date): boolean {
  return nyDateKey(a) === nyDateKey(b);
}

/** The New York calendar date before `at`. */
export function previousNyDateKey(at: Date): string {
  return shiftDateKey(nyDateKey(at), -1);
}

/**
 * Who gets scored tonight, and whether they count as today's idea or as a
 * carryover (D-080, D-085). A same-day rerun re-scores the earlier slate as
 * today's ideas. It does not treat that slate as yesterday.
 */
export function candidateOrigins(input: {
  timelyIds: readonly string[];
  sameDayIds: readonly string[];
  carryoverIds: readonly string[];
}): Map<string, 'timely' | 'carryover'> {
  const origins = new Map<string, 'timely' | 'carryover'>();
  for (const id of input.timelyIds) origins.set(id, 'timely');
  for (const id of input.sameDayIds) {
    if (!origins.has(id)) origins.set(id, 'timely');
  }
  for (const id of input.carryoverIds) {
    if (!origins.has(id)) origins.set(id, 'carryover');
  }
  return origins;
}

/**
 * Which surviving framework supplies the psychology term for this bucket.
 * Higher score, then higher confidence, then curiosity, arousal, identity.
 */
export function winningFramework(
  bucket: BucketId,
  scores: FrameworkScores,
  surviving: readonly FrameworkId[],
  confidence: Record<FrameworkId, number>,
): FrameworkId {
  const eligible = FRAMEWORKS_FOR_BUCKET[bucket].filter((id) => surviving.includes(id));
  if (eligible.length === 0) {
    throw new Error(`Bucket ${bucket} has no surviving framework`);
  }
  return [...eligible].sort((a, b) => {
    const byScore = units(scores[b]) - units(scores[a]);
    if (byScore !== 0) return byScore;
    const byConfidence = units(confidence[b]) - units(confidence[a]);
    if (byConfidence !== 0) return byConfidence;
    return FRAMEWORK_IDS.indexOf(a) - FRAMEWORK_IDS.indexOf(b);
  })[0];
}

/** True when `earlier` falls on the New York calendar day before `later`. */
export function isPreviousNyDay(earlier: Date, later: Date): boolean {
  return shiftDateKey(nyDateKey(earlier), 1) === nyDateKey(later);
}
