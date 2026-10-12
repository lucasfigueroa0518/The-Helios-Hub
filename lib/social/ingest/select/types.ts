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
  /**
   * Members whose full text enrichment actually read (an RSS body or a
   * fetched page of at least THIN_BODY_CHARS), most text first, one per
   * outlet. The Reporter's starting sources come from here.
   */
  read: ReadMember[];
  /** Member URLs enrichment already tried to fetch (so a top-up doesn't refetch). */
  tried: string[];
};

export type ReadMember = { url: string; outlet: string; chars: number };

export type ScoreStatus = 'qualified' | 'not-qualified' | 'skipped';

export type ScoredGroup = StoryGroup & {
  /** Raw Jev probabilities by question id, kept so thresholds can be calibrated from live run reports (§2.3). */
  answers: Record<string, number>;
  status: ScoreStatus;
  /** Set when skipped or not qualified. */
  reason?: string;
  /** How many of the five impact and audience questions pass (story-scoring@4; @3 runs: of its four engagement questions; @2 runs: of its three score questions). */
  passes: number;
  /** The ranking score: story-scoring@4's score, 0 to 5.5 (@3 runs: its engagement score, also 0 to 5.5; @2 runs: the sum of its three answers, a tie-break). */
  probSum: number;
};

export type SkipEntry = { id: string; reason: string; stage: 'code-filter' | 'scoring' };
