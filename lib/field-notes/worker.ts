/**
 * The helios-social worker's Field Notes step: carry out a claimed run, put its post on the
 * spine, and record the outcome and its spend on the run. The post waits for a person: nothing is
 * booked at run time (approval books it, schedule.ts), so a run never touches the calendar.
 * The worker runs this in the same loop as the other types, so no two runs ever overlap.
 */
import { calendarDateKey, SOCIAL_TIMEZONE } from '@/lib/instagram/clock';
import type { HubQuery } from '@/lib/social-hub/db';

import { fieldNotesItemId } from './items';
import { runFieldNotes, type FieldNotesEngineDeps, type FieldNotesRunInput, type FieldNotesRunResult } from './run';
import { readFieldNotesSettings } from './settings';
import { adoptRun, failRun, finishRun, type ClaimedRun } from './store';

export type FieldNotesLog = (message: string, fields?: Record<string, unknown>) => void;

export type CarryOutDeps = {
  query: HubQuery;
  now: () => Date;
  log: FieldNotesLog;
  /** The engine's dependencies for this run (live: lib/field-notes/live.ts; tests: stubs). */
  engine: (run: ClaimedRun, capUsd: number) => Promise<FieldNotesEngineDeps>;
  /** The engine itself (tests may pass a stub). */
  run?: (deps: FieldNotesEngineDeps, input: FieldNotesRunInput) => Promise<FieldNotesRunResult>;
};

export type CarryOutResult = {
  runId: string;
  status: 'ok' | 'failed' | 'skipped';
  postId?: string;
  note?: string;
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function carryOutFieldNotesRun(w: CarryOutDeps, claimed: ClaimedRun): Promise<CarryOutResult> {
  const now = w.now();
  const nyDate = calendarDateKey(now, SOCIAL_TIMEZONE);
  const finish = async (o: Parameters<typeof finishRun>[2]) => {
    if (!(await finishRun(w.query, claimed.id, o))) w.log('field_notes_run_finish_ignored', { runId: claimed.id, status: o.status });
  };
  try {
    const settings = await readFieldNotesSettings(w.query);
    const cap = settings.runCapUsd;
    if (cap == null) {
      const error = `field_notes.settings.run_cap_usd is not a positive number (got ${JSON.stringify(settings.runCapRaw)}); refusing to run`;
      await finish({ status: 'failed', error, claudeUsd: 0, jevUsd: 0, record: {} });
      w.log('field_notes_run_failed', { runId: claimed.id, error });
      return { runId: claimed.id, status: 'failed', note: error };
    }
    if (claimed.kind === 'rebuild') {
      const note = 'Field Notes has no rebuild yet; nothing was changed.';
      await finish({ status: 'skipped', stopReason: `rebuild-unsupported: ${note}`, claudeUsd: 0, jevUsd: 0, record: { kind: claimed.kind } });
      return { runId: claimed.id, status: 'skipped', note };
    }
    await adoptRun(w.query, claimed.id, { capUsd: cap, nyDate });

    w.log('field_notes_run_started', { runId: claimed.id, trigger: claimed.trigger, seedTipId: claimed.seedTipId, capUsd: cap });
    const deps = await w.engine(claimed, cap);
    const res = await (w.run ?? runFieldNotes)(
      { ...deps, now },
      {
        runId: claimed.id,
        kind: claimed.kind,
        seedTipId: claimed.seedTipId,
        capUsd: cap,
        settings: { photoRestPosts: settings.photoRestPosts, maxPendingDrafts: settings.maxPendingDrafts, tipExpiryDays: settings.tipExpiryDays, darkenCap: settings.darkenCap },
      },
    );

    if (!res.ok) {
      await finish({ status: 'failed', stopReason: res.stopReason, error: res.error, claudeUsd: res.claudeUsd, jevUsd: res.jevUsd, record: res.record });
      w.log('field_notes_run_failed', { runId: claimed.id, error: res.error, claudeUsd: res.claudeUsd, jevUsd: res.jevUsd });
      return { runId: claimed.id, status: 'failed', note: res.error };
    }
    if (res.outcome === 'skipped') {
      await finish({ status: 'skipped', stopReason: res.stopReason, claudeUsd: res.claudeUsd, jevUsd: res.jevUsd, record: res.record });
      w.log('field_notes_run_skipped', { runId: claimed.id, stopReason: res.stopReason });
      return { runId: claimed.id, status: 'skipped', note: res.note };
    }

    // The post joins the spine (so the hub lists it for approval). Nothing is booked here.
    await fieldNotesItemId(w.query, res.postId);
    await finish({ status: 'ok', claudeUsd: res.claudeUsd, jevUsd: res.jevUsd, record: res.record });
    w.log('field_notes_run_complete', { runId: claimed.id, postId: res.postId, slides: res.slides, claudeUsd: res.claudeUsd, jevUsd: res.jevUsd });
    return { runId: claimed.id, status: 'ok', postId: res.postId };
  } catch (error) {
    // Anything that threw before the run was finished: fail it now, so it never waits for the 2-hour sweep.
    const message = errorText(error);
    await failRun(w.query, claimed.id, message).catch(() => undefined);
    w.log('field_notes_run_failed', { runId: claimed.id, error: message });
    return { runId: claimed.id, status: 'failed', note: message };
  }
}

/**
 * `work`, or `onTimeout()` once `ms` pass first. A hung await must not stall the social
 * worker's loop (carousels, publishing, insights). The cut-off promise is not cancelled: it may
 * keep running in the background (accepted; the run row is already failed).
 */
export function withFieldNotesTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => Promise<T> | T): Promise<T> {
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
