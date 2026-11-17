/** Last Few Days constants shared by the worker, the scheduler and the hub (spec §7.3, §7.4). Imports types only. */
import type { PostingWindow } from '@/lib/instagram/window';

/** Tuesday and Friday (0 = Sunday), used when lfd.settings has no usable `days` row (LFD-01). */
export const DEFAULT_LFD_DAYS: readonly number[] = [2, 5];

/** The run cap when lfd.settings has no `run_cap_usd` row (spec §9). */
export const DEFAULT_LFD_RUN_CAP_USD = 1;

/** The one posting window, on its days: 9:00–10:00 AM New York (LFD-01; schedule_slot_check allows only this slot). */
export const LFD_SLOT = 'morning';
export const LFD_WINDOW: PostingWindow = { id: LFD_SLOT, label: '9:00–10:00 AM', startMinute: 9 * 60, endMinute: 10 * 60 };

/** social.used_photos `story_id` prefix for a published post's photos (spec §5; the CI-32 used-photo ledger). */
export const LFD_PHOTO_STORY_PREFIX = 'lfd:';

// No run time limit: long runs are normal and never failed for length (lib/content-runs/hang-guard.ts; CI decision 2026-11-10).

/** The meme stage's spend cap when lfd.settings has no memes_cap_usd: 3 briefs and 3 meme runs come to about $0.50. */
export const DEFAULT_LFD_MEMES_CAP_USD = 1;

/** Unused majors then rundown to walk when the lineup still has no 92% meme story. */
export const MEME_POOL_SCAN = 8;
