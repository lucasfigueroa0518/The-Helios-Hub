/**
 * Build one requested set end to end (plan §4): watch check (plan §9) →
 * the series' open ideas from stories.pool (refreshed first if the pool has
 * no refresh for the day; each series from the intake or today's sources per
 * the consumer switch, the intake topped up first when it is stale) → series builder (M3, M6, M7) → save → render
 * stage (M2) → the ideas it used are marked used in the pool. The worker calls
 * this for each set it claims. A click on Generate (or an auto series) is the
 * approval boundary for these live calls (rule 0.1).
 */
import type { JevTransport } from '@/lib/reels/jev/runner';
import type { StoriesDb } from '@/lib/stories/db';
import type { Series } from '@/lib/stories/render/types';
import { createStoriesJev } from '@/lib/stories/jev';
import type { PhotoFinder } from '@/lib/stories/photos';
import type { Renderer } from '@/lib/stories/render/render';
import type { ReviewCall } from '@/lib/stories/render/review';
import { createIntakeJev } from '@/lib/intake/jev';
import { ensureIntakeFresh } from '@/lib/intake/run';
import { INTAKE_TOPUP_CAP_USD, type IntakeJev } from '@/lib/intake/types';
import { markPoolUsed, openPool, refreshPoolIfDue, type OpenPool, type PoolModes } from '@/lib/stories/pool';
import { anyIntake, storiesPoolReads, type ReadConsumerMode } from '@/lib/stories/pool-intake';
import { tonightMoves, type IdeaAdjustment } from '@/lib/social-hub/views/moves';
import { orderForNight } from '@/lib/social-hub/queue';
import { finishNightPlacements } from '@/lib/social-hub/queue-store';
import { storyKey } from '@/lib/stories/sources/reels';
import { runRenderStage, type RenderClips } from '@/lib/stories/render-stage';
import { failSet, getSet, markSkipped, monthSpendUsd, recordCost, saveBuild } from '@/lib/stories/repository';
import { loadSettings, seriesTypeSettings } from '@/lib/stories/settings';
import { verticalOfSeries } from '@/lib/social-hub/story-types';
import type { StoriesStorage } from '@/lib/stories/storage';
import type { WriterCreate } from '@/lib/stories/writer';

import { capSpendUsd, type BuildDeps, type BuildResult } from './common';
import { buildAiTrivia } from './ai-trivia';
import { buildMorningDownload } from './morning-download';
import { buildRealOrAi } from './real-or-ai';

