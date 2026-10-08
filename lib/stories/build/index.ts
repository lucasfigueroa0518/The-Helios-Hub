/**
 * Build one requested set end to end (plan §4): watch check (plan §9) →
 * series builder (M3, M6, M7) → save → render stage (M2). The worker calls
 * this for each set it claims. A click on Generate (or an auto series) is the
 * approval boundary for these live calls (rule 0.1).
 */
import type { JevTransport } from '@/lib/reels/jev/runner';
import type { StoriesDb } from '@/lib/stories/db';
import { createStoriesJev } from '@/lib/stories/jev';
import type { PhotoFinder } from '@/lib/stories/photos';
import type { Renderer } from '@/lib/stories/render/render';
import type { ReviewCall } from '@/lib/stories/render/review';
import { runRenderStage } from '@/lib/stories/render-stage';
import { failSet, getSet, markSkipped, monthSpendUsd, recordCost, saveBuild } from '@/lib/stories/repository';
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
  const photoUsdBefore = deps.photos.usd;
  try {
    const jev = createStoriesJev(deps.jevTransport, deps.db);
    const bd: BuildDeps = { db: deps.db, sourceDb: deps.sourceDb, jev, write: deps.write, photos: deps.photos, settings, now, setId, nyDate: got.set.ny_date };
    const builder = deps.builders?.[got.set.series] ?? { morning_download: buildMorningDownload, guess_the_number: buildGuessTheNumber, free_vs_paid: buildFreeVsPaid }[got.set.series];
    const result = await builder(bd);
    if (!result.ok) {
      await deps.db.query(`UPDATE stories.sets SET payload = payload || $2::jsonb WHERE id = $1`, [setId, JSON.stringify({ candidates: result.candidates.length })]);
      await markSkipped(deps.db, setId, result.skip);
      return { status: 'skipped', detail: result.skip };
    }
    await saveBuild(deps.db, setId, { payload: { ...result.payload, historyKeys: result.historyKeys }, frames: result.frames, candidates: result.candidates });
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
