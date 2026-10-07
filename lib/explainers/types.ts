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

export type TopicRow = {
  id: string;
  title: string;
  scope: string | null;
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
