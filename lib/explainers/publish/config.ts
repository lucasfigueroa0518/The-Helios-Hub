import type { PostingWindow } from '@/lib/instagram/window';

/**
 * Explainer Reels overnight constants (docs/social-overnight.md). Times are
 * America/New_York.
 */

/** The daily idea cycle: 2:00 AM, an hour after Trial Reels, an hour before Carousels. */
export const IDEA_CYCLE_HOUR_NY = 2;

/** The nightly insights sweep (Trial Reels 5:00, Carousels 5:30). */
export const EXPLAINERS_INSIGHTS_HOUR_NY = 5;
export const EXPLAINERS_INSIGHTS_MINUTE_NY = 15;

/**
 * Two explainer windows a day (SH-46, Social Hub P2-M2). Windows may overlap
 * other types; any two feed posts stay ≥ 30 minutes apart (SH-47).
 */
export const EXPLAINER_WINDOWS: readonly PostingWindow[] = [
  { id: 'afternoon', label: '1:00–2:30 PM', startMinute: 13 * 60, endMinute: 14 * 60 + 30 },
  { id: 'late', label: '3:30–5:00 PM', startMinute: 15 * 60 + 30, endMinute: 17 * 60 },
];
/** The first window (kept for callers that name one). */
export const EXPLAINER_WINDOW: PostingWindow = EXPLAINER_WINDOWS[0]!;

/** Explainers posted per day (SH-48): an explainers.settings `posts_per_day` row overrides. */
export const DEFAULT_POSTS_PER_DAY = 2;

/** Meta downloads the video while it builds the container. */
export const PUBLISH_VIDEO_URL_SECONDS = 2 * 60 * 60;
export const PUBLISH_POLL_SECONDS = 10;
export const PUBLISH_POLL_TIMEOUT_MINUTES = 10;
export const PUBLISH_STALE_MINUTES = 30;
export const CAPTION_MAX_CHARS = 2200;

/** Skip a publish when fewer than this many posts are left in the shared account's 24-hour quota. */
export const PUBLISH_QUOTA_HEADROOM = 5;
