/**
 * Shared types for Real Case Reels, now AI News Explained (planning/Real Case Reels/FORMAT.md).
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

/** The acts a claim can serve (FORMAT.md): the cold open and "for you" draw on these. */
export const CLAIM_ACTS = ['setup', 'moment', 'fallout', 'reveal', 'since'] as const;
export type ClaimAct = (typeof CLAIM_ACTS)[number];

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
  /** The act it serves (RC-31). Absent on stories from the first build. */
  act?: ClaimAct;
  check?: ClaimCheck;
};

export const CAST_KINDS = ['organization', 'product', 'public_figure', 'private_person'] as const;
export type CastKind = (typeof CAST_KINDS)[number];

/** A player in the story (RC-28). A private person's `name` is their role, never their name. */
export type CastMember = { name: string; kind: CastKind; role: string };

export const ARTIFACT_KINDS = ['post', 'reply', 'statement', 'headline', 'filing', 'document', 'message', 'other'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/**
 * A real artifact the reel recreates on screen (RC-28): its words verbatim, inside the excerpt of
 * the claim that cites it, so the source check covers them.
 */
export type StoryArtifact = { id: string; kind: ArtifactKind; speaker: string; text: string; claim_id: string };

export type TimelineEntry = { date: string; what: string; claim_id: string };

/** The material for the eight acts (RC-31), as the scout writes it. */
export type NewsStory = {
  /** The day the central event happened or became public (YYYY-MM-DD). */
  event_date: string;
  place: string | null;
  cold_open: string;
  setup: string;
  moment: string;
  fallout: string;
  /** What was actually going on: the concept, explained through this event. */
  reveal: string;
  since: string;
  for_you: string;
  cast: CastMember[];
  timeline: TimelineEntry[];
  artifacts: StoryArtifact[];
};

/** The six Jev scores, in question order; freshness is code's, from the event date (RC-27). */
export const JEV_SCORE_KEYS = ['stakes', 'turn', 'scene', 'reveal', 'artifacts', 'players'] as const;
export const STORY_SCORE_KEYS = [...JEV_SCORE_KEYS, 'freshness'] as const;
export type StoryScoreKey = (typeof STORY_SCORE_KEYS)[number];
export type StoryScores = Record<StoryScoreKey, number>;

export type Mode = 'development' | 'production';

export type StoryRow = {
  id: string;
  /** The Explainer topic it is closest to: a label only (RC-27). */
  topic_id: string | null;
  scout_id: string | null;
  term: string;
  title: string;
  summary: string;
  polarity: Polarity;
  /** The news story (RC-31); stories from the first build hold the old beat shape and no event date. */
  story: NewsStory;
  event_date: string | null;
  claims: StoryClaim[];
  sources: StorySource[];
  status: StoryStatus;
  /** Null until scored. */
  scores: StoryScores | null;
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
