/**
 * Every value here changes what gets ingested, kept, grouped, or shown, so each
 * one cites the decision that set it (R4: no silent defaults).
 */

/** ING-01 / D-031. */
export const RUN_TIMEZONE = 'America/New_York';
export const RUN_HOUR_LOCAL = 1;

/** RET-01 / D-044: the clock starts at ingest time, not publish time. */
export const RETENTION_DAYS = 21;

/** GAP-7 / D-007: what new sources are compared against. */
export const REFERENCE_POOL_HOURS = 72;

/** ING-02 / D-032: a ranked item is only "new" once per retention window. */
export const RANKED_REPEAT_DAYS = RETENTION_DAYS;

/** ING-02 / D-032: night one has no watermark, so look back a day. */
export const FIRST_NIGHT_LOOKBACK_HOURS = 24;

/** ING-04 / D-035: per article/feed source. Ranked lists ingest whole. */
export const ARTICLE_FEED_CAP = 15;

/** GRP-06 / D-058. */
export const GROUP_SIZE_CAP = 6;

/** GRP-01 / D-055: how many existing ideas a new source is compared against. */
export const SHORTLIST_LIMIT = 5;

/**
 * Headline-similarity floor for reaching Jev at all. Set from the first real
 * night: at 0.12 on plain `similarity`, 296 of 307 pairs came back with a
 * same-event probability at or below 0.1. Raising the floor and scoring on
 * word similarity cuts that noise without losing the true pairs.
 */
export const SHORTLIST_SIMILARITY_FLOOR = 0.35;

/**
 * Idea-to-idea merging (D-071). Code proposes pairs from headline similarity
 * across the two groups' members; Jev decides. Capped per run so a pathological
 * night cannot turn into hundreds of comparisons.
 */
export const IDEA_MERGE_MAX_PAIRS = 20;
export const IDEA_MERGE_SIMILARITY_FLOOR = 0.35;
/** Merging A into B can make B a match for C, so the pass repeats. */
export const IDEA_MERGE_PASSES = 3;
/** Two groups in one state, so each side gets a shorter excerpt than a pair. */
export const IDEA_MERGE_EXCERPT_CHARS = 700;

/**
 * GRP-03 / D-057: starting bar, to be tuned on Lucas's labels. Applied to the
 * same-event Noul probability and to the merge/link Choice confidence. Below
 * it the source stays its own post idea and is not flagged (D-029).
 */
export const HIGH_CONFIDENCE = 0.8;

/**
 * Scoring rubric (D-075). Jev returns a point on levels 0–4. Code divides by
 * this top index so 0.60 and 0.25 apply on a 0–1 scale. Five levels put 0.60
 * between "workable" (0.50) and "strong" (0.75): viable means the score leans
 * strong.
 */
export const SCORE_TOP_LEVEL = 4;
/** D-075. At or above this, a psychology framework is viable. */
export const VIABLE_FRAMEWORK = 0.6;
/** D-075. A viable framework this far, or farther, below the leader is dropped. */
export const FRAMEWORK_GAP = 0.25;
/** D-077. Any subject Noul at or above this adds the bonus once. */
export const BLOCKBUSTER_BAR = 0.8;
/** D-087. One bonus, or zero. Was 0.40 under D-077. */
export const BLOCKBUSTER_BONUS = 0.25;
/** Added to the net when the winning bucket is Ball Knowledge. */
export const BALL_KNOWLEDGE_BUMP = 0.08;
/** D-080. How many of yesterday's misses are rescored. Ties at the cutoff join them. */
export const CARRYOVER_MISSES = 10;

/** D-084. Primary member excerpt, in words. */
export const PRIMARY_EXCERPT_WORDS = 1_200;
/** D-084. Each supporting member. Merged duplicates send the headline only. */
export const SUPPORTING_EXCERPT_WORDS = 300;

/** JEV-06 / D-030: above this, treat the text as an injection attempt. */
export const PLANTED_INSTRUCTION_BAR = 0.7;

/** ING-03 / D-033: low confidence keeps the item, so the bar is deliberately high. */
export const OFF_TOPIC_BAR = 0.8;
export const JUNK_BAR = 0.8;
export const NON_ENGLISH_BAR = 0.8;

/** SRC-A4 / D-066. */
export const A4_NIGHTLY_FLOOR = 2;
export const A4_SHORTLIST_SIZE = 12;
/** Implementation ceiling: each pick costs GitHub calls. Retune at review. */
export const A4_NIGHTLY_CEILING = 5;
/** Lists discovered through the list-of-lists are expanded a few per night. */
export const A4_LISTS_EXPANDED_PER_NIGHT = 6;
/** On the editor's 0-3 rubric, "good" is the lowest score worth ingesting. */
export const A4_MIN_SCORE = 2;

