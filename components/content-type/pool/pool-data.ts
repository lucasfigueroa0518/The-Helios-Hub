import type { TypeCard } from '@/lib/content-type/model';
import { MADE_WINDOW_DAYS, type PoolSource } from '@/lib/content-type/pool-view';
import type { HubDataset } from '@/lib/social-hub/dataset';
import { addDays, nyDateOf } from '@/lib/social-hub/time';
import type { Vertical } from '@/lib/social-hub/types';
import { offerer } from '@/lib/social-hub/views/offer';
import { poolSummary } from '@/lib/social-hub/views/pools';
import { thumbOf } from '@/components/social-hub/ui/Thumb';

/**
 * What the pool screen needs from the hub dataset beyond the type page's model (pool UI contract §4–5): the type's
 * own posts (the Made tab and the board), the calendar's slots and quotas, a person's moves, the one `now` every list
 * is drawn at (so the board and Up next agree on server and client), and each post's card (what a person can do to it,
 * for the post panel's action bar). Pure; built on the server and handed to the client screen.
 */
export type PoolPageData = {
  source: { posts: PoolSource['posts']; dayQuotas: PoolSource['dayQuotas']; adjustments: PoolSource['adjustments'] };
  /** Every post in `source.posts`, by id, with its offer and thumbnail. */
  cards: Record<string, TypeCard>;
  nowIso: string;
  /** About what one more post of this type costs (posting.ts costPerPost); null when unknown. */
  costPerPostMicros: number | null;
  /** When the pool last gained an idea (poolSummary, as the Content page's pool panel reads it), for the Settings tab; null when unknown. */
  lastRefill?: string | null;
};

/** How far back the board's ‹ steps (days before today). The Made tab reaches back 30 days by when a post was made. */
export const BOARD_BACK_DAYS = 7;
/** How far ahead the board's › steps: its last column is today + this. */
export const BOARD_AHEAD_DAYS = 14;

export function poolPageData(dataset: HubDataset, vertical: Vertical, now: Date, costPerPostMicros: number | null = null): PoolPageData {
  const today = nyDateOf(now)!;
  const madeFrom = addDays(today, -MADE_WINDOW_DAYS);
  const boardFrom = addDays(today, -BOARD_BACK_DAYS);
  const posts = dataset.posts.filter((p) => {
    if (p.vertical !== vertical) return false;
    const made = nyDateOf(p.generatedAt);
    return (made != null && made >= madeFrom) || (p.nyDate != null && p.nyDate >= boardFrom);
  });
  const o = offerer(dataset, now);
  const cards: Record<string, TypeCard> = {};
  for (const post of posts) {
    const t = thumbOf(post.media);
    cards[post.id] = { post, offer: o.offer(post), thumb: t.src, remote: t.remote, count: t.count };
  }
  return {
    source: { posts, dayQuotas: dataset.dayQuotas ?? null, adjustments: (dataset.adjustments ?? []).filter((a) => a.vertical === vertical) },
    cards,
    nowIso: now.toISOString(),
    costPerPostMicros,
    lastRefill: poolSummary(dataset.ideas, vertical).lastRefill,
  };
}
