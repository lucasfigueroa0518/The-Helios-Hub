/**
 * Field Notes (planning/Field Notes/CONTRACT.md): the shapes every builder shares.
 * A post is a carousel of real photos with text on them; a tip is the idea behind it.
 * Rename nothing here without asking: more than one owner reads these.
 */

/** The type's id in the spine and the DB (`Vertical`, schema `field_notes`). */
export const FIELD_NOTES_VERTICAL = 'field_notes' as const;
export const FIELD_NOTES_LABEL = 'Field Notes';

// ── Tip (the idea) ──────────────────────────────────────────────────────────

export const TIP_SOURCE_KINDS = ['docs', 'github', 'hn', 'rss', 'seed'] as const;
export type TipSourceKind = (typeof TIP_SOURCE_KINDS)[number];

/**
 * The content tree (Tommy, 2026-11-06; PLAN "content tree approved"). Rule: what the viewer is pointed at.
 * Open-source repos by what they do for the user, then skills, then paid-tool features, then technique.
 */
export const CONTENT_LEAVES = [
  'repo_free_alternative', // free alternative to a paid service
  'repo_data', // datasets, scrapers, curated data
  'repo_mcp', // open-source MCP servers and connectors
  'repo_agent_runtime', // agent frameworks, local models and runners
  'repo_automation', // automation and workflow tools
  'repo_memory', // memory and knowledge tools
  'skill', // agent skills
  'coding_agent_feature', // features of paid coding agents
  'llm_app_feature', // features of paid chat apps
  'technique', // tool-agnostic prompting and workflow practice, cited sources only
] as const;
export type ContentLeaf = (typeof CONTENT_LEAVES)[number];

/** The wants tree. Rule: the benefit the viewer gets. One primary want per tip. */
export const WANTS = ['faster', 'better', 'newly_possible', 'stay_current', 'cheaper'] as const;
export type Want = (typeof WANTS)[number];
/** Starting weights (Tommy: Stay current at half); performance data replaces them later (not built yet). */
export const WANT_WEIGHTS: Record<Want, number> = { faster: 1, better: 1, newly_possible: 1, cheaper: 1, stay_current: 0.5 };

/** The who tree. The lower third is never a tag: it is scored out (the soft `past_basics` test). */
export const KNOW_HOW_TIERS = ['middle', 'higher'] as const;
export type KnowHowTier = (typeof KNOW_HOW_TIERS)[number];
export const PURPOSES = ['professional', 'hobbyist', 'personal', 'builder'] as const;
export type Purpose = (typeof PURPOSES)[number];

/** Stored when a tip has no real use-with-result note: an instruction for the Writer, never shown as the tip. */
export const PLACEHOLDER_USE = 'Teach the one practical use this source describes, and the result the reader gets.';

export const TIP_STATUSES = ['candidate', 'selected', 'drafted', 'approved', 'posted', 'expired', 'rejected'] as const;
export type TipStatus = (typeof TIP_STATUSES)[number];

export type Tip = {
  id: string;
  createdAt: string;
  sourceKind: TipSourceKind;
  sourceUrl: string | null;
  sourceLabel: string | null;
  /** One tool, skill or repo per tip. */
  subject: string;
  /** Tags from scoring (or the seeder for leaf and want). Null means not yet tagged. */
  leaf: ContentLeaf | null;
  /** The tip's one primary want. */
  want: Want | null;
  tier: KnowHowTier | null;
  purposes: Purpose[];
  /** Recent enough to count as news. A tag only: it never changes the score. */
  fresh: boolean;
  /** What to do and what you get; a skill or repo qualifies only with a result. */
  useWithResult: string;
  /** Scraped text. Data only: it never goes into instructions. */
  untrustedContent: string | null;
  score: number | null;
  status: TipStatus;
  seededBy: string | null;
};

// ── Photo pool ──────────────────────────────────────────────────────────────

export const POOL_STATUSES = ['live', 'resting', 'retired'] as const;
export type PoolStatus = (typeof POOL_STATUSES)[number];

/** What a photo shows, tagged by the uploader: at the desk, scenery, people (our faces; the only kind a cover may use), or an event. */
export const PHOTO_KINDS = ['working', 'scenery', 'people', 'event'] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