/** WEB-05 / D-064. */
export const B6_MEMORY_NIGHTS = 7;
export const B6_MIN_INDEPENDENT_SOURCES = 2;
export const B6_MAX_ATTEMPTS = 2;

/** FND-05 / D-023: skip starting a run once month-to-date reaches this. */
export const MONTHLY_WATCH_USD = 50;

/**
 * A run whose process died leaves a `running` row that blocks the next night.
 * Comfortably longer than a real run, short enough to self-heal before 1 AM.
 */
export const STALE_RUN_MINUTES = 90;

/** JEV-01 / D-021: alias, with the resolved versioned ID logged per call. */
export const JEV_MODEL = 'jev-latest';

/** Jev list price, 2026-09: $0.042 per million input tokens. Output is free. */
export const JEV_USD_PER_MTOK = 0.042;

/** Jev 1.13: 32k tokens for state plus the longest question. Stay well under. */
export const JEV_EXCERPT_CHARS = 1200;

/** FND-04 / D-022. B6 is the only Claude call in Build 1 (D-065). */
export const B6_MODEL = 'claude-sonnet-5';

/** D-091. Build 3 copy and caption writer: one call per selected idea. */
export const COPY_MODEL = 'claude-sonnet-5';
/** A copy job still `running` after this was abandoned by a dead worker. */
export const COPY_STALE_MINUTES = 5;

/** Scene writer. Same Claude model as the other reels calls. */
export const VISUAL_SCENE_MODEL = 'claude-sonnet-5';
/** Two to four sentences. Enough room to finish, not enough to ramble into a second pass. */
export const VISUAL_SCENE_MAX_TOKENS = 800;
/** The plan's background model. */
export const VISUAL_IMAGE_MODEL = 'gpt-image-2';
/**
 * Exact 9:16. gpt-image-2 requires both edges to be multiples of 16, so the
 * plan's 1080×1920 reference is not a legal size. 1152×2048 is the nearest
 * exact 9:16 above that reference and under the 2K reliability ceiling.
 */
export const VISUAL_IMAGE_SIZE = '1152x2048';
/** The image guide's setting for a final asset. This frame is that asset. */
export const VISUAL_IMAGE_QUALITY = 'high';
/** The plan's "last ~10 scene blocks used on the feed." */
export const VISUAL_RECENT_SCENES = 10;
/** A frame that is still `running` after this was abandoned by a dead worker. */
export const VISUAL_STALE_MINUTES = 10;
/** Motion writer. Same Claude model as the scene writer. The system prompt is cached. */
export const MOTION_MODEL = 'claude-sonnet-5';
/** One timestamped 8-second prompt. Enough room to finish, not enough for a second draft. */
export const MOTION_MAX_TOKENS = 1200;
/** A video job still `running` after this was abandoned. Kling plus overlay can take minutes. */
export const VIDEO_STALE_MINUTES = 20;

/**
 * Kling 3.0 Standard on Fal accepts 3–15 seconds (D-103). Eight seconds with
 * sound off is $0.672, at the same $0.084 per second as the old 5-second clip.
 */
export const KLING_CLIP_SECONDS = 8;
/** Covers the working drafts plus a 2,200-character caption with room to spare. */
export const COPY_MAX_TOKENS = 5_000;

/**
 * ING-06 / D-036: below this we treat the text as a blurb rather than an
 * article and skip the item. Papers and model cards are exempt (D-067).
 * Visible through the `no_full_text` drop reason, so it is easy to retune.
 */
export const FULL_TEXT_MIN_CHARS = 600;

/**
 * When an adapter already holds the whole item (an abstract, a README, a
 * changelog entry), length is not evidence of truncation. This floor only
 * catches a parse that produced nothing usable.
 */
export const COMPLETE_TEXT_MIN_CHARS = 120;

/** Bodies longer than this are stored truncated; nothing downstream needs more. */
export const BODY_MAX_CHARS = 40_000;

export const USER_AGENT =
  'HeliosTrialReels/1.0 (+https://www.heliosgroup.tech; contact: ops@heliosgroup.ai)';

export const FETCH_TIMEOUT_MS = 20_000;
/** ING-08 / D-038: retry the source, then continue the night. */
export const FETCH_RETRIES = 2;
