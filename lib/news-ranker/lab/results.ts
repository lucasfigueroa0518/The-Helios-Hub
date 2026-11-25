/**
 * The lab's read model: set, tags, spend, per-variant metrics, the mix sweep
 * and top-10 lists. Pure reads of the local store.
 */
import { LAB_CAP_USD } from './cost';
import { latestRun, getSet, latestSet, listSets, listRuns, listTags, scoresOf, spentUsd, type LabDb, type RunRow, type SetStory } from './db';
import { metricsFor, mixSweep, ownOrder, type ScoreRow } from './metrics';
import { VARIANTS, VARIANT_IDS, type LabVariantId } from './variants';
import type { LabTag, VariantMetrics } from '@/lib/news-ranker/types';

export type TopItem = { storyId: string; headline: string; cool: number | null; needToKnow: number | null; mixed: number; finalPosition: number | null; points: Record<string, number>; gate: string; tag: { cool: number; needToKnow: number } | null };

export type VariantResult = { variantId: LabVariantId; label: string; run: RunRow | null; metrics: VariantMetrics | null; sweep: VariantMetrics[]; top10: TopItem[] };

export type LabState = {
  set: { id: string; windowFrom: string; windowTo: string; stories: SetStory[] } | null;
  tags: LabTag[];
  spentUsd: number;
  capUsd: number;
  runs: RunRow[];
  variants: VariantResult[];
  /** Reading aids by story id (digests.ts); added by the GET route. */
  digests?: Record<string, { headline: string; point: string }>;
  sets?: { id: string; createdAt: string; n: number }[];
};

export async function labState(db: LabDb, setId?: string | null): Promise<LabState> {
  const set = (setId ? await getSet(db, setId) : null) ?? (await latestSet(db));
  const sets = await listSets(db);
  const tags = await listTags(db);
  const variants: VariantResult[] = [];
  for (const id of VARIANT_IDS) {
    const v = VARIANTS[id];
    const run = set ? await latestRun(db, set.id, id) : null;
    if (!set || !run) {
      variants.push({ variantId: id, label: v.label, run, metrics: null, sweep: [], top10: [] });
      continue;
    }
    const scores = await scoresOf(db, run.id);
    const rows: ScoreRow[] = scores.map((s) => ({ storyId: s.storyId, cool: s.cool, needToKnow: s.needToKnow, mixed: s.mixed, finalPosition: s.finalPosition, gatePass: s.detail.gatePass !== false }));
    const order = ownOrder(rows);
    const byId = new Map(scores.map((s) => [s.storyId, s]));
    const head = new Map(set.stories.map((s) => [s.storyId, s.headline]));
    variants.push({
      variantId: id,
      label: v.label,
      run,
      metrics: metricsFor(id, v.mix.cool, order, tags),
      sweep: mixSweep(id, rows, tags),
      top10: order.slice(0, 10).map((sid) => {
        const s = byId.get(sid)!;
        const t = tags.get(sid);
        return {
          storyId: sid, headline: head.get(sid) ?? sid, cool: s.cool, needToKnow: s.needToKnow, mixed: s.mixed, finalPosition: s.finalPosition,
          points: (s.detail.points ?? {}) as Record<string, number>, gate: String(s.detail.gateReason ?? ''), tag: t ? { cool: t.cool, needToKnow: t.needToKnow } : null,
        };
      }),
    });
  }
  return {
    sets,
    set: set ? { id: set.id, windowFrom: set.windowFrom.toISOString(), windowTo: set.windowTo.toISOString(), stories: set.stories } : null,
    tags: [...tags.values()],
    spentUsd: await spentUsd(db),
    capUsd: LAB_CAP_USD,
    runs: set ? await listRuns(db, set.id) : [],
    variants,
  };
}
