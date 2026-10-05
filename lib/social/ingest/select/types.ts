/**
 * Shapes for daily ingest and story selection (spec §5B).
 */
import type { FetchedArticle } from '@/lib/social/ingest/fetch-feeds';

/** A fetched article. Its URL is its id. */
export type IngestArticle = FetchedArticle;

/** One article inside a story group, kept for the Reporter's two-source confirmation (M2). */
export type GroupMember = {
  url: string;
  outlet: string;
  title: string;
  publishedAt: Date;
  feedSlug: string;
};

/** Same story, many outlets = 1 candidate (spec §5B). */
export type StoryGroup = {
  /** Stable id: the first-choice representative's URL at grouping time. */
  id: string;
  /** Every article in the group, newest first. */
  members: GroupMember[];
  /** Distinct outlet names (native and Google News copies of one outlet count once). */
  outlets: string[];
  outletCount: number;
  /** Newest member's publish time. */
  publishedAt: Date;
  /** The member whose text Jev scores (after enrichment: the member with the most text). */
  representative: IngestArticle;
  /** Every member article, native feeds first, then longest RSS body. */
  articles: IngestArticle[];
  /** Text Jev scores: the most text any member yielded (RSS body or full page). */
  body: string;
};

export type ScoreStatus = 'qualified' | 'not-qualified' | 'skipped';

export type ScoredGroup = StoryGroup & {
  /** Raw Jev probabilities by question id, kept so thresholds can be calibrated from live run reports (§2.3). */
  answers: Record<string, number>;
  status: ScoreStatus;
  /** Set when skipped or not qualified. */
  reason?: string;
  /** How many of the four non-required questions pass (spec §5B scoring). */
  passes: number;
  /** Sum of the four non-required probabilities; a late tie-break only. */
  probSum: number;
};

export type SkipEntry = { id: string; reason: string; stage: 'code-filter' | 'scoring' };
