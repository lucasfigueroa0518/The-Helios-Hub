import { unstable_cache } from 'next/cache';
import { cache } from 'react';

import type { HubDataset } from '@/lib/social-hub/dataset';
import { loadDataset } from '@/lib/social-hub/load';

/**
 * One read of every pipeline, shared for a minute (REDESIGN plan B1). The
 * hub's data is the same for everyone signed in (SH-14: no roles), so a
 * filter change or a drawer opening doesn't re-read four schemas. Actions
 * revalidate the tag; a read with per-type errors is never cached.
 */

export const HUB_DATA_TAG = 'social-hub:data';

class PartialRead extends Error {
  constructor(readonly dataset: HubDataset) {
    super('partial read');
  }
}

/**
 * Every post already carries its allocated cost (withCosts), and no page
 * reads the ledger itself: its rows and allocations are ~9 MB of the ~9 MB
 * dataset, over the 2 MB Next data cache item limit. Keep only whether a
 * ledger exists (DataNotes shows cost notes only then).
 */
function slim(dataset: HubDataset): HubDataset {
  return dataset.cost ? { ...dataset, cost: { rows: [], allocations: [], unattributed: [] } } : dataset;
}

const shared = unstable_cache(
  async () => {
    const dataset = await loadDataset();
    if (dataset.errors.length > 0) throw new PartialRead(dataset);
    return slim(dataset);
  },
  ['social-hub-dataset', process.env.VERCEL_DEPLOYMENT_ID ?? 'local', 'v2'],
  { revalidate: 60, tags: [HUB_DATA_TAG] },
);

/** Once per request (layout, page and drawer share it). */
export const loadHubDataset = cache(async (): Promise<HubDataset> => {
  try {
    return await shared();
  } catch (error) {
    if (error instanceof PartialRead) return slim(error.dataset);
    throw error;
  }
});
