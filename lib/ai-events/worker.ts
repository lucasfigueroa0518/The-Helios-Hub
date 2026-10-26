/**
 * The helios-social worker's AI Events step (plan M4): carry out a claimed run, put its post on
 * the spine and, while ai_events publishing_live is on, into its Sunday's 6:00–7:00 PM window;
 * then publish the public calendar snapshot (now with the week's picks) and record the outcome
 * and its spend on the run. The worker runs this in the same loop as Carousels and Last Few
 * Days, so no two runs ever overlap. scripts/ai_events_once.ts runs the same function by hand.
 */
import { calendarDateKey, SOCIAL_TIMEZONE } from '@/lib/instagram/clock';
import { comingWeek, weekFromKey } from '@/lib/networking/pick/week';
import type { HubQuery } from '@/lib/social-hub/db';

import { AI_EVENTS_POST_METROS, type AiEventsPostMetro } from './config';
import { aiEventsItemId } from './items';
import type { SnapshotPublisher } from './publish';
import { postDateFor, runAiEvents, type AiEventsEngineDeps, type AiEventsRunInput, type AiEventsRunResult } from './run';
import { scheduleAiEventsPost } from './schedule';
import { readAiEventsSettings } from './settings';
import { adoptRun, failRun, finishRun, weekPost, type ClaimedRun } from './store';

export type AiEventsLog = (message: string, fields?: Record<string, unknown>) => void;

export type CarryOutDeps = {
  query: HubQuery;
  now: () => Date;
  log: AiEventsLog;
  /** The engine's dependencies for this run (live: lib/ai-events/live.ts; tests: stubs). */
  engine: (run: ClaimedRun, capUsd: number) => Promise<AiEventsEngineDeps>;
  /** The public calendar snapshot (live: publishSnapshot over this connection). Its failure never fails the run. */
  snapshot: SnapshotPublisher;
  /** The engine itself (tests may pass a stub). */
  run?: (deps: AiEventsEngineDeps, input: AiEventsRunInput) => Promise<AiEventsRunResult>;
};

