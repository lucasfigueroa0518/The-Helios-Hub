import type { Queryable } from '@/lib/explainers/db';
import { developmentSpendSince } from '@/lib/reel-ai-drama/cost';
import { labData, LabError, reelAiDramaRoute, saveCalibrationReport } from '@/lib/reel-ai-drama/lab';
import { requestJob } from '@/lib/reel-ai-drama/production/jobs';
import { weekStart } from '@/lib/reel-ai-drama/production/schedule';
import { isSettingKey, loadSettings, saveSetting } from '@/lib/reel-ai-drama/settings';

/**
 * The /api/reel-ai-drama handlers, here so tests can call them with a stubbed session and db (Next
 * route files may only export route fields). Nothing runs on page load: the only live actions are the
 * develop, calibrate and make POSTs, each a click that is its own approval.
 */

export type RouteOpts = {
  session?: () => Promise<{ email: string } | null>;
  db?: () => Promise<Queryable>;
  now?: () => Date;
  /** One development session (B1 runDevelopmentSession, trigger 'click'); default: the live wiring. */
  develop?: (db: Queryable) => Promise<unknown>;
  /** The calibration run (B1 runCalibration); default: the live wiring. */
  calibrate?: (db: Queryable) => Promise<unknown>;
  calibrationFile?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WHY: Record<string, string> = {
  not_found: 'That pitch is gone.',
  not_makeable: 'Only a pitch in the pool can be made.',
  already_running: 'That pitch is already being made.',
};

const wrap = (opts: RouteOpts) => ({ session: opts.session, db: opts.db });

export function labRoute(opts: RouteOpts = {}) {
  return reelAiDramaRoute(({ db }) => labData(db, { now: opts.now?.(), calibrationFile: opts.calibrationFile }), wrap(opts));
}

/** The lab's Make click: queues one production job for a pooled pitch (the worker runs it, ≤ the per-reel cap). */
export function makeRoute(request: Request, opts: RouteOpts = {}) {
  return reelAiDramaRoute(async ({ db }) => {
    const body = (await request.json().catch(() => null)) as { pitchId?: unknown } | null;
    const pitchId = typeof body?.pitchId === 'string' ? body.pitchId.trim() : '';
    if (!UUID.test(pitchId)) throw new LabError('Give a pitch id');
    const result = await requestJob(db, { pitchId, trigger: 'click', settings: await loadSettings(db) });
    if (!result.ok) throw new LabError(WHY[result.reason] ?? result.reason, 409);
    return result;
  }, wrap(opts));
}

/** The lab's Develop click: one development session now, refused once the week's cap is spent (MD-28). */
export function developRoute(_request: Request, opts: RouteOpts = {}) {
  return reelAiDramaRoute(async ({ db }) => {
    const settings = await loadSettings(db);
    const spent = await developmentSpendSince(db, weekStart(opts.now?.() ?? new Date()));
    if (spent >= settings.weekly_dev_cap_usd) {
      throw new LabError(`This week's development budget is spent ($${spent.toFixed(2)} of $${settings.weekly_dev_cap_usd.toFixed(2)}).`, 409);
    }
    const run = opts.develop ?? (async (d: Queryable) => (await import('@/lib/reel-ai-drama/production/live')).runLiveDevelopment(d, 'click'));
    return { session: await run(db) };
  }, wrap(opts));
}

/** The lab's Calibrate click (MD-52): Jev scores on the calibration set; the report is kept for the lab. */
export function calibrateRoute(_request: Request, opts: RouteOpts = {}) {
  return reelAiDramaRoute(async ({ db }) => {
    const run = opts.calibrate ?? (async (d: Queryable) => (await import('@/lib/reel-ai-drama/production/live')).runLiveCalibration(d));
    const report = await run(db);
    saveCalibrationReport(report, opts.calibrationFile);
    return { report };
  }, wrap(opts));
}

export function settingsGetRoute(opts: RouteOpts = {}) {
  return reelAiDramaRoute(async ({ db }) => ({ settings: await loadSettings(db) }), wrap(opts));
}

/** One setting changed from the lab; validated, since these values gate spend. */
export function settingsPostRoute(request: Request, opts: RouteOpts = {}) {
  return reelAiDramaRoute(async ({ db }) => {
    const body = (await request.json().catch(() => null)) as { key?: unknown; value?: unknown } | null;
    const key = typeof body?.key === 'string' ? body.key : '';
    if (!isSettingKey(key)) throw new LabError(`Unknown setting ${key || '(none)'}`);
    try {
      await saveSetting(db, key, body?.value as never);
    } catch (error) {
      throw new LabError(error instanceof Error ? error.message : String(error));
    }
    return { key, settings: await loadSettings(db) };
  }, wrap(opts));
}
