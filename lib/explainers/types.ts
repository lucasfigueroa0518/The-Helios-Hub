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
export type AnalogyCandidate = {
  scene: string;
  elements: AnalogyElement[];
  process: string;
  payoff: string;
  visual: string;
  /** The opener's moment in this world (EX3-62). Absent on analogy-writer-v1 candidates. */
  hook?: string;
  /** The process as 3–5 steps (EX3-66). Absent on analogy-writer-v1 candidates. */
  steps?: AnalogyStep[];
  /** The ladder of simplicity (EX3-85): 1 object, 2 an action by a critter, 3 a familiar situation. v3 on. */
  rung?: 1 | 2 | 3;
  /** Rules the viewer would have to be told for the analogy to work (EX3-85); empty when finished. */
  invented_rules?: string[];
  /** The critter's role, or "none" when no one acts (EX3-77). */
  actor?: string;
};

/** The seven analogy-scoring keys (v3, EX3-85), in question order. */
export const ANALOGY_KEYS = ['simplicity', 'reach', 'mapping_fidelity', 'visual_strength', 'visual_payoff', 'familiarity', 'hook_clarity'] as const;
export type AnalogyKey = (typeof ANALOGY_KEYS)[number];
export type AnalogyScores = Record<AnalogyKey, number>;

export type AnalogyNote =
  | {
      version: string;
      candidates: AnalogyCandidate[];
      scores: AnalogyScores[];
      totals: number[];
      /** Index into `candidates`. */
      pick: number;
      picked_at: string;
    }
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
