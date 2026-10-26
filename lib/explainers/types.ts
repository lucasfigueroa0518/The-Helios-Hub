/**
 * Shared types for Explainer Reels (planning/Explainer Reels/BUILD_PLAN.md §4).
 * Every union mirrors a CHECK constraint in db/explainers_schema.sql.
 */

export const TOPIC_ORIGINS = ['seeded', 'generated', 'manual'] as const;
export type TopicOrigin = (typeof TOPIC_ORIGINS)[number];

export const TOPIC_STATUSES = [
  'proposed',
  'pool',
  'rejected',
  'displaced',
  'promoted',
  'queued',
  'rendered',
  // Explainers 3.1 pool reset: off the site and out of every list, the scheduler, and duplicate
  // history; kept whole so a topic (and its reels) can be brought back by setting its status.
  'archived',
] as const;
export type TopicStatus = (typeof TOPIC_STATUSES)[number];

export const JOB_STATUSES = ['requested', 'running', 'ok', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export type JobTrigger = 'click' | 'auto';

export const MODES = ['development', 'production'] as const;
export type Mode = (typeof MODES)[number];

export const ARTIFACT_KINDS = [
  'brief',
  'source',
  'storyboard',
  'script',
  'audio_meta',
  'lint_report',
  'contact_sheet',
  'video',
  'captions',
  'transcript_log',
  'post_caption',
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** E-08 failure tags. */
export const FAILURE_TAGS = [
  'hook',
  'analogy',
  'accuracy',
  'pacing',
  'visuals',
  'voice',
  'captions',
  'brand',
] as const;
export type FailureTag = (typeof FAILURE_TAGS)[number];
export type Verdict = 'approved' | 'rejected';

export type CostVendor = 'anthropic' | 'heygen' | 'jev';

/** The six E-15 score keys, in question order (not tie-break order). */
export const SCORE_KEYS = [
  'audience_fit',
  'teachability_45s',
  'analogy_potential',
  'visual_potential',
  'accuracy_under_simplification',
  'hook_strength',
] as const;
export type ScoreKey = (typeof SCORE_KEYS)[number];

/**
 * Idea scoring v3 (EX3-73) adds `ai_focus`, scored with the six in the same Jev calls. It has no
 * column: it lives in the topic's `jev_notes.ai_focus` and counts in `weighted_score`.
 */
export const IDEA_SCORE_KEYS = [...SCORE_KEYS, 'ai_focus'] as const;
export type IdeaScoreKey = (typeof IDEA_SCORE_KEYS)[number];

/**
 * Explainers 3.0 (EX3-30): the idea phase picks each pool topic's analogy from three candidates
 * scored by Jev. Stored on the topic as `jev_notes.analogy`.
 */
export type AnalogyElement = { name: string; stands_for: string };
/** One step of the process: what happens in the scene, and the real step's name (EX3-66). */
export type AnalogyStep = { analogy: string; technical: string };

/** One curiosity gap candidate (gap writer, EX3-120). */
export type GapCandidate = {
  /** The whole spoken line, ending on its question. */
  line: string;
  /** The question, exactly as it ends the line. */
  question: string;
  /** The way in it uses (everyday mystery, contradiction, stakes, number, wrong belief, "you did this today", or its own). */
  way_in: string;
  /** One line on why it pulls. */
  why_it_pulls: string;
};

/** Gap scoring v1 (EX3-120). */
export const GAP_KEYS = ['pull', 'clarity', 'closable'] as const;
export type GapKey = (typeof GAP_KEYS)[number];
export type GapScores = Record<GapKey, number>;

/** One gap writer call and its verdicts. Candidates that fail the code checks are never sent to Jev (scores null). */
export type GapPass = {
  candidates: GapCandidate[];
  /** What the code checks found per candidate; empty when it passed them. */
  checks: string[][];
  scores: (GapScores | null)[];
  totals: (number | null)[];
  /** Jev's probability that the line makes a false or unverifiable claim. */
  false_claim: (number | null)[];
  /** Why each candidate cannot be picked; empty when it can. */
  misses: string[][];
};

export type GapNote =
  | { version: string; analogy_name: string; passes: GapPass[]; pick: { pass: number; index: number }; picked_at: string }
  | { version: string; analogy_name: string; passes: GapPass[]; below_bar: true; checked_at: string }
  | { version: string; analogy_name: string; error: string; failed_at: string };

/** One row of a named analogy's mapping: a part of the analogy and the part of the concept it stands for (EX3-123). */
export type AnalogyMapping = { analogy: string; concept: string };

/**
 * A named analogy (analogy-writer-v8, EX3-123): a name that is the whole picture, two or three
 * sentences, and the mapping, most important row first. The director stages it (EX3-128).
 * The optional fields are the staged scenes of analogy-writer-v1 to v7, kept so old notes stay
 * readable; `topicAnalogy` never returns one.
 */
export type AnalogyCandidate = {
  name: string;
  explanation: string;
  mapping: AnalogyMapping[];
  scene?: string;
  elements?: AnalogyElement[];
  process?: string;
  payoff?: string;
  visual?: string;
  hook?: string;
  steps?: AnalogyStep[];
  rung?: 1 | 2 | 3;
  invented_rules?: string[];
  actor?: string;
};

/** Jev's three gates per candidate (explainers-analogy-gates-v1, EX3-124), in question order. */
export const ANALOGY_GATE_KEYS = ['false_mapping', 'is_the_system', 'real_names'] as const;
export type AnalogyGateKey = (typeof ANALOGY_GATE_KEYS)[number];
/** Jev's probability of "yes" per gate; a candidate fails a gate at or above ANALOGY_GATE_MAX. */
export type AnalogyGates = Record<AnalogyGateKey, number>;

/** One writer call and its verdicts. `analogy` is null when the reply could not be read. */
export type AnalogyTry = {
  analogy: AnalogyCandidate | null;
  /** Null when the code checks failed (or there was no analogy): Jev is never asked. */
  gates: AnalogyGates | null;
  /** Why it cannot be picked; empty when it passed. */
  misses: string[];
};

/** Jev's comparison of two passing candidates, asked twice with the order swapped (EX3-124). */
export type AnalogyComparison = {
  /** p(the first is more repeatable than the second), the first order. */
  first_over_second: number;
  /** p(the second is more repeatable than the first), the swapped order. */
  second_over_first: number;
  /** (first_over_second + 1 − second_over_first) / 2: the first wins at 0.5 or more. */
  first_score: number;
};

/** How the pick was made. */
export type AnalogyPickReason = 'same' | 'compared' | 'only_pass' | 'third';

export type AnalogyNote =
  /**
   * analogy-writer-v8 on (EX3-123): two writer calls, a third when neither passes. `pick` indexes
   * `candidates`, and 2 is the third call. `golden_hidden` names the golden examples Jev left out
   * of the writer's prompt for this topic.
   */
  | {
      version: string;
      golden_hidden: string[];
      candidates: AnalogyTry[];
      third?: AnalogyTry;
      comparison?: AnalogyComparison;
      pick: 0 | 1 | 2;
      pick_reason: AnalogyPickReason;
      picked_at: string;
    }
  /** No candidate passed in three calls: the render fails and the topic stays (EX3-125). */
  | { version: string; golden_hidden: string[]; candidates: AnalogyTry[]; third?: AnalogyTry; below_bar: true; checked_at: string }
  | { version: string; error: string; failed_at: string };

export type TopicRow = {
  id: string;
  title: string;
  scope: string | null;
  /** The exact phrase the reel defines (EX3-86). Null on topics written before 3.2 until backfilled. */
  term: string | null;
  source_url: string | null;
  source_text: string | null;
  origin: TopicOrigin;
  status: TopicStatus;
  audience_fit: number | null;
  teachability_45s: number | null;
  analogy_potential: number | null;
  visual_potential: number | null;
  accuracy_under_simplification: number | null;
  hook_strength: number | null;
  weighted_score: number | null;
  reject_reason: string | null;
  duplicate_of: string | null;
  jev_notes: Record<string, unknown>;
  idea_cycle_id: string | null;
  scored_at: string | null;
  rendered_at: string | null;
  created_at: string;
  updated_at: string;
};

export type JobRow = {
  id: string;
  topic_id: string;
  status: JobStatus;
  stage: string | null;
  trigger: JobTrigger;
  mode: Mode;
  spend_usd: number;
  spend_cap_usd: number;
  capped: boolean;
  error: string | null;
  orchestrator_model: string;
  frame_worker_model: string;
  session_a_id: string | null;
  session_b_id: string | null;
  /** The bank opener frame 1 drew (EX3-102); null before the render picks one. */
  opener?: string | null;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type ArtifactRow = {
  id: string;
  job_id: string;
  kind: ArtifactKind;
  storage_path: string | null;
  content: string | null;
  bytes: number | null;
  /** 'bucket': also in the `explainers` Supabase bucket under storage_path. */
  storage_location?: 'local' | 'bucket';
  created_at: string;
};

export type LintViolation = {
  source: 'storyboard' | 'hyperframes';
  rule: string;
  frame: number | null;
  severity: 'error' | 'warning';
  detail: string;
};

export type FeedbackRow = {
  job_id: string;
  verdict: Verdict;
  tags: FailureTag[];
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CostEventInput = {
  jobId?: string | null;
  ideaCycleId?: string | null;
  mode: Mode;
  vendor: CostVendor;
  component: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** null = the vendor returned no price; stored as usd 0, usd_known false. */
  usd: number | null;
};