export type SetBuilderDeps = {
  db: StoriesDb;
  sourceDb: StoriesDb;
  jevTransport: JevTransport;
  write: WriterCreate;
  /** AI Trivia's opponent (AT-74/75): GPT-5 nano on OpenAI, Llama 3.1 8B on fal. Absent: no opponent. */
  opponent?: import('@/lib/stories/trivia/opponent').OpponentClient;
  /** The old Stories photo finder: only the retired Free vs. Paid builder used it. Absent (the worker): no finder photos. */
  photos?: PhotoFinder;
  renderer: Renderer;
  /** AI Trivia's video renderer (lib/stories/trivia/render); tests stub it. Default: renderTriviaClips. */
  triviaRender?: RenderClips;
  review: ReviewCall;
  storage: StoriesStorage;
  now?: () => Date;
  log?: (line: string) => void;
  /** The central intake (consumer switch): the posted check's Jev, the freshness top-up, the mode read. Tests stub them. */
  intake?: {
    jev?: () => IntakeJev;
    /** ensureIntakeFresh (never throws): run before the pool is read when any series is on the intake. */
    ensureFresh?: () => Promise<unknown>;
    readMode?: ReadConsumerMode;
  };
  /** Tests swap a series builder for a stub. */
  builders?: Partial<Record<Series, (d: BuildDeps) => Promise<BuildResult>>>;
  /** Morning Download's video finder for one set (MD-LFD D16–D19, lib/stories/video.ts). Absent: photos only. */
  video?: (setId: string) => Promise<import('@/lib/stories/video').StoryVideoDeps | null>;
  /** Morning Download's news chain clients (shortlist, rerank, photos, writer). Absent: Morning Download skips. */
  news?: import('./common').NewsChainDeps;
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
  // The daily cap is the set's type's (SS-1); it counts against the day the set posts for a type made ahead
  // (Bald-Eagle D4), the run day otherwise.
  const cap = seriesTypeSettings(settings, got.set.series).dailyCapUsd;
  const today = await capSpendUsd(deps.db, got.set.series, got.set.ny_date, now);
  if (today >= cap) {
    await markSkipped(deps.db, setId, `daily cap reached ($${today.toFixed(2)} of $${cap})`);
    return { status: 'skipped', detail: 'daily cap reached' };
  }
  const photoUsdBefore = deps.photos?.usd ?? 0;
  try {
    const series = got.set.series;
    const poolReadAt = new Date();
    const { pool, modes } = await seriesPool(deps, series, now);
    const jev = createStoriesJev(deps.jevTransport, deps.db);
    const order = ORDER_OF[series];
    const onIntake = order ? modes?.[order] === 'intake' : false;
    const video = series === 'morning_download' && deps.video ? await deps.video(setId).catch((err) => (deps.log?.(`video: off for this set: ${err instanceof Error ? err.message : String(err)}`), null)) : null;
    const bd: BuildDeps = { db: deps.db, sourceDb: deps.sourceDb, jev, write: deps.write, ...(deps.opponent ? { opponent: deps.opponent } : {}), ...(deps.photos ? { photos: deps.photos } : {}), settings, now, setId, nyDate: got.set.ny_date, pool, ...(onIntake ? { intake: true } : {}), ...(video ? { video } : {}), ...(series === 'morning_download' && deps.news ? { news: deps.news } : {}) };
    const builder = deps.builders?.[series] ?? BUILDERS[series];
    if (!builder) {
      await markSkipped(deps.db, setId, `${series} is retired: no new sets are built`);
      return { status: 'skipped', detail: `${series} is retired` };
    }
    const result = await builder(bd).finally(async () => {
      // The video finder's spend (Haiku, Jev, Serper) counts whether or not the build posts.
      const spent = video?.spent();
      const lines = spent ? ([['anthropic', spent.anthropic], ['jev', spent.jev], ['web_search', spent.search]] as const) : [];
      for (const [vendor, usd] of lines) if (usd > 0) await recordCost(deps.db, { setId, vendor, component: 'md-video-finder', usd }).catch(() => {});
    });
    if (!result.ok) {
      await deps.db.query(`UPDATE stories.sets SET payload = payload || $2::jsonb WHERE id = $1`, [setId, JSON.stringify({ candidates: result.candidates.length })]);
      await markSkipped(deps.db, setId, result.skip);
      return { status: 'skipped', detail: result.skip };
    }
    await saveBuild(deps.db, setId, { payload: { ...result.payload, historyKeys: result.historyKeys }, frames: result.frames, candidates: result.candidates });
    if (pool) {
      const used = result.historyKeys;
      await markPoolUsed(deps.db, series, used, now).catch((err) => deps.log?.(`pool: could not mark used: ${err instanceof Error ? err.message : String(err)}`));
      // The series' set is built from the pool: hand placements for this series (under its type, SS-1) are used up and its ideas compete by score again.
      await finishNightPlacements((text, params) => deps.db.query(text, params as never) as never, verticalOfSeries(series), `stories:pool:${series}:`, poolReadAt);
    }
    const photoUsd = (deps.photos?.usd ?? 0) - photoUsdBefore;
    if (photoUsd > 0) await recordCost(deps.db, { setId, vendor: 'jev', component: 'photo-finder', usd: photoUsd });
    const r = await runRenderStage({ db: deps.db, storage: deps.storage, renderer: deps.renderer, review: deps.review, setId, ...(deps.triviaRender ? { triviaRender: deps.triviaRender } : {}) });
    return { status: 'ready', detail: r.log.join('; '), flagged: r.flagged };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failSet(deps.db, setId, message).catch(() => {});
    return { status: 'failed', detail: message };
  }
}

/**
 * The intake order each series reads into its pool, when it reads one. AI Trivia's pool is its own writer's;
 * Free vs. Paid is retired (SS-1).
 */
const ORDER_OF: Partial<Record<Series, keyof PoolModes>> = { morning_download: 'md' };

/**
 * The live builders. Guess the Number (AT-14) and Free vs. Paid (replaced by Real or AI?) are retired: they have
 * none, so a set still requested for them is skipped.
 */
const BUILDERS: Partial<Record<Series, (d: BuildDeps) => Promise<BuildResult>>> = { morning_download: buildMorningDownload, ai_trivia: buildAiTrivia, real_or_ai: buildRealOrAi };

