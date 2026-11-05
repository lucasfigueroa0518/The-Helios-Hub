import { unstable_cache } from 'next/cache';
import { gunzipSync, gzipSync } from 'node:zlib';
import { cache } from 'react';

import type { CostLedger } from '@/lib/social-hub/cost';
import type { CostPart, HubDataset, VerticalReads } from '@/lib/social-hub/dataset';
import { liveHubQuery } from '@/lib/social-hub/db';
import { loadCostPart, loadDataset, readOne, withSharedSpine } from '@/lib/social-hub/load';
import type { Vertical } from '@/lib/social-hub/types';
import { VERTICAL_IDS } from '@/lib/social-hub/verticals';

import { HUB_COST_TAG, HUB_DATA_TAG, hubDataTag } from '@/lib/social-hub/views/cache-tags';
import { logHubDatasetRebuild, logHubDatasetServe } from '@/lib/observability/hub-dataset-telemetry';
import { finishDatasetLoad } from '@/lib/social-hub/views/stale-dataset';

export { HUB_COST_TAG, HUB_DATA_TAG, hubDataTag };

/**
 * One read of every pipeline, shared for a minute (REDESIGN plan B1). The
 * hub's data is the same for everyone signed in (SH-14: no roles), so a
 * filter change or a drawer opening doesn't re-read four schemas. Actions
 * revalidate the tag; a read with per-type errors is never cached.
 */

/**
 * Cost is cached apart from the content, for ten minutes. Reading and
 * allocating the ledger was the slowest half of every content rebuild
 * (~0.7 s, ~6 MB read, ~17 MB built and then dropped), and nothing an action
 * does changes what a post cost. A run finishing marks both tags stale
 * (POST /api/content-type/progress).
 */

const NO_ROWS: CostLedger = { rows: [], allocations: [], unattributed: [] };

class UncachedCosts extends Error {
  constructor(readonly part: CostPart) {
    super('cost read failed');
  }
}

const sharedCosts = unstable_cache(
  async (): Promise<CostPart> => {
    const part = await loadCostPart();
    // A failed read is never cached: the next request tries again.
    if (!part.ledger) throw new UncachedCosts(part);
    // Posts need only the per-item totals; keep whether a ledger exists (DataNotes).
    return { ...part, ledger: NO_ROWS };
  },
  ['social-hub-costs', process.env.VERCEL_DEPLOYMENT_ID ?? 'local', 'v1'],
  { revalidate: 600, tags: [HUB_COST_TAG] },
);

async function cachedCostPart(): Promise<CostPart> {
  try {
    return await sharedCosts();
  } catch (error) {
    if (error instanceof UncachedCosts) return error.part;
    throw error;
  }
}

class PartialRead extends Error {
  constructor(readonly dataset: HubDataset) {
    super('partial read');
  }
}

/**
 * Every post already carries its allocated cost (withItemCosts), and no page
 * reads the ledger itself, so keep only whether one exists (DataNotes shows
 * cost notes only then). The cached cost part already has no rows; a failed
 * cost read falls back to the full one, which this drops.
 */
function slim(dataset: HubDataset): HubDataset {
  return dataset.cost ? { ...dataset, cost: NO_ROWS } : dataset;
}

/**
 * Even slimmed, the dataset is ~3 MB, and the data cache silently refuses any
 * entry over 2 MB, so it was never stored and every request re-read every
 * schema. Stored gzipped it is ~230 KB (packing and unpacking take ~20 ms).
 */
function pack(value: unknown): string {
  return gzipSync(JSON.stringify(value)).toString('base64');
}

function unpack<T>(packed: string): T {
  return JSON.parse(gunzipSync(Buffer.from(packed, 'base64')).toString('utf8')) as T;
}

const deployment = process.env.VERCEL_DEPLOYMENT_ID ?? 'local';

/** One type's read. Tagged with the global tag too, so a full clear drops every slice. */
function verticalCache(vertical: Vertical) {
  return unstable_cache(
    async () => pack(await readOne(liveHubQuery, vertical)),
    ['social-hub-vertical', vertical, deployment, 'v1'],
    { revalidate: 60, tags: [HUB_DATA_TAG, hubDataTag(vertical)] },
  );
}

const verticalCaches = Object.fromEntries(VERTICAL_IDS.map((vertical) => [vertical, verticalCache(vertical)])) as Record<Vertical, () => Promise<string>>;

/** Cache hits stay packed. A miss throws, so a failed read is never stored. */
async function cachedReads(): Promise<VerticalReads> {
  const entries = await Promise.all(VERTICAL_IDS.map(async (vertical) => {
    try {
      return [vertical, unpack(await verticalCaches[vertical]())] as const;
    } catch (error) {
      return [vertical, error instanceof Error ? error : new Error(String(error))] as const;
    }
  }));
  return Object.fromEntries(entries) as VerticalReads;
}

const shared = unstable_cache(
  async () => {
    logHubDatasetRebuild();
    // The spine is read once for whichever types miss. Types still in cache are not read again.
    const dataset = await withSharedSpine(liveHubQuery, async () => loadDataset(liveHubQuery, new Date(), cachedCostPart(), await cachedReads()));
    if (dataset.errors.length > 0) throw new PartialRead(dataset);
    return pack(slim(dataset));
  },
  ['social-hub-dataset', deployment, 'v5-parts'],
  { revalidate: 60, tags: [HUB_DATA_TAG, ...VERTICAL_IDS.map(hubDataTag)] },
);

/** Once per request (layout, page and drawer share it). */
export const loadHubDataset = cache(async (): Promise<HubDataset> => {
  const started = performance.now();
  try {
    const dataset = finishDatasetLoad(unpack<HubDataset>(await shared()));
    logHubDatasetServe(dataset, { durationMs: Math.round(performance.now() - started), source: 'shared_cache' });
    return dataset;
  } catch (error) {
    if (error instanceof PartialRead) {
      const dataset = finishDatasetLoad(slim(error.dataset));
      logHubDatasetServe(dataset, { durationMs: Math.round(performance.now() - started), source: 'partial_read' });
      return dataset;
    }
    throw error;
  }
});
