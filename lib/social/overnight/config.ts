/**
 * Carousel overnight constants (docs/social-overnight.md). Times are
 * America/New_York, the same zone and DST handling as Trial Reels.
 */
export { SOCIAL_TIMEZONE } from '@/lib/instagram/clock';


/** The daily run: 3:00 AM, an hour after Explainers, an hour before IG Stories. */
export const SOCIAL_RUN_HOUR_LOCAL = 3;
export const SOCIAL_RUN_MINUTE_LOCAL = 0;

/** The nightly insights sweep for carousels (Trial Reels 5:00, Explainers 5:15). */
export const SOCIAL_INSIGHTS_HOUR_LOCAL = 5;
export const SOCIAL_INSIGHTS_MINUTE_LOCAL = 30;

/** One carousel a day, in a window no Trial Reels slot overlaps. */
export const CAROUSEL_SLOT = { id: 'morning', label: '7:00–8:15 AM', startMinute: 7 * 60, endMinute: 8 * 60 + 15 } as const;
export type CarouselSlotId = typeof CAROUSEL_SLOT.id;

/** A run older than this is assumed dead (the CLI run takes ~15 minutes). */
export const SOCIAL_STALE_RUN_MINUTES = 90;

/** The worker run's defaults; both can be changed in social.settings. */
export const DEFAULT_RUN_STORIES = 2;
export const DEFAULT_RUN_CAP_USD = 2;

export const SLIDE_BUCKET = 'social-slides';

/** Meta fetches every slide while it builds the containers. */
export const PUBLISH_IMAGE_URL_SECONDS = 2 * 60 * 60;
export const PUBLISH_POLL_SECONDS = 10;
export const PUBLISH_POLL_TIMEOUT_MINUTES = 10;
export const PUBLISH_STALE_MINUTES = 30;

/** Instagram allows 2 to 10 items in a carousel. */
export const CAROUSEL_MIN_ITEMS = 2;
export const CAROUSEL_MAX_ITEMS = 10;
export const CAPTION_MAX_CHARS = 2200;

/** Skip a publish when fewer than this many posts are left in the account's 24-hour quota. */
export const PUBLISH_QUOTA_HEADROOM = 5;
