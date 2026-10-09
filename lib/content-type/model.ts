import type { HubDataset } from '@/lib/social-hub/dataset';
import { nyDateOf } from '@/lib/social-hub/time';
import { windowsOn } from '@/lib/social-hub/views/plan';
import type { HubIdea, HubPost, Vertical } from '@/lib/social-hub/types';
import { offerer, type Offer } from '@/lib/social-hub/views/offer';
import { poolList, poolSummary } from '@/lib/social-hub/views/pools';
import { thumbOf } from '@/components/social-hub/ui/Thumb';

/**
 * A content type's page model (the Text on Screen format): the days that
 * have posts, each day's posts with what a person can do to them, and the
 * bench (the idea pool, ranked). Pure over the hub dataset, so the live page
 * and the fixture preview draw the same thing.
 */

export type TypeCard = { post: HubPost; offer: Offer; thumb: string | null; remote: boolean; count: number | null };

export type TypeDay = { date: string; cards: TypeCard[] };

/** A bench row is an idea; one with made content waiting (a finished video or slides that no day has yet) carries that post. */
export type TypeBenchItem = { idea: HubIdea; rank: number; card: TypeCard | null };

export type TypeHubModel = {
  vertical: Vertical;
  today: string;
  days: TypeDay[];
  bench: TypeBenchItem[];
  benchTotal: number;
  scoreLabel: string | null;
  lastRefill: string | null;
  poolOpen: number;
};

/** How many days back the strip reaches; later days with scheduled posts always show. */
export const DAYS_BACK = 21;

const at = (p: HubPost) => p.publishAt ?? p.postedAt ?? '';

const MADE = new Set(['ready', 'scheduled', 'publishing', 'published']);

/**
 * A day preview holds only what is filling that day's quota: generated
 * content with an idea, or one still being generated. Failed, skipped, and
 * anything past the quota wait on the bench.
 */
function fillsQuota(post: HubPost): boolean {
  if (!post.idea) return false;
  if (post.status === 'generating') return true;
  return Boolean(post.generatedAt) && MADE.has(post.status);
}

export function typeHubModel(dataset: HubDataset, vertical: Vertical, now: Date): TypeHubModel {
  const today = nyDateOf(now)!;
  const o = offerer(dataset, now);
  const earliest = nyDateOf(new Date(now.getTime() - DAYS_BACK * 86_400_000))!;
  const byDay = new Map<string, TypeCard[]>([[today, []]]);
  // Made but not on a day yet: not part of any day. It waits on the bench with its idea.
  const waiting: TypeCard[] = [];
  for (const post of dataset.posts) {
    if (post.vertical !== vertical) continue;
    const t = thumbOf(post.media);
    const card: TypeCard = { post, offer: o.offer(post), thumb: t.src, remote: t.remote, count: t.count };
    if (!fillsQuota(post) || !post.nyDate || post.nyDate < earliest) {
      if (post.nyDate && post.nyDate < earliest) continue;
      waiting.push(card);
      continue;
    }
    byDay.set(post.nyDate, [...(byDay.get(post.nyDate) ?? []), card]);
  }
  for (const [date, cards] of byDay) {
    const slots = windowsOn(vertical, date).length;
    const ranked = [...cards].sort((a, b) => at(a.post).localeCompare(at(b.post)) || a.post.id.localeCompare(b.post.id));
    waiting.push(...ranked.slice(slots));
    byDay.set(date, ranked.slice(0, slots));
  }
  const days = [...byDay.entries()]
    .map(([date, cards]) => ({ date, cards: cards.sort((a, b) => at(a.post).localeCompare(at(b.post)) || a.post.id.localeCompare(b.post.id)) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const summary = poolSummary(dataset.ideas, vertical);
  const open = poolList(dataset.ideas, vertical, 'open');
  // Match each waiting post to its idea (a post names its idea by the bare id; an idea's id may carry a prefix).
  const matched = new Set<string>();
  const forIdea = (idea: HubIdea) => {
    const hit = waiting.find((c) => !matched.has(c.post.id) && c.post.idea && (idea.id === c.post.idea.id || idea.id.endsWith(`:${c.post.idea.id}`)));
    if (hit) matched.add(hit.post.id);
    return hit ?? null;
  };
  const rows: TypeBenchItem[] = open.slice(0, 50).map((idea, i) => ({ idea, rank: i + 1, card: forIdea(idea) }));
  // Content whose idea is no longer open still needs a person: keep it on the bench under its own name.
  for (const card of waiting) {
    if (matched.has(card.post.id)) continue;
    rows.push({
      rank: rows.length + 1,
      card,
      idea: { id: card.post.id, vertical, title: card.post.name, score: null, scoreLabel: '', state: 'content_ready', hasContent: true, versionCount: 1, generatedAt: card.post.generatedAt, createdAt: card.post.generatedAt, detail: null, group: card.post.idea?.label ?? null },
    });
  }
  return {
    vertical,
    today,
    days,
    bench: rows,
    benchTotal: rows.length,
    scoreLabel: summary.scoreLabel ?? null,
    lastRefill: summary.lastRefill ?? null,
    poolOpen: summary.open,
  };
}
