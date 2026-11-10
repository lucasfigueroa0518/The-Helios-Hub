import { RUN_HANG_BACKSTOP_MINUTES } from '@/lib/content-runs/hang-guard';
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

/** Social Hub account sweep, after the per-type sweeps (docs/social-overnight.md clock; P2-M1). */
export const HUB_SWEEP_HOUR_LOCAL = 5;
export const HUB_SWEEP_MINUTE_LOCAL = 45;

/**
 * The nightly Instagram photo read (CI-32, lib/photos/ig-sync.ts): 11:45 PM, before the midnight builds, so
 * tonight's pickers see what went out today. Capped so a hung read can't stall the worker loop.
 */
export const IG_PHOTO_SYNC_HOUR_LOCAL = 23;
export const IG_PHOTO_SYNC_MINUTE_LOCAL = 45;
export const IG_PHOTO_SYNC_TIMEOUT_MS = 10 * 60_000;

/** Health tab morning report (spec 2026-10-13 §4.3): after Stories (4:00) and the 5:45 sweep. */
export const HEALTH_REPORT_HOUR_LOCAL = 7;
export const HEALTH_REPORT_MINUTE_LOCAL = 30;

/**
 * Two carousel windows a day (SH-46, Social Hub P2-M2). Windows may overlap
 * other types; any two feed posts stay ≥ 30 minutes apart (SH-47).
 */
export const CAROUSEL_SLOTS = [
  { id: 'morning', label: '9:00–10:00 AM', startMinute: 9 * 60, endMinute: 10 * 60 },
  { id: 'afternoon', label: '2:30–3:30 PM', startMinute: 14 * 60 + 30, endMinute: 15 * 60 + 30 },
] as const;
/** The first window (kept for callers that name one). */
export const CAROUSEL_SLOT = CAROUSEL_SLOTS[0];
export type CarouselSlotId = (typeof CAROUSEL_SLOTS)[number]['id'];

/** Carousels posted per day (SH-48): a social.settings `posts_per_day` row overrides. */
export const DEFAULT_POSTS_PER_DAY = 2;

/** A 'running' run older than this is assumed dead. Hang guard only; long runs are normal (CI decision 2026-11-10): 12 h backstop. */
export const SOCIAL_STALE_RUN_MINUTES = RUN_HANG_BACKSTOP_MINUTES;
/** A 'requested' run the worker never claimed in this long is failed (not a running run, so not a run limit). */
export const SOCIAL_UNCLAIMED_REQUEST_MINUTES = 90;

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

