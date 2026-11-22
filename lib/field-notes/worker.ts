/**
 * The helios-social worker's Field Notes step: carry out a claimed run, put its post on the
 * spine, and record the outcome and its spend on the run. The post waits for a person: nothing is
 * booked at run time (approval books it, schedule.ts), so a run never touches the calendar.
 * The post is dated with the run's target date (Bald-Eagle D4): the date the 2:00 AM clock queued it for
 * (clock.ts, 2 days ahead), or today for a person's Generate, which has none.
 * The worker runs this in the same loop as the other types, so no two runs ever overlap.
 *
 * Refill split (settings standard D3, D14, D16): every run finds and scores new tips first, held to
 * pool_refill_cap_usd (run.ts refillTips), and logs `refill_capped` when that cap stops it. A refill-only run (the
 * clock's refill night, clock.ts refillNight) stops there and makes no post. A person's Generate or Make it runs in
 * every state, as before.
 */
import { calendarDateKey, SOCIAL_TIMEZONE } from '@/lib/instagram/clock';
import { beginRefill, settleRefill } from '@/lib/content-type/refill-total';
import type { HubQuery } from '@/lib/social-hub/db';
import { logRefillCapped, readTypeGate } from '@/lib/social/refill';

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
  // The date the post is for: the clock's target, else (a person's Generate) today.
  const nyDate = claimed.nyDate ?? calendarDateKey(now, SOCIAL_TIMEZONE);
  const finish = async (o: Parameters<typeof finishRun>[2]) => {
    if (!(await finishRun(w.query, claimed.id, o))) w.log('field_notes_run_finish_ignored', { runId: claimed.id, status: o.status });
  };
  try {
    const settings = await readFieldNotesSettings(w.query);
    // The state and the refill cap (D14, D16); reading them logs state_mismatch.
    const gate = await readTypeGate(w.query, 'field_notes', w.log);
    const refillOnly = claimed.refillOnly === true;
    // A refill-only run spends only the refill cap; it does not need a usable run cap.
    const cap = refillOnly ? gate.refillCapUsd : settings.runCapUsd;
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
    // The nightly total of all refills (D19), for the clock's runs only (a person's Generate is not held to it): the
    // refill cap is cut to what is left of it. No room: a refill-only run is skipped; a make run makes without refilling.
    const scheduled = claimed.trigger === 'scheduled';
    const grant = scheduled ? await beginRefill(w.query, 'field_notes', gate.refillCapUsd, { ref: `run:${claimed.id}`, log: w.log, now }) : null;
    if (scheduled && !grant && refillOnly) {
      const note = "Tonight's refill total is used up; the tip pool refills next time.";
      await finish({ status: 'skipped', stopReason: `refill-total-capped: ${note}`, claudeUsd: 0, jevUsd: 0, record: {} });
      return { runId: claimed.id, status: 'skipped', note };
    }
    const refillCap = grant ? grant.capUsd : gate.refillCapUsd;
    const runCap = refillOnly ? refillCap : cap;
    await adoptRun(w.query, claimed.id, { capUsd: runCap, nyDate });

    w.log('field_notes_run_started', { runId: claimed.id, trigger: claimed.trigger, seedTipId: claimed.seedTipId, capUsd: runCap, refillCapUsd: refillCap, ...(refillOnly ? { refillOnly: true } : {}) });
    const deps = await w.engine(claimed, runCap);
    const res = await (w.run ?? runFieldNotes)(
      { ...deps, now },
      {
        runId: claimed.id,
        kind: claimed.kind,
        seedTipId: claimed.seedTipId,
        capUsd: runCap,
        refillCapUsd: refillCap,
        ...(refillOnly ? { refillOnly: true } : {}),
        ...(scheduled && !grant ? { skipRefill: true } : {}),
        nyDate,
        settings: { photoRestPosts: settings.photoRestPosts, maxPendingDrafts: settings.maxPendingDrafts, tipExpiryDays: settings.tipExpiryDays, darkenCap: settings.darkenCap },
      },
    );

    const refill = (res.record as { refill?: { capped?: boolean; spentUsd?: number } }).refill;
    await settleRefill(w.query, grant, refill?.spentUsd ?? 0, w.log);
    if (refill?.capped) logRefillCapped(w.log, 'field_notes', { capUsd: refillCap, spentUsd: refill.spentUsd, step: 'tip-scoring', runId: claimed.id });

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
