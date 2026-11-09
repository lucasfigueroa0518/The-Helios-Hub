/** Field Notes constants shared by the worker, the scheduler and the hub (mirrors lib/ai-events/config.ts). Imports types only. */
import type { PostingWindow } from '@/lib/instagram/window';
import type { FeedVertical as PublishFeedVertical } from '@/lib/social/overnight/publish';
import type { SpineVertical } from '@/lib/social-hub/spine';
import type { FeedVertical as SlotFeedVertical } from '@/lib/social-hub/slots/scheduler';

import { FIELD_NOTES_DEFAULT_SETTINGS, FIELD_NOTES_VERTICAL } from './types';

export { FIELD_NOTES_VERTICAL };

/** The same id, typed for the spine and slot helpers. */
export const FIELD_NOTES_SPINE_VERTICAL: SpineVertical = FIELD_NOTES_VERTICAL;
export const FIELD_NOTES_SLOT_VERTICAL: SlotFeedVertical = FIELD_NOTES_VERTICAL;
/**
 * The same id, typed for lib/social/overnight/publish.ts. That file's `FeedVertical` union does
 * not list 'field_notes' yet (the spine builder widens it); the cast keeps this file compiling
 * before and after. Remove the cast once the union has the id.
 */
export const FIELD_NOTES_FEED_VERTICAL = FIELD_NOTES_VERTICAL as unknown as PublishFeedVertical;

/** The run cap when field_notes.settings has no `run_cap_usd` row. */
export const DEFAULT_FIELD_NOTES_RUN_CAP_USD = FIELD_NOTES_DEFAULT_SETTINGS.runCapUsd;

/** The worker's daily check, 12:00 PM New York (kept for symmetry; auto_run ships off). */
export const FIELD_NOTES_RUN_HOUR_LOCAL = 12;
export const FIELD_NOTES_RUN_MINUTE_LOCAL = 0;

/** Weekdays (0 = Sunday) an auto run would queue on once auto_run is on: Tuesday and Friday (cadence 1 to 2 a week). Never used while auto_run is off. */
export const FIELD_NOTES_AUTO_DAYS: readonly number[] = [2, 5];

/** The one posting window (the spine's schedule CHECK allows only 'afternoon' for field_notes): 2:30-3:30 PM New York. */
export const FIELD_NOTES_SLOT = 'afternoon';
export const FIELD_NOTES_WINDOW: PostingWindow = { id: FIELD_NOTES_SLOT, label: '2:30–3:30 PM', startMinute: 14 * 60 + 30, endMinute: 15 * 60 + 30 };

/** Storage prefix for the slide JPEGs (storeFieldNotesJpegs). */
export const FIELD_NOTES_SLIDE_PREFIX = 'field-notes';

/** Wall-clock limit on one in-process run in the helios-social loop; past it the run is failed and the loop goes on. */
export const FIELD_NOTES_RUN_TIMEOUT_MS = 30 * 60_000;

/** A due slot later than this is cancelled, not posted late. */
export const FIELD_NOTES_MISSED_AFTER_MINUTES = 120;

/** What the budget keeps free for one more Claude call (about max_tokens of output plus the cached prompt, with margin). */
export const FIELD_NOTES_CALL_RESERVE_USD = 0.1;
