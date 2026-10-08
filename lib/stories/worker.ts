/**
 * One pass of the Stories worker (plan §4, §7, M8). scripts/stories_worker.ts
 * runs it every 15 seconds; tests run it against PGlite and stubs.
 *
 *   1. auto series: request today's set at 4:00 AM (docs/social-overnight.md)
 *   2. build: claim one `requested` set → build, render, review → `ready`;
 *      an auto set approves itself only when require_approval is off and the
 *      review did not flag it (S-05, S-33); otherwise it waits for Approve
 *   3. schedule: each approved set gets a minute in its window (S-20)
 *   4. publish: each due set posts its frames in order (S-59); on success the
 *      history (repeat checks) and Tommy's used-photo log are written (S-24)
 *      Steps 3 and 4 run only while publishing_live is on.
 *   5. insights: poll published frames every 2 hours until the final capture
 */
import type { StoriesDb } from '@/lib/stories/db';
import { buildSet, type SetBuilderDeps } from '@/lib/stories/build';
import { isFinalCapture, type StoryInsightsClient } from '@/lib/stories/publish/insights';
import type { StoriesMetaClient } from '@/lib/stories/publish/meta';
import { publishSet } from '@/lib/stories/publish/publish';
import type { Series } from '@/lib/stories/render/types';
import {
  approveSet,
  claimNextRequested,
  dueSets,
  failSet,
  framesDueForInsights,
  getSet,
  listSets,
  markPublished,
  markPublishing,
  recordFrameContainer,
  recordFramePublished,
  recordHistory,
  recordInsights,
  scheduleSet,
} from '@/lib/stories/repository';
import { pickPublishAt, requestAutoSets } from '@/lib/stories/schedule';
import { loadSettings } from '@/lib/stories/settings';
import { recordPublishedPhoto } from '@/lib/stories/sources/carousel';
import type { StoriesStorage } from '@/lib/stories/storage';

/** Auto sets are requested in the Stories hour of the night clock (docs/social-overnight.md). */
export const AUTO_REQUEST_AFTER = '04:00';

export type WorkerDeps = {
  db: StoriesDb;
  /** reels.* and social.* (read; plus the used-photo insert at publish). */
  sourceDb: StoriesDb;
  /** Builds need the live model clients; created only when a set is claimed. */
  builder: () => Promise<SetBuilderDeps>;
  meta: () => StoriesMetaClient;
  insights: () => StoryInsightsClient;
  storage: () => StoriesStorage;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
};

const nyClock = (at: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);

export async function tick(deps: WorkerDeps): Promise<{ built: number; scheduled: number; published: number; insights: number }> {
  const now = deps.now?.() ?? new Date();
  const log = deps.log ?? (() => {});
  const settings = await loadSettings(deps.db);
  const out = { built: 0, scheduled: 0, published: 0, insights: 0 };

  // 1. Auto series.
  if (nyClock(now) >= AUTO_REQUEST_AFTER) {
    const requested = await requestAutoSets(deps.db, settings, now);
    if (requested.length) log(`auto: requested ${requested.join(', ')}`);
  }

  // 2. Build one requested set.
  const claimed = await claimNextRequested(deps.db);
  if (claimed) {
    const b = await deps.builder();
    const r = await buildSet(b, claimed.id);
    out.built++;
    log(`build ${claimed.series} ${claimed.ny_date}: ${r.status}${r.flagged ? ' (flagged)' : ''} ${r.detail.slice(0, 200)}`);
    if (r.status === 'ready' && claimed.trigger === 'auto' && settings.series[claimed.series].auto && !r.flagged && !settings.requireApproval) await approveSet(deps.db, claimed.id);
  }

  // 3–4 post nothing while the master switch is off.
  if (!settings.publishingLive) {
    await pollInsights(deps, now, out);
    return out;
  }

  // 3. Schedule approved sets.
  for (const s of await listSets(deps.db, { statuses: ['approved'] })) {
    const at = pickPublishAt(settings.series[s.series].window, s.ny_date, now);
    if (!at) continue; // window passed: the Hub offers Publish now or reject
    await scheduleSet(deps.db, s.id, at);
    out.scheduled++;
    log(`scheduled ${s.series} ${s.ny_date} for ${at.toISOString()}`);
  }

  // 4. Publish due sets.
  for (const s of await dueSets(deps.db, now)) {
    await publishOne(deps, s.id, s.series);
    out.published++;
  }

  // 5. Insights.
  await pollInsights(deps, now, out);
  return out;
}

async function pollInsights(deps: WorkerDeps, now: Date, out: { insights: number }): Promise<void> {
  const log = deps.log ?? (() => {});
  const due = await framesDueForInsights(deps.db, { now });
  if (!due.length) return;
  const client = deps.insights();
  for (const f of due) {
    try {
      const r = await client.storyInsights(f.ig_media_id);
      await recordInsights(deps.db, f.id, r.metrics, r.raw, isFinalCapture(new Date(f.published_at), now), now);
      out.insights++;
    } catch (err) {
      log(`insights ${f.ig_media_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function publishOne(deps: WorkerDeps, setId: string, series: Series): Promise<void> {
  const log = deps.log ?? (() => {});
  await markPublishing(deps.db, setId);
  const got = (await getSet(deps.db, setId))!;
  const missing = got.frames.filter((f) => !f.storage_path);
  if (missing.length) {
    await failSet(deps.db, setId, `frames without a rendered JPEG: ${missing.map((f) => f.seq).join(', ')}`);
    return;
  }
  const result = await publishSet(
    got.frames.map((f) => ({ id: f.id, seq: f.seq, storagePath: f.storage_path! })),
    {
      meta: deps.meta(),
      storage: deps.storage(),
      sleep: deps.sleep,
      now: deps.now,
      onContainer: (frameId, containerId) => recordFrameContainer(deps.db, frameId, containerId),
      onPublished: (frameId, mediaId, at) => recordFramePublished(deps.db, frameId, mediaId, at),
    },
  );
  if (!result.ok) {
    const went = result.published.length;
    await failSet(deps.db, setId, `${result.stage}: ${result.error}${went ? ` (${went} frame(s) already live)` : ' (nothing went live)'}`);
    log(`publish ${series}: failed at ${result.stage}: ${result.error}`);
    return;
  }
  await markPublished(deps.db, setId);
  const keys = (got.set.payload.historyKeys as string[] | undefined) ?? [];
  await recordHistory(deps.db, series, keys, setId);
  const at = deps.now?.() ?? new Date();
  for (const f of got.frames) {
    if (!f.photo?.src || f.photo.kind === 'logo') continue;
    await recordPublishedPhoto(deps.sourceDb, { url: f.photo.src, usedAt: at, storyId: `stories:${setId}`, slide: f.seq, credit: f.photo.credit, scene: f.role }).catch((err) => log(`used_photos: ${err instanceof Error ? err.message : String(err)}`));
  }
  log(`published ${series} ${got.set.ny_date}: ${result.mediaIds.length} frames`);
}
