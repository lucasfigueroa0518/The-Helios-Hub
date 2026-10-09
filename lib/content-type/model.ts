import type { HubDataset } from '@/lib/social-hub/dataset';
import { nyDateOf } from '@/lib/social-hub/time';
import { windowsOn } from '@/lib/social-hub/views/plan';
import type { HubIdea, HubPost, Vertical } from '@/lib/social-hub/types';
import { offerer, type Offer } from '@/lib/social-hub/views/offer';
import { poolSummary } from '@/lib/social-hub/views/pools';
import { dayRanking, quotaCandidates } from '@/lib/social-hub/views/day-rank';
import { thumbOf } from '@/components/social-hub/ui/Thumb';

/**
 * A content type's page model (the Text on Screen format): the days that
 * have posts, each day's posts with what a person can do to them, and the
 * bench (the idea pool, ranked). Pure over the hub dataset, so the live page
 * and the fixture preview draw the same thing.
 */

export type TypeCard = { post: HubPost; offer: Offer; thumb: string | null; remote: boolean; count: number | null };

export type TypeDay = { date: string; cards: TypeCard[] };

/**
 * A bench row is an idea; one with made content waiting (a finished video,
 * rendered slides, or story frames that no day has yet) carries that post,
 * and `made` names what it has. A skipped, failed, or empty post never does.
 */
export type TypeBenchItem = {
  idea: HubIdea;
  /** Its place in today's ranking (Promote / Demote applied; Stories: within its series). */
  rank: number;
  card: TypeCard | null;
  made?: MadeKind | null;
  /** Today's last move on it, if any. */
  moved?: 'promoted' | 'demoted' | null;
  /** One of today's quota candidates: the day is filled with it. */
  inQuota?: boolean;
};

/** What a post actually has to show: rendered slides, rendered story frames, or a video file. */
export type MadeKind = 'slides' | 'frames' | 'video';

export function madeKind(post: HubPost): MadeKind | null {
  const m = post.media;
  if (m.kind === 'video') return m.src ? 'video' : null;
  if (m.kind === 'slides') return m.slides.some((s) => s.src) ? 'slides' : null;
  if (m.kind === 'frames') return m.frames.some((f) => f.src) ? 'frames' : null;
  return null;
}

/** The chip a bench row with made content carries: named for what the post has. */
export const MADE_LABEL: Record<MadeKind, string> = { slides: 'Slides ready', frames: 'Stories ready', video: 'Video ready' };

/** Stories series, in the order the bench and its filter list them. */
export const STORY_SERIES = ['Morning Download', 'Guess the Number', 'Free vs. Paid'] as const;

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
  if (!post.generatedAt || !MADE.has(post.status)) return false;
  // Nothing rendered (no frames, no slides, no video file) is not generated content. A posted one already went out.
  return post.status === 'published' || madeKind(post) != null;
}

/** Content a person still has to look at: made, and holding what it claims to hold. */
const benchable = (card: TypeCard) => MADE.has(card.post.status) && madeKind(card.post) != null;

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
  // Today holds only its quota candidates (lib/social-hub/views/day-rank.ts): the slots, then the top of today's ranking.
  const candidates = quotaCandidates(dataset, vertical, now);
  const todayIds = new Set(candidates.flatMap((c) => (c.post ? [c.post.id] : [])));
  const todays = [...(byDay.get(today) ?? []), ...waiting.filter((c) => todayIds.has(c.post.id))];
  waiting.splice(0, waiting.length, ...waiting.filter((c) => !todayIds.has(c.post.id)), ...todays.filter((c) => !todayIds.has(c.post.id)));
  byDay.set(today, todays.filter((c) => todayIds.has(c.post.id)));
  for (const [date, cards] of byDay) {
    if (date === today) continue;
    const slots = windowsOn(vertical, date).length;
    const ranked = [...cards].sort((a, b) => at(a.post).localeCompare(at(b.post)) || a.post.id.localeCompare(b.post.id));
    waiting.push(...ranked.slice(slots));
    byDay.set(date, ranked.slice(0, slots));
  }
  const days = [...byDay.entries()]
    .map(([date, cards]) => ({ date, cards: cards.sort((a, b) => at(a.post).localeCompare(at(b.post)) || a.post.id.localeCompare(b.post.id)) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const summary = poolSummary(dataset.ideas, vertical);
  const ranking = dayRanking(dataset.ideas, vertical, dataset.adjustments ?? [], today);
  const open = ranking.map((r) => r.idea);
  const movedOf = new Map(ranking.map((r) => [r.idea.id, r.moved]));
  const quotaIdeas = new Set(candidates.flatMap((c) => (c.idea ? [c.idea.id] : [])));
  // Skipped, failed, still generating, or empty: not content waiting on a person. It gets no row and no chip.
  const ready = waiting.filter(benchable);
  // Match each waiting post to its idea (a post names its idea by the bare id; an idea's id may carry a prefix).
  const matched = new Set<string>();
  const forIdea = (idea: HubIdea) => {
    const hit = ready.find((c) => !matched.has(c.post.id) && c.post.idea && (idea.id === c.post.idea.id || idea.id.endsWith(`:${c.post.idea.id}`)));
    if (hit) matched.add(hit.post.id);
    return hit ?? null;
  };
  const row = (idea: HubIdea, rank: number, card: TypeCard | null): TypeBenchItem => ({
    idea, rank, card, made: card ? madeKind(card.post) : null, moved: movedOf.get(idea.id) ?? null, inQuota: quotaIdeas.has(idea.id),
  });
  const rows: TypeBenchItem[] = vertical === 'stories' ? bySeries(open).map(({ idea, rank }) => row(idea, rank, forIdea(idea))) : open.slice(0, 50).map((idea, i) => row(idea, i + 1, forIdea(idea)));
  // Content whose idea is no longer open still needs a person: keep it on the bench under its own name.
  for (const card of ready) {
    if (matched.has(card.post.id)) continue;
    const group = card.post.idea?.label ?? null;
    const rank = vertical === 'stories' ? rows.filter((r) => r.idea.group === group).length + 1 : rows.length + 1;
    rows.push(row({ id: card.post.id, vertical, title: card.post.name, score: null, scoreLabel: '', state: 'content_ready', hasContent: true, versionCount: 1, generatedAt: card.post.generatedAt, createdAt: card.post.generatedAt, detail: null, group }, rank, card));
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

/** Per series, at most this many open ideas reach the bench. */
const PER_SERIES = 50;

/**
 * Stories: one list, ranked within each series. A series' scores mean
 * nothing against another's, so the list takes each series' next best in
 * turn (series order fixed) and each row's rank is its rank in its series.
 */
function bySeries(open: readonly HubIdea[]): Array<{ idea: HubIdea; rank: number }> {
  const groups = new Map<string, HubIdea[]>();
  for (const idea of open) {
    const g = idea.group ?? 'Other';
    groups.set(g, [...(groups.get(g) ?? []), idea]);
  }
  const order = [...STORY_SERIES.filter((g) => groups.has(g)), ...[...groups.keys()].filter((g) => !(STORY_SERIES as readonly string[]).includes(g))];
  const lists = order.map((g) => groups.get(g)!.slice(0, PER_SERIES));
  const out: Array<{ idea: HubIdea; rank: number }> = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (l[i]) out.push({ idea: l[i]!, rank: i + 1 });
  return out;
}