/**
 * The pool's reads for a build or the worker's refresh: each series from the intake or today's sources (consumer
 * switch). The posted check's Jev is the intake's own (its cost bucket), made only when a qualified story needs it.
 */
export function buildPoolReads(deps: Pick<SetBuilderDeps, 'sourceDb' | 'jevTransport' | 'intake'>, now: Date) {
  const jev = deps.intake?.jev ?? (() => createIntakeJev(deps.jevTransport, deps.sourceDb, null, INTAKE_TOPUP_CAP_USD));
  return storiesPoolReads(deps.sourceDb, now, { readMode: deps.intake?.readMode, intake: { jev } });
}

/**
 * The series' open ideas. The pool refreshes first when it has no refresh for
 * the day (a Generate before the 3:00 AM pass), or when an intake or carousel
 * run started since it last read. Before that, a series on the intake gets
 * ensureIntakeFresh (a top-up when the last run is over 180 minutes old). Null
 * pool when stories.pool cannot be read (schema not applied yet): the build
 * reads its sources directly.
 */
async function seriesPool(deps: SetBuilderDeps, series: Series, now: Date): Promise<{ pool: OpenPool | null; modes: PoolModes | null }> {
  let modes: PoolModes | null = null;
  try {
    const reads = buildPoolReads(deps, now);
    modes = await reads.modes();
    if (anyIntake(modes)) {
      const fresh = await (deps.intake?.ensureFresh ?? (() => ensureIntakeFresh(deps.sourceDb)))().catch((err: unknown) => ({ ran: false, reason: err instanceof Error ? err.message : String(err) }));
      deps.log?.(`intake: ${JSON.stringify(fresh)}`);
    }
    const r = await refreshPoolIfDue(deps.db, () => reads, now);
    if (r) deps.log?.(`pool: refreshed before build (${r.upserted} in, ${r.dropped} dropped${r.errors.length ? `; ${r.errors.join('; ')}` : ''}${r.intake ? `; sources ${JSON.stringify(r.intake)}` : ''})`);
    return { pool: await inQueueOrder(deps.db, series, await openPool(deps.db, series)), modes };
  } catch (err) {
    deps.log?.(`pool: unavailable, reading sources directly: ${err instanceof Error ? err.message : String(err)}`);
    return { pool: null, modes };
  }
}

/**
 * The series' pool in the pool standard's order (2026-10-21): its pins in the order pinned, archived ideas gone, a dragged idea
 * at its key among the scores, the rest as the pool ranks them. A failed read of the moves leaves the pool as it was.
 */
export async function inQueueOrder(db: SetBuilderDeps['db'], series: string, pool: OpenPool): Promise<OpenPool> {
  if (!pool.meta) return pool;
  const prefix = `stories:pool:${series}:`;
  const vertical = verticalOfSeries(series);
  type Row = { idea_id: string; kind: IdeaAdjustment['kind']; sort_key: number | string | null; skip_reason: string | null; created_at: string };
  let rows: Row[];
  try {
    rows = (await db.query<Row>(
      `SELECT idea_id, kind, sort_key, skip_reason, created_at::text AS created_at FROM social_hub.idea_adjustments
        WHERE vertical = $2 AND idea_id LIKE $1 AND consumed_at IS NULL ORDER BY created_at, id`,
      [`${prefix}%`, vertical],
    )).rows;
  } catch {
    return pool;
  }
  if (!rows.length) return pool;
  const night = tonightMoves(
    rows.map((r) => ({ id: r.idea_id, vertical, ideaId: r.idea_id.slice(prefix.length), nyDate: '', kind: r.kind, createdAt: r.created_at, sortKey: r.sort_key == null ? null : Number(r.sort_key), skipReason: r.skip_reason })),
    vertical,
  );
  const ids = { pins: night.pins.map((p) => p.ideaId), placed: night.placed, archived: night.archived, demoted: night.demoted };
  const reorder = <T,>(list: T[], meta: Array<{ key: string; score: number | null }>) =>
    orderForNight(list.map((x, i) => ({ x, ...meta[i]! })), (e) => e.key, (e) => e.score, ids).map((e) => e.x);
  return {
    ...pool,
    stories: reorder(pool.stories, pool.meta.stories),
    leads: reorder(pool.leads, pool.meta.leads),
  };
}
