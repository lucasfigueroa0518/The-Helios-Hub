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
import { failRun, finishRun, type ClaimedRun } from './store';

export type LfdLog = (message: string, fields?: Record<string, unknown>) => void;

export type CarryOutDeps = {
  query: HubQuery;
  now: () => Date;
  log: LfdLog;
  /** The engine's dependencies for this run (live: lib/lfd/live.ts; tests: stubs). */
  engine: (run: ClaimedRun, capUsd: number) => Promise<LfdRunDeps>;
  /** The engine itself (tests pass a stub). */
  run?: (deps: LfdRunDeps) => ReturnType<typeof runLastFewDays>;
};

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
      await finishRun(w.query, claimed.id, { status: 'failed', error, claudeUsd: 0, jevUsd: 0, record: {} });
      w.log('lfd_run_failed', { runId: claimed.id, error });
      return { runId: claimed.id, status: 'failed', note: error };
    }
    if (claimed.trigger === 'scheduled') {
      // Daily fill (§7.4, D54): a post a person already placed for today is today's post. A manual run is never skipped.
      const fill = await dailyFill(w.query, 'last_few_days', nyDate, 1);
      if (fill.making < 1) {
        const note = quotaFilledNote(fill, 'Last Few Days post');
        await finishRun(w.query, claimed.id, { status: 'skipped', stopReason: `quota-filled: ${note}`, claudeUsd: 0, jevUsd: 0, record: { fill } });
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
