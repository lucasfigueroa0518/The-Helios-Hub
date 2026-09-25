/** Trial Reels Build 1 shared types. Spec: planning/Trial Reels/. */

import type { JevRunner } from '@/lib/reels/jev/runner';

export type Bucket = 'A' | 'B';

/** Spec source types still in Build 1. B2/B4/B5 are out (D-003, D-010, D-026). */
export type SourceType = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'B1' | 'B3' | 'B6';

export type AdapterKind = 'ranked' | 'dated' | 'catalog' | 'generated';

export type MemberRole = 'primary' | 'supporting' | 'merged_duplicate';

export type RunTrigger = 'scheduled' | 'manual';
/** `requested` is queued by the page; the worker claims it (D-017, D-049). */
export type RunStatus = 'requested' | 'running' | 'ok' | 'partial' | 'failed' | 'skipped';

export type GroupingAction = 'merge' | 'link' | 'leave';

export type ReviewFlagKind = 'wrong_merge' | 'missed_link' | 'junk_source';

/**
 * Why an item never reached the pool. Dropped items stay visible with their
 * reason so an over-aggressive filter is obvious at review (D-048).
 */
export type DropReason =
  | 'no_full_text'
  | 'fetch_failed'
  | 'off_topic'
  | 'junk'
  | 'non_english'
  | 'planted_instruction'
  | 'already_seen'
  | 'over_cap'
  | 'not_selected';

export type Engagement = {
  points?: number;
  comments?: number;
  stars?: number;
  starsToday?: number;
  upvotes?: number;
  rank?: number;
};

/** What an adapter hands the pipeline before cleaning, filtering, and storage. */
export type AdapterItem = {
  canonicalUrl: string;
  headline: string;
  body: string;
  author?: string | null;
  byline?: string | null;
  publishTime?: Date | null;
  engagement?: Engagement;
  mediaUrls?: string[];
  citationUrls?: string[];
  rawPayload?: unknown;
  /**
   * The adapter already has the whole usable text, so the pipeline must not
   * fetch the destination. Set for papers and model cards, where an abstract
   * plus metadata counts as full text (D-067), and for READMEs.
   */
  textIsComplete?: boolean;
  /** Pointer to follow when the feed only gave us a blurb (D-041). */
  destinationUrl?: string;
  /**
   * Bypass the "seen before" fingerprint drop. Only A4 sets this, when a
   * catalog entry earns a second look because tonight's news names it (D-066).
   */
  allowRepeat?: boolean;
};

export type AdapterDefinition = {
  id: string;
  name: string;
  type: SourceType;
  bucket: Bucket;
  kind: AdapterKind;
  /** Per-night cap for article-style feeds (D-035). Ranked lists ingest whole. */
  cap?: number;
};

export type AdapterContext = {
  /** Start of the window for dated feeds: last success, or 24h back on night one (D-032). */
  since: Date;
  now: Date;
  runId: string;
  signal?: AbortSignal;
  /**
   * Available to the adapters that need a judgment of their own: A4's editor
   * (D-066). Plain feeds ignore it.
   */
  jev: JevRunner;
};

export type Adapter = AdapterDefinition & {
  /**
   * `derived` adapters read what the primary ones already ingested tonight, so
   * they run after them: A4's news peg and B6's "don't repeat tonight's pool".
   */
  phase?: 'primary' | 'derived';
  fetchItems(context: AdapterContext): Promise<AdapterItem[]>;
};

export type SourceRow = {
  id: string;
  run_id: string | null;
  canonical_url: string;
  headline: string;
  body: string;
  author: string | null;
  byline: string | null;
  source_name: string;
  source_type: SourceType;
  adapter_id: string;
  bucket: Bucket;
  publish_time: string | null;
  ingest_time: string;
  language: string | null;
  engagement: Engagement;
  media_urls: string[];
  citation_urls: string[];
  drop_reason: DropReason | null;
};

export type SourceResult = {
  adapterId: string;
  name: string;
  status: 'ok' | 'failed' | 'skipped';
  fetched: number;
  ingested: number;
  dropped: number;
  refreshed: number;
  error?: string;
};

export type RunStats = {
  ingested: number;
  dropped: number;
  refreshed: number;
  postIdeasCreated: number;
  postIdeasJoined: number;
  merges: number;
  links: number;
  ideaMerges: number;
  scored: number;
  selected: number;
  copyWritten: number;
  jevCalls: number;
  usd: number;
};
