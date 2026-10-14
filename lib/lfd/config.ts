/** Last Few Days constants shared by the worker, the scheduler and the hub (spec §7.3, §7.4). Imports types only. */
import type { PostingWindow } from '@/lib/instagram/window';

/** Tuesday and Friday (0 = Sunday), used when lfd.settings has no usable `days` row (LFD-01). */
export const DEFAULT_LFD_DAYS: readonly number[] = [2, 5];

/** The run cap when lfd.settings has no `run_cap_usd` row (spec §9). */
export const DEFAULT_LFD_RUN_CAP_USD = 1;

/** The one posting window, on its days: 9:00–10:00 AM New York (LFD-01; schedule_slot_check allows only this slot). */
export const LFD_SLOT = 'morning';
export const LFD_WINDOW: PostingWindow = { id: LFD_SLOT, label: '9:00–10:00 AM', startMinute: 9 * 60, endMinute: 10 * 60 };

/** social.used_photos `story_id` prefix for a published post's photos (spec §5, the shared 7-day rule). */
export const LFD_PHOTO_STORY_PREFIX = 'lfd:';

/** Wall-clock limit on one in-process run in the helios-social loop (real runs take 3–8 minutes); past it the run is failed and the loop goes on. */
export const LFD_RUN_TIMEOUT_MS = 30 * 60_000;
