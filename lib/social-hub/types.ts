/**
 * Social Hub shared shapes (PRODUCT_SPEC §8). Every vertical's adapter maps
 * its own rows to `HubPost`; native metadata stays per vertical (SH-04).
 */

export type Vertical = 'reels' | 'explainers' | 'carousels' | 'stories';

export type Format = 'reel' | 'feed' | 'story';

/**
 * Where a post is in its life. `ready` = generated, not scheduled
 * ("Content ready", spec §9a). `skipped` = a Story set that missed its window.
 */
export type HubStatus =
  | 'published'
  | 'publishing'
  | 'scheduled'
  | 'failed'
  | 'cancelled'
  | 'ready'
  | 'generating'
  | 'skipped';

export type MetricKey =
  | 'views'
  | 'reach'
  | 'likes'
  | 'comments'
  | 'saved'
  | 'shares'
  | 'reposts'
  | 'totalInteractions'
  | 'avgWatchTimeMs'
  | 'totalWatchTimeMs'
  | 'skipRate'
  | 'replies'
  | 'follows'
  | 'profileVisits'
  | 'tapsForward'
  | 'tapsBack'
  | 'exits'
  | 'swipeForward'
  | 'completion'
  | 'exitsFirst3';

/** A blank (null or missing) metric stays out of every sum and average. */
export type HubMetrics = Partial<Record<MetricKey, number | null>>;

export type MetricSnapshot = { nyDate: string; metrics: HubMetrics };

export type MetaGroup = 'content' | 'production' | 'scoring' | 'scheduling';

export type NativeField = { group: MetaGroup; label: string; value: string };

/**
 * A post's value for one factor: a category, a raw number banded at group
 * time (above/below the median of the posts in view), or several tags (the
 * post counts once in each tag's group; no tags = its own group).
 */
export type FactorValue =
  | { kind: 'category'; key: string; label: string }
  | { kind: 'number'; value: number | null }
  | { kind: 'tags'; values: Array<{ key: string; label: string }>; empty: string };

export type HubMedia =
  | { kind: 'video'; src: string | null; poster?: string | null }
  | {
      kind: 'slides';
      /** Rendered JPEG when a route serves it (OUT_OF_SCOPE #3); else the slide outline from `render`. */
      slides: Array<{ src: string | null; alt: string; photo: string | null; layout: string | null; headline: string | null; body: string | null }>;
    }
  | { kind: 'frames'; frames: Array<{ src: string | null; label: string }> }
  | { kind: 'none'; note: string };

export type Approval = {
  /** Whether a person must approve before this posts. */
  required: boolean;
  approvedAt: string | null;
  /** Free-text approval state the vertical holds (verdict, set status). */
  note: string | null;
};

export type ContentVersion = {
  id: string;
  createdAt: string;
  trigger: string;
  current: boolean;
  status: string;
};

export type SourceRef = { url: string; title: string | null };

export type HubPost = {
  /** Durable hub id (spec §3, D46): the content's id, stable through its whole life (lib/social-hub/ids.ts). */
  id: string;
  /** Older ids this post was shown under (attempt, slot, content-ready ids); links to them still open it. */
  aliases?: string[];
  /** Earlier tries that didn't post (a failed attempt, a cancelled slot), newest first. */
  tries?: Array<{ status: HubStatus; at: string | null; note: string | null }>;
  vertical: Vertical;
  format: Format;
  name: string;
  description: string | null;
  status: HubStatus;
  /** Cancel reason, publish error, or skip reason. */
  statusNote: string | null;
  postedAt: string | null;
  publishAt: string | null;
  /** America/New_York calendar day the post lands on (posted, else scheduled). */
  nyDate: string | null;
  slot: { id: string; label: string } | null;
  permalink: string | null;
  /** The vertical's own workshop page. */
  pipelineHref: string;
  media: HubMedia;
  /** Cost to make, integer micro-dollars (§8a). Null until the cost model ran. */
  costMicros: number | null;
  /** "generated <date>" for reused content. */
  costNote: string | null;
  metrics: HubMetrics;
  history: MetricSnapshot[];
  native: NativeField[];
  factorValues: Record<string, FactorValue>;
  approval: Approval;
  /** The post idea this content belongs to (spec §9a). */
  idea: { id: string; label: string } | null;
  /** When the content that posts (or will post) was generated. */
  generatedAt: string | null;
  versions: ContentVersion[];
  sources: SourceRef[];
  /** Key into the cost model's items (§8a). */
  costItemKey: string | null;
  /** Review notes the pipeline left (carousel render checks, story flags). */
  reviewNotes?: string[];
  /** Native ids the action routes need (schedule id, job id, set id …). */
  refs: Record<string, string>;
};

export type IdeaState = 'idea_only' | 'content_ready' | 'on_deck' | 'published' | 'retired' | 'skipped';

export type HubIdea = {
  id: string;
  vertical: Vertical;
  title: string;
  /** Score as the vertical stores it, and what it means. */
  score: number | null;
  scoreLabel: string;
  state: IdeaState;
  hasContent: boolean;
  versionCount: number;
  generatedAt: string | null;
  createdAt: string | null;
  detail: string | null;
  /** Stories: which series this idea belongs to. */
  group?: string | null;
};

export type HubSource = {
  url: string;
  title: string | null;
  postIds: string[];
  verticals: Vertical[];
};

export type DateRangeId = '7d' | '30d' | '90d' | 'all' | 'custom';

export type DateRange = {
  id: DateRangeId;
  /** Inclusive America/New_York days; null start = all time. */
  from: string | null;
  to: string;
};
