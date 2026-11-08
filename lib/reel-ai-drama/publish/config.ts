import type { PostingWindow } from '@/lib/instagram/window';

/**
 * Reel AI Drama posting constants (planning/AI Mini Docs/HUB-WIRING-CONTRACT.md §1.2, §4). Times are
 * America/New_York. Kept apart from hub.ts so settings.ts can read them without an import cycle.
 */

/** The legacy (pre-calendar) window: one evening reel, 8:00–8:45 PM. */
export const DRAMA_WINDOWS: readonly PostingWindow[] = [{ id: 'evening', label: '8:00–8:45 PM', startMinute: 1200, endMinute: 1245 }];

/** The nightly fill requests the New York day's production jobs from 00:00, once per day. */
export const DRAMA_NIGHT_HOUR_NY = 0 as const;

/** The nightly insights sweep (explainers 5:15, carousels 5:30). */
export const DRAMA_INSIGHTS_HOUR_NY = 5 as const;
export const DRAMA_INSIGHTS_MINUTE_NY = 30 as const;

export const DEFAULT_DRAMA_POSTS_PER_DAY = 1;
