/**
 * Shared types for Real Case Reels (planning/Real Case Reels/BUILD_PLAN.md).
 * Every union mirrors a CHECK constraint in db/real_case_schema.sql.
 */

export const STORY_STATUSES = ['proposed', 'pool', 'rejected', 'displaced', 'promoted', 'rendered', 'archived'] as const;
export type StoryStatus = (typeof STORY_STATUSES)[number];

export const POLARITIES = ['failure', 'success', 'mystery'] as const;
export type Polarity = (typeof POLARITIES)[number];

export const SCOUT_OUTCOMES = ['running', 'found', 'weak', 'none', 'failed'] as const;
export type ScoutOutcome = (typeof SCOUT_OUTCOMES)[number];

export const SOURCE_KINDS = ['postmortem', 'engineering_blog', 'statement', 'court', 'regulator', 'press', 'other'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** One source the scout cited. */
export type StorySource = {
  id: string;
  url: string;
  publisher: string;
  kind: SourceKind;
  /** As the source dates itself (e.g. "2024-05-30"), when it does. */
  published?: string | null;
};

/** What code found when it looked for a claim's excerpt on its source (RC-13). */
export type ClaimCheckStatus =
  /** The excerpt is on the page. */
  | 'verified'
  /** The page loaded and the excerpt is not on it. */
  | 'mismatch'
  /** Neither the live page nor an archived copy loaded. */
  | 'unreachable'
  /** The page loaded but code can't read it (a PDF, an image). */
  | 'unreadable'
  /** The URL is not a public web address, or the excerpt is too short to mean anything. */
  | 'invalid';

export type ClaimCheck = {
  status: ClaimCheckStatus;
  /** Where the excerpt was found or looked for. */
  via?: 'live' | 'archive';
  detail?: string;
  checked_at: string;
};

/** One fact the story rests on, with the exact words on its source that establish it. */
export type StoryClaim = {
  id: string;
  /** The fact, in plain words. */
  text: string;
  source_id: string;
  /** Words copied exactly from the source page. */
  excerpt: string;
  /** The story falls apart without it: a core claim that fails its check drops the story. */
  core: boolean;
  check?: ClaimCheck;
};

/** The material for the eight beats (RC-12), as the scout writes it. */
export type StoryBeats = {
  /** Who (a company, product or institution, never a private person), when, and the strange outcome. */
  incident: string;
  /** The detail that makes it strange, and the question the concept answers. */
  puzzle: string;
  /** The concept's 3–4 steps, each shown with the story's own items. */
  steps: { step: string; in_story: string }[];
  /** The step that explains why this outcome happened. */
  click: string;
  /** The fix, for a failure; the limit or trade-off, for a success. */
  other_side: string;
  /** The puzzle answered, plus one rule the viewer keeps. */
  takeaway: string;
};

/** The five Jev scores, in question order. */
export const STORY_SCORE_KEYS = ['recognition', 'tension', 'illumination', 'mechanism_fit', 'tellable'] as const;
export type StoryScoreKey = (typeof STORY_SCORE_KEYS)[number];
export type StoryScores = Record<StoryScoreKey, number>;

export type Mode = 'development' | 'production';

export type StoryRow = {
  id: string;
  topic_id: string;
  scout_id: string | null;
  term: string;
  title: string;
  summary: string;
  polarity: Polarity;
  story: StoryBeats;
  claims: StoryClaim[];
  sources: StorySource[];
  status: StoryStatus;
  recognition: number | null;
  tension: number | null;
  illumination: number | null;
  mechanism_fit: number | null;
  tellable: number | null;
  weighted_score: number | null;
  reject_reason: string | null;
  duplicate_of: string | null;
  jev_notes: Record<string, unknown>;
  cycle_id: string | null;
  checked_at: string | null;
  scored_at: string | null;
  rendered_at: string | null;
  created_at: string;
  updated_at: string;
};

/** An Explainer topic as this route reads it (explainers.topics, read only). */
export type SeedTopic = {
  id: string;
  title: string;
  scope: string | null;
  term: string | null;
  status: string;
  weighted_score: number | null;
};