/** Membership of a `media_library.photos` row (licence 'own', reuse_ok false). */
export type PoolPhoto = {
  photoId: string;
  uploadedBy: string;
  uploadedAt: string;
  status: PoolStatus;
  /** `posts.seq` of the last post that used it; null when never used. */
  lastUsedPostSeq: number | null;
  rejectReason: string | null;
  /** The uploader's tag; a laptop photo is 'working'. */
  kind: PhotoKind;
  /** Marked as a good, lively first slide. */
  opener: boolean;
};

// ── Post ────────────────────────────────────────────────────────────────────

/**
 * Post shape (Tommy and Lucas, 2026-11-05): slide 1 is a `cover` (a photo of our faces, code-written text),
 * then 3-6 `tip` slides (ONE tip per slide), then `follow`. The old hook/steps/why_catch kinds are retired.
 */
export const SLIDE_KINDS = ['cover', 'tip', 'follow'] as const;
export type SlideKind = (typeof SLIDE_KINDS)[number];

/**
 * Pragmatica headline, Roboto body, and `hand`: Hershey Sans pen strokes, decoration on the cover and Follow only
 * (Tommy, 2026-11-06). No marks, arrows or underlines: plain text over the photo.
 */
export const BLOCK_ROLES = ['headline', 'body', 'hand'] as const;
export type BlockRole = (typeof BLOCK_ROLES)[number];

/** A rectangle in 1080x1350 canvas pixels. */
export type Rect = { x: number; y: number; w: number; h: number };

export type TextFill = 'white' | 'off_black';

export type Block = {
  role: BlockRole;
  text: string;
  /** Where the layout put it: centered by default (cover: off the faces). */
  region: Rect;
  /** Chosen per block from the photo behind it (the contrast rule, DESIGN_SPEC section 3). */
  fill: TextFill;
  /** 0 to the darken cap: black overlay strength applied to the photo under this block. */
  darken: number;
};

export type Slide = {
  kind: SlideKind;
  photoId: string;
  blocks: Block[];
};

export const POST_STATUSES = ['preview', 'review', 'published', 'rejected'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export type Post = {
  id: string;
  /** Creation order; the photo rest rule counts posts with it. */
  seq: number;
  runId: string | null;
  /** The first tip (kept for older rows). */
  tipId: string | null;
  /** Every tip on the post, in slide order: one per tip slide. */
  tipIds: string[];
  slug: string;
  nyDate: string;
  status: PostStatus;
  /** One `cover`, 3-6 `tip` slides, one `follow` (5-8 total). */
  slides: Slide[];
  photoIds: string[];
  caption: string;
  renderVersion: number;
  slideObjects: string[] | null;
  fitProblems: string[];
  renderProblems: string[];
  /** The Writer's soft guidance for the review screen; never a reason to reject. */
  softNotes: string[];
  approvedBy: string | null;
};

/** Tip slides per post, 3 to 6 (the cover and Follow are extra). */
export const TIP_SLIDES_MIN = 3;
/** Raised from 4 (Tommy, 2026-11-08: "I want more tips per post"). */
export const TIP_SLIDES_MAX = 6;
export const FOLLOW_HANDLE = '@heliosgroup.ai';

// ── Settings (rows of field_notes.settings) ─────────────────────────────────

export type FieldNotesSettings = {
  autoRun: boolean;
  publishingLive: boolean;
  requireApproval: boolean;
  runCapUsd: number;
  /** A photo sits out this many posts after use. */
  photoRestPosts: number;
  maxPendingDrafts: number;
  tipExpiryDays: number;
  /** Largest black overlay (0-1) behind the text; a slide still unreadable at this strength fails and the run swaps its photo. */
  darkenCap: number;
};

export const FIELD_NOTES_DEFAULT_SETTINGS: FieldNotesSettings = {
  autoRun: false,
  publishingLive: false,
  requireApproval: true,
  runCapUsd: 0.5,
  photoRestPosts: 8,
  maxPendingDrafts: 3,
  tipExpiryDays: 30,
  darkenCap: 0.45,
};