export type CarryOutResult = {
  runId: string;
  status: 'ok' | 'failed' | 'skipped';
  /** The city posts saved, Miami first (AE-29). */
  postIds?: string[];
  /** Each post's booked time, in the same order; null when not booked. */
  scheduled?: Array<string | null>;
  note?: string;
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The parts of a snapshot result worth keeping on the run record. */
function snapshotSummary(out: unknown): Record<string, unknown> {
  if (!out || typeof out !== 'object') return { ok: true };
  const o = out as Record<string, unknown>;
  const hook = o.hook && typeof o.hook === 'object' ? (o.hook as Record<string, unknown>) : null;
  return { ok: true, events: o.events ?? null, picks: o.picks ?? null, weekKey: o.weekKey ?? null, changed: o.changed ?? null, hookFired: hook?.fired ?? null };
}

export async function carryOutAiEventsRun(w: CarryOutDeps, claimed: ClaimedRun): Promise<CarryOutResult> {
  const now = w.now();
  const nyDate = calendarDateKey(now, SOCIAL_TIMEZONE);
  const finish = async (o: Parameters<typeof finishRun>[2]) => {
    if (!(await finishRun(w.query, claimed.id, o))) w.log('ai_events_run_finish_ignored', { runId: claimed.id, status: o.status });
  };
  try {
    const settings = await readAiEventsSettings(w.query);
    const cap = settings.runCapUsd;
    if (cap == null) {
      const error = `ai_events.settings.run_cap_usd is not a positive number (got ${JSON.stringify(settings.runCapRaw)}); refusing to run`;
      await finish({ status: 'failed', error, jevUsd: 0, record: {} });
      w.log('ai_events_run_failed', { runId: claimed.id, error });
      return { runId: claimed.id, status: 'failed', note: error };
    }
    // A rebuild names its week; a build covers the coming Monday to Sunday.
    const weekKey = claimed.weekKey ? weekFromKey(claimed.weekKey).weekKey : comingWeek(now).weekKey;
    await adoptRun(w.query, claimed.id, { capUsd: cap, nyDate, weekKey });

    // The Sunday clock only makes the cities that have no post yet; Rebuild post redoes made ones.
    const missing: AiEventsPostMetro[] = [];
    for (const metro of AI_EVENTS_POST_METROS) if (!(await weekPost(w.query, weekKey, metro))) missing.push(metro);
    if (claimed.trigger === 'scheduled' && !missing.length) {
      // The Sunday clock never redoes a week a person already made (Generate before noon): Rebuild post does that.
      const note = `The ${weekKey} posts already exist; the scheduled run made nothing new.`;
      await finish({ status: 'skipped', stopReason: `post-exists: ${note}`, jevUsd: 0, record: { kind: claimed.kind, weekKey } });
      w.log('ai_events_run_skipped', { runId: claimed.id, reason: 'post_exists', weekKey });
      return { runId: claimed.id, status: 'skipped', note };
    }

    w.log('ai_events_run_started', { runId: claimed.id, trigger: claimed.trigger, kind: claimed.kind, weekKey, capUsd: cap });
    const deps = await w.engine(claimed, cap);
    const res = await (w.run ?? runAiEvents)({ ...deps, now }, {
      runId: claimed.id,
      kind: claimed.kind,
      weekKey,
      capUsd: cap,
      ...(claimed.trigger === 'scheduled' ? { metros: missing } : {}),
    });

    if (!res.ok) {
      await finish({ status: 'failed', error: res.error, jevUsd: res.jevUsd, record: res.record });
      w.log('ai_events_run_failed', { runId: claimed.id, error: res.error, jevUsd: res.jevUsd });
      return { runId: claimed.id, status: 'failed', note: res.error };
    }
    if (res.outcome === 'skipped') {
      await finish({ status: 'skipped', stopReason: res.note, jevUsd: res.jevUsd, record: res.record });
      w.log('ai_events_run_skipped', { runId: claimed.id, note: res.note });
      return { runId: claimed.id, status: 'skipped', note: res.note };
    }

    // Each city's post on the spine and, while publishing is live, in its own window (Miami first).
    const booked: Array<{ metro: string; postId: string; scheduled: string | null; note: string | null }> = [];
    for (const p of res.posts) {
      await aiEventsItemId(w.query, p.postId);
      let scheduled: string | null = null;
      let note: string | null = null;
      if (settings.publishingLive) {
        // A fresh clock (the run took time); throughDate is the post's own Sunday, so it never books another week.
        const out = await scheduleAiEventsPost(w.query, p.postId, 'auto', w.now(), postDateFor(weekKey));
        scheduled = out.scheduled ? out.publishAt : null;
        note = out.scheduled ? null : out.note;
        w.log('ai_events_schedule', out.scheduled ? { runId: claimed.id, metro: p.metro, publishAt: out.publishAt } : { runId: claimed.id, metro: p.metro, note: out.note });
      }
      booked.push({ metro: p.metro, postId: p.postId, scheduled, note });
    }

    // The public calendar now carries this week's picks (plan M3). A failure is recorded, never thrown.
    const snapshot = await w
      .snapshot(claimed.kind === 'rebuild' ? 'ai_events rebuild' : 'ai_events run')
      .then(snapshotSummary)
      .catch((error) => {
        w.log('ai_events_snapshot_failed', { runId: claimed.id, error: errorText(error) });
        return { ok: false, error: errorText(error) };
      });

    await finish({
      status: 'ok',
      jevUsd: res.jevUsd,
      record: { ...res.record, posts: res.posts, skippedCities: res.skipped, booked, snapshot },
    });
    w.log('ai_events_run_complete', { runId: claimed.id, posts: res.posts.map((p) => ({ metro: p.metro, postId: p.postId, slides: p.slides, look: p.look, tier: p.tier })), jevUsd: res.jevUsd });
    return { runId: claimed.id, status: 'ok', postIds: res.posts.map((p) => p.postId), scheduled: booked.map((b) => b.scheduled) };
  } catch (error) {
    // Anything that threw before the run was finished: fail it now, so it never waits for the 2-hour sweep.
    const message = errorText(error);
    await failRun(w.query, claimed.id, message).catch(() => undefined);
    w.log('ai_events_run_failed', { runId: claimed.id, error: message });
    return { runId: claimed.id, status: 'failed', note: message };
  }
}

/**
 * `work`, or `onTimeout()` once `ms` pass first. A hung await must not stall the social
 * worker's loop (carousels, publishing, insights). The cut-off promise is not cancelled: it may
 * keep running in the background (accepted; the run row is already failed).
 */
export function withAiEventsTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => Promise<T> | T): Promise<T> {
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
