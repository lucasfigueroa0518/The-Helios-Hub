/**
 * What the Stories tab can do (plan §8, M4). Route files are thin: they check
 * the session and call these. The app never builds or publishes a set; it
 * inserts rows the worker acts on (plan §4).
 */
import type { Queryable, StoriesDb } from '@/lib/stories/db';
import type { Series } from '@/lib/stories/render/types';
import {
  StaleStatusError,
  approveSet,
  getSet,
  listSets,
  nyDate,
  rejectSet,
  requestSet,
  scheduleSet,
  type SetStatus,
  type StorySet,
} from '@/lib/stories/repository';
import { SERIES, loadSettings, saveSeriesSetting } from '@/lib/stories/settings';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const QUEUE: SetStatus[] = ['requested', 'building', 'ready', 'approved', 'scheduled', 'publishing', 'failed', 'skipped'];
const HISTORY: SetStatus[] = ['published', 'rejected', 'failed'];
const TAGS = new Set(['story_choice', 'copy', 'photo', 'design', 'accuracy']);

export const isSeries = (s: unknown): s is Series => typeof s === 'string' && (SERIES as string[]).includes(s);

export async function listView(db: Queryable, view: 'queue' | 'history', series?: Series) {
  const sets = await listSets(db, { statuses: view === 'queue' ? QUEUE : HISTORY, series, limit: view === 'queue' ? 30 : 60 });
  const ids = sets.map((s) => s.id);
  const frames = ids.length
    ? (await db.query<{ set_id: string; id: string; seq: number; role: string; backdrop: string; flagged: boolean; storage_path: string | null }>(`SELECT set_id, id, seq, role, backdrop, flagged, storage_path FROM stories.frames WHERE set_id = ANY($1::uuid[]) ORDER BY seq`, [ids])).rows
    : [];
  const insights = view === 'history' && ids.length ? await setInsights(db, ids) : new Map();
  return sets.map((s) => ({ ...s, frames: frames.filter((f) => f.set_id === s.id), insights: insights.get(s.id) ?? null }));
}

/** Completion (last frame's reach ÷ first frame's) and exits on frames 1–3 (plan §7). */
async function setInsights(db: Queryable, setIds: string[]) {
  const { rows } = await db.query<{ set_id: string; seq: number; reach: number | null; exits: number | null; replies: number | null }>(
    `SELECT DISTINCT ON (f.id) f.set_id, f.seq, i.reach, i.exits, i.replies
       FROM stories.frames f JOIN stories.insights i ON i.frame_id = f.id
      WHERE f.set_id = ANY($1::uuid[]) ORDER BY f.id, i.captured_at DESC`,
    [setIds],
  );
  const out = new Map<string, { completion: number | null; exitsFirst3: number; replies: number; reachFirst: number | null }>();
  for (const id of setIds) {
    const fr = rows.filter((r) => r.set_id === id).sort((a, b) => a.seq - b.seq);
    if (!fr.length) continue;
    const first = fr[0]!.reach;
    const last = fr.at(-1)!.reach;
    out.set(id, { completion: first && last != null ? last / first : null, exitsFirst3: fr.filter((r) => r.seq <= 3).reduce((s, r) => s + (r.exits ?? 0), 0), replies: fr.reduce((s, r) => s + (r.replies ?? 0), 0), reachFirst: first });
  }
  return out;
}

export async function setDetail(db: Queryable, id: string) {
  const got = await getSet(db, id);
  if (!got) throw new ApiError(404, 'No such set.');
  const candidates = (await db.query(`SELECT origin, ref, payload, jev, score::float8 AS score, chosen, reason FROM stories.candidates WHERE set_id = $1 ORDER BY score DESC NULLS LAST`, [id])).rows;
  const costs = (await db.query(`SELECT component, vendor, model, sum(usd)::float8 AS usd, count(*)::int AS calls FROM stories.cost_events WHERE set_id = $1 GROUP BY component, vendor, model ORDER BY usd DESC`, [id])).rows;
  const feedback = (await db.query(`SELECT verdict, tags, note, created_by, created_at FROM stories.feedback WHERE set_id = $1 ORDER BY created_at DESC`, [id])).rows;
  return { ...got, candidates, costs, feedback };
}

/** Generate (S-05): Lucas's click is the approval boundary for the build's live calls. */
export async function generate(db: Queryable, series: unknown, by: string, now = new Date()): Promise<{ set: StorySet; created: boolean }> {
  if (!isSeries(series)) throw new ApiError(400, 'Unknown series.');
  const settings = await loadSettings(db);
  if (!settings.series[series].enabled) throw new ApiError(409, 'This series is turned off in Settings.');
  return requestSet(db, { series, nyDate: nyDate(now), trigger: 'click', style: settings.series[series].style, requestedBy: by });
}

const guard = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof StaleStatusError) throw new ApiError(409, 'This set has moved on; refresh to see where it is.');
    throw err;
  }
};

export const approve = (db: Queryable, id: string) => guard(() => approveSet(db, id));

export function reject(db: StoriesDb, id: string, body: { tags?: unknown; note?: unknown }, by: string) {
  const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === 'string' && TAGS.has(t)) : [];
  const note = typeof body.note === 'string' ? body.note.slice(0, 2000) : undefined;
  return guard(() => rejectSet(db, id, { tags, note, by }));
}

/** Regenerate: reject this set (kept as feedback) and ask for a new one for the same day. */
export async function regenerate(db: StoriesDb, id: string, by: string) {
  const got = await getSet(db, id);
  if (!got) throw new ApiError(404, 'No such set.');
  await guard(() => rejectSet(db, id, { note: 'regenerated', by }));
  return requestSet(db, { series: got.set.series, nyDate: got.set.ny_date, trigger: 'click', style: got.set.style, requestedBy: by });
}

/** Publish now: approve if needed, and post at the next minute (the worker is the clock). */
export async function publishNow(db: Queryable, id: string, now = new Date()) {
  const got = await getSet(db, id);
  if (!got) throw new ApiError(404, 'No such set.');
  if (got.set.status === 'ready') await approve(db, id);
  else if (!['approved', 'scheduled'].includes(got.set.status)) throw new ApiError(409, `A ${got.set.status} set can't be published.`);
  return guard(() => scheduleSet(db, id, now));
}

/** Settings (plan §8): enabled and the auto switch; turning auto on needs `confirm` (S-05). */
export async function updateSeries(db: Queryable, body: { series?: unknown; enabled?: unknown; auto?: unknown; confirm?: unknown }, by: string) {
  if (!isSeries(body.series)) throw new ApiError(400, 'Unknown series.');
  const patch: { enabled?: boolean; auto?: boolean } = {};
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
  if (typeof body.auto === 'boolean') {
    if (body.auto && body.confirm !== true) throw new ApiError(400, 'Turning auto on needs confirmation.');
    patch.auto = body.auto;
  }
  if (!Object.keys(patch).length) throw new ApiError(400, 'Nothing to change.');
  return saveSeriesSetting(db, body.series, patch, by);
}

export async function monthOverview(db: Queryable, now = new Date()) {
  const month = nyDate(now).slice(0, 7);
  const { rows } = await db.query<{ component: string; usd: number }>(
    `SELECT component, sum(usd)::float8 AS usd FROM stories.cost_events WHERE to_char(created_at AT TIME ZONE 'America/New_York', 'YYYY-MM') = $1 GROUP BY component ORDER BY usd DESC`,
    [month],
  );
  return { month, total: rows.reduce((s, r) => s + r.usd, 0), byComponent: rows };
}
