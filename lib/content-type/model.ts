import type { HubDataset } from '@/lib/social-hub/dataset';
import { addDays, nyDateOf } from '@/lib/social-hub/time';
import { capacityWindows } from '@/lib/social-hub/views/plan';
import type { HubIdea, HubPost, Vertical } from '@/lib/social-hub/types';
import { offerer, type Offer } from '@/lib/social-hub/views/offer';
import { poolSummary } from '@/lib/social-hub/views/pools';
import { dayRanking, quotaCandidates } from '@/lib/social-hub/views/day-rank';
import type { MoveTag } from '@/lib/social-hub/views/moves';
import { thumbOf } from '@/components/social-hub/ui/Thumb';
import { AI_EVENTS_CITY_TABS, weekLabel } from '@/lib/social-hub/adapters/ai-events';
import { SCORE_MAX as EVENT_SCORE_MAX } from '@/lib/networking/pick/score';

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
  /** The shared queue's tag (Tonight, Promoted · waiting, Can’t be made: …, Demoted). */
  tag?: MoveTag | null;
  /** One of today's quota candidates: the day is filled with it. */
  inQuota?: boolean;
  /** The row's chip when the type names its states its own way (AI Events: In the post, Pinned, Gated, Excluded). */
  chip?: string | null;
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
  /** The bench's tabs, in order (Stories: its series; AI Events: its cities). Empty: no tabs. */
  groups: readonly string[];
  /** The top of the type's score scale, for a score bar on each row; null: no bar. */
  scoreMax: number | null;
  /** AI Events: the week the pool shows, and whether Pin / Exclude still change it (only the coming week's post can). */
  poolWeek?: { label: string; editable: boolean } | null;
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
    const slots = capacityWindows(vertical, date, dataset.dayQuotas?.lfdDays ?? [], cards.length, today, dataset.dayQuotas?.slots ?? null).length;
    const ranked = [...cards].sort((a, b) => at(a.post).localeCompare(at(b.post)) || a.post.id.localeCompare(b.post.id));
    waiting.push(...ranked.slice(slots));
    byDay.set(date, ranked.slice(0, slots));
  }
  const days = [...byDay.entries()]
    .map(([date, cards]) => ({ date, cards: cards.sort((a, b) => at(a.post).localeCompare(at(b.post)) || a.post.id.localeCompare(b.post.id)) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const summary = poolSummary(dataset.ideas, vertical);
  const ranking = dayRanking(dataset.ideas, vertical, dataset.adjustments ?? [], now);
  const open = ranking.map((r) => r.idea);
  const movedOf = new Map(ranking.map((r) => [r.idea.id, r.moved]));
  const tagOf = new Map(ranking.map((r) => [r.idea.id, r.tag]));
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
    idea, rank, card, made: card ? madeKind(card.post) : null, moved: movedOf.get(idea.id) ?? null, tag: tagOf.get(idea.id) ?? null, inQuota: quotaIdeas.has(idea.id),
  });
  const rows: TypeBenchItem[] = vertical === 'stories'
    ? bySeries(open).map(({ idea, rank }) => row(idea, rank, forIdea(idea)))
    : vertical === 'ai_events'
      // The week's whole pool, retired events included (their gate or exclude is the point), ranked within each city.
      ? byCity(dataset.ideas.filter((i) => i.vertical === 'ai_events')).map(({ idea, rank }) => ({ ...row(idea, rank, null), chip: eventChip(idea) }))
      : open.slice(0, 50).map((idea, i) => row(idea, i + 1, forIdea(idea)));
  // Content whose idea is no longer open still needs a person: keep it on the bench under its own name.
  for (const card of ready) {
    if (matched.has(card.post.id)) continue;
    // AI Events: the week's post leads the bench, outside the city tabs (rank 0 shows no number).
    const group = vertical === 'ai_events' ? null : card.post.idea?.label ?? null;
    const rank = vertical === 'ai_events' ? 0 : vertical === 'stories' ? rows.filter((r) => r.idea.group === group).length + 1 : rows.length + 1;
    const item = row({ id: card.post.id, vertical, title: card.post.name, score: null, scoreLabel: '', state: 'content_ready', hasContent: true, versionCount: 1, generatedAt: card.post.generatedAt, createdAt: card.post.generatedAt, detail: null, group }, rank, card);
    if (vertical === 'ai_events') rows.unshift(item);
    else rows.push(item);
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
    groups: vertical === 'stories' ? STORY_SERIES : vertical === 'ai_events' ? AI_EVENTS_CITY_TABS : [],
    scoreMax: vertical === 'ai_events' ? EVENT_SCORE_MAX : null,
    ...(vertical === 'ai_events'
      ? { poolWeek: dataset.aiEventsWeek ? { label: weekLabel(dataset.aiEventsWeek.startDate, dataset.aiEventsWeek.endDate), editable: dataset.aiEventsWeek.editable } : null }
      : {}),
  };
}

export const AI_EVENTS_NO_REVIEW_POST = 'No post for the coming week is waiting for review. Generate makes one first.';

/**
 * Why Rebuild post can't run now, or null. It rebuilds the coming week's post (lib/ai-events/pool.ts
 * queueRebuild), so it needs that week's post, made and not yet out: one the hub shows as ready or
 * scheduled for the Sunday before the shown week, while that week is still the coming one.
 */
export function aiEventsRebuildRefusal(dataset: Pick<HubDataset, 'posts' | 'aiEventsWeek'>): string | null {
  const week = dataset.aiEventsWeek;
  if (!week?.editable) return AI_EVENTS_NO_REVIEW_POST;
  const sunday = `ai_events:${addDays(week.startDate, -1)}`;
  const waiting = dataset.posts.some((p) => p.vertical === 'ai_events' && (p.status === 'ready' || p.status === 'scheduled') && p.idea?.id === sunday);
  return waiting ? null : AI_EVENTS_NO_REVIEW_POST;
}

/** AI Events' bench order within a city: the picks (in the post), the rest by score, then the retired. */
const EVENT_TIER: Record<string, number> = { content_ready: 0, idea_only: 1, retired: 2 };

/**
 * AI Events: one list, city by city in post order (AE-02), each city ranked on
 * its own (a city's scores mean nothing against another's), rank within the city.
 */
export function byCity(ideas: readonly HubIdea[]): Array<{ idea: HubIdea; rank: number }> {
  const order = [...AI_EVENTS_CITY_TABS, ...new Set(ideas.map((i) => i.group ?? 'Other').filter((g) => !AI_EVENTS_CITY_TABS.includes(g)))];
  return order.flatMap((city) =>
    ideas
      .filter((i) => (i.group ?? 'Other') === city)
      .sort((a, b) => (EVENT_TIER[a.state] ?? 3) - (EVENT_TIER[b.state] ?? 3) || (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.title.localeCompare(b.title))
      .map((idea, i) => ({ idea, rank: i + 1 })),
  );
}

/** An AI Events row's chip: in the post, pinned, excluded, gated out, out of the candidates, or waiting. */
export function eventChip(idea: HubIdea): string {
  if (idea.hold === 'excluded') return 'Excluded';
  if (idea.state === 'content_ready') return idea.hold === 'pinned' ? 'In the post · pinned' : 'In the post';
  if (idea.hold === 'pinned') return 'Pinned';
  if (idea.state === 'retired') return idea.detail?.includes('Gated out:') ? 'Gated out' : 'Out';
  return 'In the pool';
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
