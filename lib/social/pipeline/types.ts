/**
 * Helios Social rebuild — pipeline shapes (spec §3).
 *
 * M0 skeleton: the fields here are the minimum the orchestrator needs.
 * M1–M6 fill them in (brief format in M2, writer output in M3, …).
 */

/** The six stages of spec §3, plus the mechanical guarantees (§6). */
export const STAGE_ORDER = [
  'jev-scoring',
  'reporter',
  'writer',
  'editor',
  'fact-checker',
  'design',
  'mechanical',
] as const;

export type StageName = (typeof STAGE_ORDER)[number];

/**
 * Why a story was set aside (spec §7.1). `cost-cap` stops the day rather
 * than one story, but it is logged the same way.
 */
export type ReasonCode =
  | 'malformed-output'
  | 'over-limit'
  | 'main-claim-false'
  | 'unverifiable-claim'
  | 'render-failed'
  | 'cost-cap';

/**
 * Spec §2.4: a pipeline fault has a target of zero and is fixed at its
 * source; a story that shouldn't run is the correct outcome.
 */
export type SetAsideKind = 'pipeline-fault' | 'should-not-run';

export const REASON_KIND: Record<ReasonCode, SetAsideKind> = {
  'malformed-output': 'pipeline-fault',
  'over-limit': 'pipeline-fault',
  'render-failed': 'pipeline-fault',
  'cost-cap': 'pipeline-fault',
  'main-claim-false': 'should-not-run',
  'unverifiable-claim': 'should-not-run',
};

/** One article cluster from ingest (M1 adds outlets, freshness, …). */
export type Candidate = {
  id: string;
  title: string;
  url: string;
};

/** Jev's ranking of a candidate (M1 adds per-question answers). */
export type ScoredCandidate = Candidate & { score: number };

/** The Reporter's brief (M2 replaces this with the structured format). */
export type Brief = {
  storyId: string;
  news: string;
};

/** Writer/Editor/Fact-checker output (M3 adds slide types, IDs, covers). */
export type Draft = {
  storyId: string;
  slides: Array<{ headline: string; body: string }>;
  caption: string;
};

/** A designed post, ready for the mechanical guarantees and review. */
export type PostObject = {
  storyId: string;
  title: string;
  slides: Array<{ headline: string; body: string; image: string | null }>;
  caption: string;
  /** Stages this post went through, in order. */
  stages: StageName[];
  costUsd: number;
};

/** Every stage returns this. `costUsd` is charged whether or not it succeeded. */
export type StageResult<T> =
  | { ok: true; value: T; costUsd: number }
  | { ok: false; reasonCode: ReasonCode; detail: string; costUsd: number };
