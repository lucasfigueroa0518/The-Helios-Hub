import type { Queryable } from '@/lib/explainers/db';
import { developmentSpendSince } from '@/lib/reel-ai-drama/cost';
import { labData, LabError, reelAiDramaRoute } from '@/lib/reel-ai-drama/lab';
import { weekStart } from '@/lib/reel-ai-drama/production/schedule';
import {
  cancelDramaJob,
  DRAMA_REFUSAL_TEXT,
  DramaActionError,
  queueDramaRequest,
  rejectPitch,
  requestDramaJob,
  retryDramaJob,
  revivePitch,
  type DramaRequestKind,
} from '@/lib/reel-ai-drama/requests';
import { EDITABLE_KEYS, isEditableKey, loadSettings, loadSettingsReport, saveSettings, SettingsError } from '@/lib/reel-ai-drama/settings';

/**
 * The /api/reel-ai-drama handlers, here so tests can call them with a stubbed session and db (Next route files may only
 * export route fields). No handler runs a model: Make queues a job, Develop and Calibrate queue a request the worker
 * claims (HUB-WIRING-CONTRACT.md §2.2). Every click is its own approval.
 */

export type RouteOpts = {
  session?: () => Promise<{ email: string } | null>;
  db?: () => Promise<Queryable>;
  now?: () => Date;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const wrap = (opts: RouteOpts) => ({ session: opts.session, db: opts.db });
const body = async <T>(request: Request): Promise<T | null> => (await request.json().catch(() => null)) as T | null;
const asLab = (error: unknown): never => {
  if (error instanceof DramaActionError) throw new LabError(error.message, error.status);
  throw error;
};

export function labRoute(opts: RouteOpts = {}) {
  return reelAiDramaRoute(({ db }) => labData(db, { now: opts.now?.() }), wrap(opts));
}

/** Make it: queues one production job for a pitch (the worker runs it), under the per-reel and daily caps. */
export function makeRoute(request: Request, opts: RouteOpts = {}) {
  return reelAiDramaRoute(async ({ db, by }) => {
    const b = await body<{ pitchId?: unknown }>(request);
    const pitchId = typeof b?.pitchId === 'string' ? b.pitchId.trim() : '';
    if (!UUID.test(pitchId)) throw new LabError('Give a pitch id');
    const result = await requestDramaJob(db, { pitchId, by, now: opts.now?.() });
    if (!result.ok) throw new LabError(DRAMA_REFUSAL_TEXT[result.reason], 409);
    return result;
  }, wrap(opts));
}

async function queueRoute(kind: DramaRequestKind, opts: RouteOpts) {
  return reelAiDramaRoute(async ({ db, by }) => {
    if (kind === 'develop') {
      const settings = await loadSettings(db);
      const spent = await developmentSpendSince(db, weekStart(opts.now?.() ?? new Date()));
      if (spent >= settings.weekly_dev_cap_usd) {
        throw new LabError(`This week's development budget is spent ($${spent.toFixed(2)} of $${settings.weekly_dev_cap_usd.toFixed(2)}).`, 409);
      }
    }
    const queued = await queueDramaRequest(db, kind, by);
    if (!queued) throw new LabError(kind === 'develop' ? 'A development session is already queued or running.' : 'A calibration is already queued or running.', 409);
    const { NextResponse } = await import('next/server');
    return NextResponse.json({ requestId: queued.requestId, status: 'requested' }, { status: 202 });
  }, wrap(opts));
}

/** Develop: queues one development session for the worker (refused once the week's cap is spent, MD-28). */
export function developRoute(_request: Request, opts: RouteOpts = {}) {
  return queueRoute('develop', opts);
}

/** Calibrate (MD-52): queues the Jev calibration for the worker; its report lands in calibration_reports. */
export function calibrateRoute(_request: Request, opts: RouteOpts = {}) {
  return queueRoute('calibrate', opts);
}

export function settingsGetRoute(opts: RouteOpts = {}) {
  return reelAiDramaRoute(async ({ db }) => {
    const { settings, problems } = await loadSettingsReport(db);
    return { settings, editable: [...EDITABLE_KEYS], problems };
  }, wrap(opts));
}

/**
 * Save settings: `{ values: { key: value, … } }` (the legacy `{ key, value }` is still accepted). Only editable keys;
 * every key and the cross-field rules are checked together, and nothing is saved on a 400 (`fields` says why per key).
 */
export function settingsPostRoute(request: Request, opts: RouteOpts = {}) {
  return reelAiDramaRoute(async ({ db, by }) => {
    const b = await body<{ values?: unknown; key?: unknown; value?: unknown }>(request);
    let values: Record<string, unknown>;
    if (b && typeof b.values === 'object' && b.values !== null && !Array.isArray(b.values)) values = b.values as Record<string, unknown>;
    else if (b && typeof b.key === 'string') values = { [b.key]: b.value };
    else throw new LabError('Send { values: { key: value } }.');
    const keys = Object.keys(values);
    if (!keys.length) throw new LabError('Nothing to save.');
    const fields: Record<string, string> = {};
    for (const key of keys) if (!isEditableKey(key)) fields[key] = `${key} can’t be changed here.`;
    if (Object.keys(fields).length) throw new LabError(Object.values(fields)[0]!, 400, fields);
    try {
      return { settings: await saveSettings(db, values, by) };
    } catch (error) {
      if (error instanceof SettingsError) throw new LabError(error.message, 400, error.fields);
      throw error;
    }
  }, wrap(opts));
}

const idOf = async (params: Promise<{ id: string }> | { id: string }) => {
  const { id } = await params;
  if (!UUID.test(id)) throw new LabError('Not found', 404);
  return id;
};

export function rejectPitchRoute(request: Request, params: Promise<{ id: string }> | { id: string }, opts: RouteOpts = {}) {
  return reelAiDramaRoute(async ({ db, by }) => {
    const id = await idOf(params);
    const b = await body<{ note?: unknown }>(request);
    const note = typeof b?.note === 'string' ? b.note.slice(0, 500) : null;
    return { pitch: await rejectPitch(db, id, by, note).catch(asLab) };
  }, wrap(opts));
}

export function revivePitchRoute(_request: Request, params: Promise<{ id: string }> | { id: string }, opts: RouteOpts = {}) {
  return reelAiDramaRoute(async ({ db }) => {
    const id = await idOf(params);
    return { pitch: await revivePitch(db, id, opts.now?.()).catch(asLab) };
  }, wrap(opts));
}

export function cancelJobRoute(_request: Request, params: Promise<{ id: string }> | { id: string }, opts: RouteOpts = {}) {
  return reelAiDramaRoute(async ({ db }) => cancelDramaJob(db, await idOf(params)).catch(asLab), wrap(opts));
}

export function retryJobRoute(_request: Request, params: Promise<{ id: string }> | { id: string }, opts: RouteOpts = {}) {
  return reelAiDramaRoute(async ({ db }) => retryDramaJob(db, await idOf(params)).catch(asLab), wrap(opts));
}
