// lib/lfd/worker.ts
/**
 * The helios-social worker's Last Few Days step (spec §7.3): carry out a
 * claimed run, then put its post on the spine and, while lfd publishing_live
 * is on, into its own day's 9:00–10:00 AM window. The worker runs this in the
 * same loop as the carousel run, so the two never overlap.
 */
import { calendarDateKey, SOCIAL_TIMEZONE } from '@/lib/instagram/clock';
import type { HubQuery } from '@/lib/social-hub/db';
import { dailyFill, quotaFilledNote } from '@/lib/social-hub/fill';

import { lfdItemId } from './items';
import { runLastFewDays, type LfdRunDeps } from './run';
import { scheduleLfdPost } from './schedule';
import { readLfdSettings } from './settings';
import { failRun, finishRun, recordMemesSpend, type ClaimedRun } from './store';

export type LfdLog = (message: string, fields?: Record<string, unknown>) => void;

export type CarryOutDeps = {
  query: HubQuery;
  now: () => Date;
  log: LfdLog;
  /** The engine's dependencies for this run (live: lib/lfd/live.ts; tests: stubs). */
  engine: (run: ClaimedRun, capUsd: number) => Promise<LfdRunDeps>;
  /** The engine itself (tests pass a stub). */
  run?: (deps: LfdRunDeps) => ReturnType<typeof runLastFewDays>;
  /**
   * Memes for the finished post (lib/memes/lfd-post.ts), while lfd.settings.memes is on. It never fails the run:
   * an error or a timeout leaves the post as the engine made it.
   */
  memes?: (postId: string, o: { capUsd: number; deps: LfdRunDeps }) => Promise<{ placed: number; gated: number; costUsd: number; skipped?: string }>;
};

/** The meme stage's own time limit: it must leave the 30-minute run timeout room. */
export const LFD_MEMES_TIMEOUT_MS = 12 * 60_000;

export type CarryOutResult = { runId: string; status: 'ok' | 'partial' | 'failed' | 'skipped'; postId?: string; scheduled?: string | null; note?: string };

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function carryOutLfdRun(w: CarryOutDeps, claimed: ClaimedRun): Promise<CarryOutResult> {
  const now = w.now();
  const nyDate = calendarDateKey(now, SOCIAL_TIMEZONE);
  try {
    const settings = await readLfdSettings(w.query);
    const cap = settings.runCapUsd;
    if (cap == null) {
      const error = `lfd.settings.run_cap_usd is not a positive number (got ${JSON.stringify(settings.runCapRaw)}); refusing to run`;
      if (!(await finishRun(w.query, claimed.id, { status: 'failed', error, claudeUsd: 0, jevUsd: 0, record: {} }))) w.log('lfd_run_finish_ignored', { runId: claimed.id, status: 'failed' });
      w.log('lfd_run_failed', { runId: claimed.id, error });
      return { runId: claimed.id, status: 'failed', note: error };
    }
    if (claimed.trigger === 'scheduled') {
      // Daily fill (§7.4, D54): a post a person already placed for today is today's post. A manual run is never skipped.
      const fill = await dailyFill(w.query, 'last_few_days', nyDate, 1);
      if (fill.making < 1) {
        const note = quotaFilledNote(fill, 'Last Few Days post');
        if (!(await finishRun(w.query, claimed.id, { status: 'skipped', stopReason: `quota-filled: ${note}`, claudeUsd: 0, jevUsd: 0, record: { fill } }))) {
          w.log('lfd_run_finish_ignored', { runId: claimed.id, status: 'skipped' });
        }
        w.log('lfd_run_skipped', { runId: claimed.id, reason: 'quota_filled', note });
        return { runId: claimed.id, status: 'skipped', note };
      }
    }
    w.log('lfd_run_started', { runId: claimed.id, trigger: claimed.trigger, capUsd: cap });
    const deps = await w.engine(claimed, cap);
    const res = await (w.run ?? runLastFewDays)({ ...deps, runId: claimed.id, trigger: claimed.trigger, capUsd: cap, now });
    if (!res.ok) {
      w.log('lfd_run_failed', { runId: claimed.id, error: res.error });
      return { runId: claimed.id, status: 'failed', note: res.error };
    }
    // A run that finished after the worker timed it out: its row stays failed (lib/lfd/store.ts finishRun).
    if (res.recorded === false) w.log('lfd_run_finish_ignored', { runId: claimed.id, status: res.short ? 'partial' : 'ok', postId: res.postId });
    // Memes go in before the post is placed, so what gets scheduled is the final post.
    if (w.memes && settings.memes && res.recorded !== false) {
      const out = await withLfdTimeout(
        w.memes(res.postId, { capUsd: settings.memesCapUsd, deps }).catch((error) => ({ placed: 0, gated: 0, costUsd: 0, skipped: `error: ${errorText(error)}` })),
        LFD_MEMES_TIMEOUT_MS,
        () => ({ placed: 0, gated: 0, costUsd: 0, skipped: 'timed out' }),
      );
      w.log('lfd_memes_result', { runId: claimed.id, postId: res.postId, ...out });
      if (out.costUsd > 0) await recordMemesSpend(w.query, claimed.id, out).catch((error) => w.log('lfd_memes_spend_failed', { runId: claimed.id, error: errorText(error) }));
    }
    await lfdItemId(w.query, res.postId);
    let scheduled: string | null = null;
    if (settings.publishingLive) {
      // A fresh clock: the run took time, and a window that closed while it ran must not be booked in the past.
      // throughDate stays the run's own day.
      const out = await scheduleLfdPost(w.query, res.postId, 'auto', w.now(), nyDate);
      scheduled = out.scheduled ? out.publishAt : null;
      w.log('lfd_schedule', out.scheduled ? { runId: claimed.id, publishAt: out.publishAt } : { runId: claimed.id, note: out.note });
    }
    w.log('lfd_run_complete', { runId: claimed.id, postId: res.postId, stories: res.stories, short: res.short });
    return { runId: claimed.id, status: res.short ? 'partial' : 'ok', postId: res.postId, scheduled };
  } catch (error) {
    // Anything that threw before the engine finished the run: fail it now, so it never waits for the 2-hour sweep.
    const message = errorText(error);
    await failRun(w.query, claimed.id, message).catch(() => undefined);
    w.log('lfd_run_failed', { runId: claimed.id, error: message });
    return { runId: claimed.id, status: 'failed', note: message };
  }
}

/**
 * `work`, or `onTimeout()` once `ms` pass first. The worker runs a Last Few
 * Days run in its own loop, so a hung await must not stall carousels,
 * publishing or insights. The cut-off promise is not cancelled: it may keep
 * running in the background (accepted; the run row is already failed).
 */
export function withLfdTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => Promise<T> | T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      Promise.resolve()
        .then(onTimeout)
        .then(resolve, reject);
    }, ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
