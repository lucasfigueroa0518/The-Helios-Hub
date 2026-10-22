/**
 * Build one requested set end to end (plan §4): watch check (plan §9) →
 * the series' open ideas from stories.pool (refreshed first if the pool has
 * no refresh for the day) → series builder (M3, M6, M7) → save → render
 * stage (M2) → the ideas it used are marked used in the pool. The worker calls
 * this for each set it claims. A click on Generate (or an auto series) is the
 * approval boundary for these live calls (rule 0.1).
 */
import type { JevTransport } from '@/lib/reels/jev/runner';
import type { StoriesDb } from '@/lib/stories/db';
import { createStoriesJev } from '@/lib/stories/jev';
import type { PhotoFinder } from '@/lib/stories/photos';
import type { Renderer } from '@/lib/stories/render/render';
import type { ReviewCall } from '@/lib/stories/render/review';
import { leadKeysForPair, livePoolReads, markPoolUsed, openPool, refreshPoolIfDue, type OpenPool } from '@/lib/stories/pool';
import { applyMoves, tonightMoves, type IdeaAdjustment } from '@/lib/social-hub/views/moves';
import { QUEUE_LIVE, orderForNight } from '@/lib/social-hub/queue';
import { finishNightPlacements } from '@/lib/social-hub/queue-store';
import { storyKey } from '@/lib/stories/sources/reels';
import { runRenderStage } from '@/lib/stories/render-stage';
import { daySpendUsd, failSet, getSet, markSkipped, monthSpendUsd, recordCost, saveBuild } from '@/lib/stories/repository';
import { loadSettings } from '@/lib/stories/settings';
import type { StoriesStorage } from '@/lib/stories/storage';
import type { WriterCreate } from '@/lib/stories/writer';

import type { BuildDeps, BuildResult } from './common';
import { buildFreeVsPaid } from './free-vs-paid';
import { buildGuessTheNumber } from './guess-the-number';
import { buildMorningDownload } from './morning-download';

export type SetBuilderDeps = {
  db: StoriesDb;
  sourceDb: StoriesDb;
  jevTransport: JevTransport;
  write: WriterCreate;
  photos: PhotoFinder;
  renderer: Renderer;
  review: ReviewCall;
  storage: StoriesStorage;
  now?: () => Date;
  log?: (line: string) => void;
  /** Tests swap a series builder for a stub. */
  builders?: Partial<Record<'morning_download' | 'guess_the_number' | 'free_vs_paid', (d: BuildDeps) => Promise<BuildResult>>>;
};

export type SetBuildOutcome = { status: 'ready' | 'skipped' | 'failed'; detail: string; flagged?: boolean };

/** Build a set the worker has claimed (status `building`). */
export async function buildSet(deps: SetBuilderDeps, setId: string): Promise<SetBuildOutcome> {
  const got = await getSet(deps.db, setId);
  if (!got) throw new Error(`no set ${setId}`);
  const now = deps.now?.() ?? new Date();
  const settings = await loadSettings(deps.db);
  const spent = await monthSpendUsd(deps.db, now);
  if (spent >= settings.monthlyWatchUsd) {
    await markSkipped(deps.db, setId, `monthly watch reached ($${spent.toFixed(2)} of $${settings.monthlyWatchUsd})`);
    return { status: 'skipped', detail: 'monthly watch reached' };
  }
  const today = await daySpendUsd(deps.db, now);
  if (today >= settings.dailyCapUsd) {
    await markSkipped(deps.db, setId, `daily cap reached ($${today.toFixed(2)} of $${settings.dailyCapUsd})`);
    return { status: 'skipped', detail: 'daily cap reached' };
  }
  const photoUsdBefore = deps.photos.usd;
  try {
    const series = got.set.series;
    const pool = await seriesPool(deps, series, now);
    const jev = createStoriesJev(deps.jevTransport, deps.db);
    const bd: BuildDeps = { db: deps.db, sourceDb: deps.sourceDb, jev, write: deps.write, photos: deps.photos, settings, now, setId, nyDate: got.set.ny_date, pool };
    const builder = deps.builders?.[got.set.series] ?? { morning_download: buildMorningDownload, guess_the_number: buildGuessTheNumber, free_vs_paid: buildFreeVsPaid }[got.set.series];
    const result = await builder(bd);
    if (!result.ok) {
      await deps.db.query(`UPDATE stories.sets SET payload = payload || $2::jsonb WHERE id = $1`, [setId, JSON.stringify({ candidates: result.candidates.length })]);
      await markSkipped(deps.db, setId, result.skip);
      return { status: 'skipped', detail: result.skip };
    }
    await saveBuild(deps.db, setId, { payload: { ...result.payload, historyKeys: result.historyKeys }, frames: result.frames, candidates: result.candidates });
    if (pool) {
      const used = series === 'free_vs_paid' ? leadKeysForPair(pool.leads, (result.payload.pair ?? {}) as Record<string, unknown>) : result.historyKeys;
      await markPoolUsed(deps.db, series, used, now).catch((err) => deps.log?.(`pool: could not mark used: ${err instanceof Error ? err.message : String(err)}`));
      // The series' set is built from the pool: hand placements for this series are used up and its ideas compete by score again.
      if (QUEUE_LIVE.has('stories')) await finishNightPlacements((text, params) => deps.db.query(text, params as never) as never, 'stories', `stories:pool:${series}:`);
    }
    const photoUsd = deps.photos.usd - photoUsdBefore;
    if (photoUsd > 0) await recordCost(deps.db, { setId, vendor: 'jev', component: 'photo-finder', usd: photoUsd });
    const r = await runRenderStage({ db: deps.db, storage: deps.storage, renderer: deps.renderer, review: deps.review, setId });
    return { status: 'ready', detail: r.log.join('; '), flagged: r.flagged };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failSet(deps.db, setId, message).catch(() => {});
    return { status: 'failed', detail: message };
  }
}

