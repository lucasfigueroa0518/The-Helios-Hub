/** AI Events This Week constants shared by the worker, the scheduler and the hub (plan M4, AE-08). Imports types only. */
import type { PostingWindow } from '@/lib/instagram/window';
import type { SpineVertical } from '@/lib/social-hub/spine';
import type { FeedVertical as SlotFeedVertical } from '@/lib/social-hub/slots/scheduler';

/** The spine vertical (AE-01). */
export const AI_EVENTS_VERTICAL = 'ai_events' as const;

/** The same id, typed for the spine and slot helpers (SpineVertical, the slot scheduler's FeedVertical). */
export const AI_EVENTS_SPINE_VERTICAL: SpineVertical = AI_EVENTS_VERTICAL;
export const AI_EVENTS_SLOT_VERTICAL: SlotFeedVertical = AI_EVENTS_VERTICAL;

/** Sunday (0 = Sunday), used when ai_events.settings has no usable `days` row (AE-08). */
export const DEFAULT_AI_EVENTS_DAYS: readonly number[] = [0];

/** The run cap when ai_events.settings has no `run_cap_usd` row (plan M2 step 6: expected about $0.02 a week). */
export const DEFAULT_AI_EVENTS_RUN_CAP_USD = 0.5;

/** The ranking and render clock: Sunday 12:00 PM New York (AE-08), between the 9:00 AM ingest and the evening post. */
export const AI_EVENTS_RUN_HOUR_LOCAL = 12;
export const AI_EVENTS_RUN_MINUTE_LOCAL = 0;

/** Miami's posting window, on its days: 6:00–7:00 PM New York (AE-08, AE-29). */
export const AI_EVENTS_SLOT = 'evening';
export const AI_EVENTS_WINDOW: PostingWindow = { id: AI_EVENTS_SLOT, label: '6:00–7:00 PM', startMinute: 18 * 60, endMinute: 19 * 60 };
/** Boston's posting window, an hour later: 7:00–8:00 PM New York (AE-29). */
export const AI_EVENTS_NIGHT_SLOT = 'night';
export const AI_EVENTS_NIGHT_WINDOW: PostingWindow = { id: AI_EVENTS_NIGHT_SLOT, label: '7:00–8:00 PM', startMinute: 19 * 60, endMinute: 20 * 60 };

/** The cities that get a weekly post, in posting order (AE-29). NYC and SF are ranked for the site only. */
export const AI_EVENTS_POST_METROS = ['miami', 'boston'] as const;
export type AiEventsPostMetro = (typeof AI_EVENTS_POST_METROS)[number];

/**
 * Facebook Places IDs Instagram's Graph API `location_id` takes (AE-34). Wikidata P1997; Facebook
 * redirects them to "Things to do in Miami, Florida" and "… Boston, Massachusetts".
 */
export const AI_EVENTS_IG_LOCATION_ID: Record<AiEventsPostMetro, string> = {
  miami: '110148382341970',
  boston: '106003956105810',
};

export function igLocationIdFor(metro: string | null | undefined): string | undefined {
  return metro === 'miami' || metro === 'boston' ? AI_EVENTS_IG_LOCATION_ID[metro] : undefined;
}

/** Each post city's window (legacy mode; template mode books the calendar's AI Events slots in order). */
export const AI_EVENTS_WINDOW_FOR: Record<AiEventsPostMetro, PostingWindow> = { miami: AI_EVENTS_WINDOW, boston: AI_EVENTS_NIGHT_WINDOW };

/** Storage prefix for the slide JPEGs (lib/social/overnight/slides.ts storeSlideJpegs). */
export const AI_EVENTS_SLIDE_PREFIX = 'ai-events';

/** Wall-clock limit on one in-process run in the helios-social loop; past it the run is failed and the loop goes on. */
export const AI_EVENTS_RUN_TIMEOUT_MS = 30 * 60_000;

/** A due slot later than this is cancelled, not posted late (the Last Few Days rule). */
export const AI_EVENTS_MISSED_AFTER_MINUTES = 60;
