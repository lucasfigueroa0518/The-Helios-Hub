import { dbQuery } from '@/lib/db';
import { explainersDb } from '@/lib/explainers/connection';
import { openSeedCount as explainersOpenCount } from '@/lib/explainers/repository';
import { readOpenSeeds as readOpenLfdSeeds } from '@/lib/lfd/seeds';
import { readOpenSeeds as readOpenCarouselSeeds } from '@/lib/social/overnight/seeds';
import { liveStoriesDb } from '@/lib/stories/db';
import { openSeedCount as storiesOpenCount } from '@/lib/stories/seed';

import type { SeedVerticalKey } from './types';

const q = (text: string, params?: unknown[]) => dbQuery(text, params as never) as never;

/** Open seeds waiting in a pool, so a click that the add function would refuse is refused before any spend. Read-only. */
export async function openSeedCountFor(vertical: SeedVerticalKey): Promise<number> {
  try {
    switch (vertical) {
      case 'carousels': return (await readOpenCarouselSeeds(q as never)).length;
      case 'last_few_days': return (await readOpenLfdSeeds(q as never, new Date())).length;
      case 'stories': return await storiesOpenCount(liveStoriesDb, 'morning_download');
      case 'explainers': return await explainersOpenCount(await explainersDb());
      default: return 0;
    }
  } catch {
    return 0;
  }
}