/**
 * The series' open ideas. The pool refreshes first when it has no refresh for
 * the day (a Generate before the 4:00 AM pass). Null when stories.pool cannot
 * be read (schema not applied yet): the build reads its sources directly.
 */
async function seriesPool(deps: SetBuilderDeps, series: 'morning_download' | 'guess_the_number' | 'free_vs_paid', now: Date): Promise<OpenPool | null> {
  try {
    const r = await refreshPoolIfDue(deps.db, () => livePoolReads(deps.sourceDb, now), now);
    if (r) deps.log?.(`pool: refreshed before build (${r.upserted} in, ${r.dropped} dropped${r.errors.length ? `; ${r.errors.join('; ')}` : ''})`);
    return await inDayOrder(deps.db, series, await openPool(deps.db, series), now);
  } catch (err) {
    deps.log?.(`pool: unavailable, reading sources directly: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * A series' active Promote / Demote moves (social_hub.idea_adjustments, the
 * hub's `stories:pool:<series>:<key>` ids), oldest first, as pool keys. A
 * move steers until its pool entry is used (B8; the hub marks it consumed),
 * not until midnight. Before consumed_at exists: today's moves, as before.
 */
export async function activeStoryMoves(db: SetBuilderDeps['db'], series: string, now = new Date()): Promise<Array<{ ideaId: string; kind: 'promote' | 'demote' }>> {
  const prefix = `stories:pool:${series}:`;
  type Row = { idea_id: string; kind: 'promote' | 'demote' };
  const read = (where: string, params: unknown[]) =>
    db.query<Row>(`SELECT idea_id, kind FROM social_hub.idea_adjustments WHERE vertical = 'stories' AND idea_id LIKE $1 ${where} ORDER BY created_at`, [`${prefix}%`, ...params]);
  const { rows } = await read('AND consumed_at IS NULL', []).catch(() => {
    const nyDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
    return read('AND ny_date = $2::date', [nyDate]).catch(() => ({ rows: [] as Row[] }));
  });
  return rows.map((r) => ({ ideaId: r.idea_id.slice(prefix.length), kind: r.kind }));
}

/** The series' pool in the shared queue's order (views/moves.ts): its oldest promote first, demoted ideas last. */
async function inDayOrder(db: SetBuilderDeps['db'], series: string, pool: OpenPool, now: Date): Promise<OpenPool> {
  if (QUEUE_LIVE.has('stories')) return inQueueOrder(db, series, pool);
  const moves = await activeStoryMoves(db, series, now);
  if (!moves.length) return pool;
  const order = <T>(list: T[], key: (x: T) => string) => applyMoves(list.map((x) => ({ id: key(x), x })), moves).map((w) => w.x);
  return {
    stories: order(pool.stories, (c) => c.key),
    numbers: order(pool.numbers, (n) => n.key),
    unbriefed: order(pool.unbriefed, (c) => `story:${c.key}`),
    leads: order(pool.leads, (l) => storyKey(l.url)),
  };
}

/**
 * The series' pool in the pool standard's order (2026-10-21): its pins in the order pinned, archived ideas gone, a dragged idea
 * at its key among the scores, the rest as the pool ranks them. A failed read of the moves leaves the pool as it was.
 */
export async function inQueueOrder(db: SetBuilderDeps['db'], series: string, pool: OpenPool): Promise<OpenPool> {
  if (!pool.meta) return pool;
  const prefix = `stories:pool:${series}:`;
  type Row = { idea_id: string; kind: IdeaAdjustment['kind']; sort_key: number | string | null; skip_reason: string | null; created_at: string };
  let rows: Row[];
  try {
    rows = (await db.query<Row>(
      `SELECT idea_id, kind, sort_key, skip_reason, created_at::text AS created_at FROM social_hub.idea_adjustments
        WHERE vertical = 'stories' AND idea_id LIKE $1 AND consumed_at IS NULL ORDER BY created_at, id`,
      [`${prefix}%`],
    )).rows;
  } catch {
    return pool;
  }
  if (!rows.length) return pool;
  const night = tonightMoves(
    rows.map((r) => ({ id: r.idea_id, vertical: 'stories' as const, ideaId: r.idea_id.slice(prefix.length), nyDate: '', kind: r.kind, createdAt: r.created_at, sortKey: r.sort_key == null ? null : Number(r.sort_key), skipReason: r.skip_reason })),
    'stories',
  );
  const ids = { pins: night.pins.map((p) => p.ideaId), placed: night.placed, archived: night.archived };
  const reorder = <T,>(list: T[], meta: Array<{ key: string; score: number | null }>) =>
    orderForNight(list.map((x, i) => ({ x, ...meta[i]! })), (e) => e.key, (e) => e.score, ids).map((e) => e.x);
  return {
    ...pool,
    stories: reorder(pool.stories, pool.meta.stories),
    numbers: reorder(pool.numbers, pool.meta.numbers),
    unbriefed: reorder(pool.unbriefed, pool.meta.unbriefed),
    leads: reorder(pool.leads, pool.meta.leads),
  };
}
