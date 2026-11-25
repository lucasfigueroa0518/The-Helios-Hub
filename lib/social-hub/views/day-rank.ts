import { isStoryVertical } from '@/lib/social-hub/story-types';
import type { HubIdea, HubPost, Vertical } from '@/lib/social-hub/types';
import { nyDateOf } from '@/lib/social-hub/time';
import { capacityWindows, placedCount } from '@/lib/social-hub/views/plan';
import type { SlotsByDate } from '@/lib/social-hub/slots/types';
import { rankIdeas } from '@/lib/social-hub/views/pools';
import { isRejected } from '@/lib/social-hub/views/state';
import { capQueued, queueOrder, queueTags, runLead } from '@/lib/social-hub/queue';
import { movesFor, type IdeaAdjustment, type MoveTag } from '@/lib/social-hub/views/moves';

/**
 * The day's ranking and its quota candidates (Lucas, 2026-10-09).
 *
 * Each type's day is filled by its highest-ranked ideas, not by whatever
 * content happens to be made. A person steers the order through the shared
 * queue (lib/social-hub/queue.ts): pins first in the order pinned, a dragged
 * idea at the key its drop left it, archived ideas gone.
 *
 * The queue sits on top of that day's score ranking; moves last until their
 * idea is made (B8).
 *
 * The quota candidates are, in order: what already holds a slot today
 * (scheduled, posting, posted); then content made today with no slot, for
 * any idea (the night picks its own, 2026-10-13: made content wins); then the
 * top of the adjusted ranking for what's left. Rejected content never fills a
 * card. One card per idea. Only quota candidates appear in Today's Content;
 * Run now makes the candidates that have no content yet.
 * Pure over plain data, so the page, Run now and the tests agree.
 */

export { movesFor };
export type { IdeaAdjustment, MoveTag };

/** Posts per day for the types with a quota (Stories go by series days). */
export type DayQuotas = {
  reels: number;
  carousels: number;
  explainers: number;
  /** One post on each of its days (spec §7.4); missing reads as one. */
  last_few_days?: number;
  /** AI Events: Miami and Boston carousels on each of its days (Sunday, AE-29); missing reads as one. */
  ai_events?: number;
  /** Field Notes: one post on each calendar day it holds a slot (cap 1); missing reads as one. */
  field_notes?: number;
  /** AI Drama Reels: its slots for the day (template), else posts_per_day; missing reads as its windows. */
  reel_ai_drama?: number;
  /** The weekdays Carousels give up to Last Few Days while its auto_run is on (LFD-02); none when missing. */
  lfdDays?: readonly number[];
  /** The calendar's slots by date (template mode), today − 7 … today + 21; null or missing while legacy. */
  slots?: SlotsByDate | null;
};

export type RankedIdea = { idea: HubIdea; rank: number; moved: 'promoted' | 'demoted' | null; tag: MoveTag | null; pinned: boolean; placed: boolean };

export type QuotaCandidate = {
  vertical: Vertical;
  /** The idea behind the slot (null for Stories, whose candidate is a series' set, and for a locked post with no idea in the pool). */
  idea: HubIdea | null;
  /** Its content: made, being made, or holding today's slot. Null: not made yet. */
  post: HubPost | null;
  /** Holds today's slot already (scheduled, posting, posted). */
  locked: boolean;
  /** Its place in today's adjusted ranking. */
  rank: number | null;
  moved: RankedIdea['moved'];
  /** The shared queue's tag: Tonight, Promoted · waiting, Can’t be made: …, Demoted. */
  tag?: MoveTag | null;
  /** Stories: the series this slot is for. */
  series?: string;
  /** Stories: the slot's id, Make it's target (the series window id in legacy, `t0510:morning_download` in template mode). */
  seriesId?: string;
};

const OPEN = new Set(['idea_only', 'content_ready']);
const HOLDS = new Set(['scheduled', 'publishing', 'published']);

/**
 * A type's open ideas in today's order: the queue's (score order, then the moves). `_now` is kept for callers.
 * Stories rank within each series (`group`), never across series; AI Events
 * within each city (`group`).
 */
export function dayRanking(ideas: readonly HubIdea[], vertical: Vertical, adjustments: readonly IdeaAdjustment[], _now = new Date()): RankedIdea[] {
  const open = ideas.filter((i) => i.vertical === vertical && OPEN.has(i.state));
  const moves = movesFor(adjustments, vertical);
  const present = new Set(open.map((i) => i.id));
  const tags = queueTags(moves, present);
  const groups = new Map<string, HubIdea[]>();
  for (const idea of open) {
    const g = isStoryVertical(vertical) || vertical === 'ai_events' ? idea.group ?? '' : '';
    groups.set(g, [...(groups.get(g) ?? []), idea]);
  }
  const out: RankedIdea[] = [];
  for (const list of groups.values()) {
    for (const q of capQueued(queueOrder(rankIdeas(list), moves, runLead(list)))) out.push({ idea: q.item, rank: q.rank, moved: q.pinned ? 'promoted' : null, tag: tags.get(q.item.id) ?? null, pinned: q.pinned, placed: q.placed });
  }
  return out;
}

/** A post belongs to an idea id when it names it (bare, or as the id's last part). */
export function ownsIdeaId(ideaId: string, post: HubPost): boolean {
  const ref = post.idea?.id;
  return Boolean(ref) && (ideaId === ref || ideaId.endsWith(`:${ref}`));
}

/** A post belongs to an idea when it names it (bare, or as the idea id's last part). */
export function ideaOwns(idea: HubIdea, post: HubPost): boolean {
  return ownsIdeaId(idea.id, post);
}

/**
 * Moves used up (B8): the idea got content made after the move (anything but
 * still being made; a rejection follows a making, so it counts too). Content
 * made before the move doesn't use it: a person promoted an idea that already
 * had content on purpose. Stories go by their pool entry (queries/day.ts).
 */
export function madeMoveIds(adjustments: readonly IdeaAdjustment[], posts: readonly HubPost[]): string[] {
  return adjustments
    .filter((a) => a.kind !== 'archive' && !isStoryVertical(a.vertical) && posts.some((p) =>
      p.vertical === a.vertical
      && p.status !== 'generating'
      && ownsIdeaId(a.ideaId, p)
      && p.generatedAt != null
      && Date.parse(p.generatedAt) >= Date.parse(a.createdAt)))
    .map((a) => a.id);
}

/** What a post actually has to look at: rendered slides, story frames, or a video file. */
export function hasMedia(post: HubPost): boolean {
  const m = post.media;
  if (m.kind === 'video') return Boolean(m.src || m.poster);
  if (m.kind === 'slides') return m.slides.some((s) => s.src || s.photo);
  if (m.kind === 'frames') return m.frames.some((f) => f.src);
  return false;
}

/** An idea's content for today: being made, or made with something to look at and not failed, skipped or rejected. Newest first. */
export function contentFor(idea: HubIdea, posts: readonly HubPost[]): HubPost | null {
  const mine = posts.filter((p) => p.vertical === idea.vertical && ideaOwns(idea, p));
  const making = mine.find((p) => p.status === 'generating');
  if (making) return making;
  return mine
    .filter((p) => p.status === 'ready' && hasMedia(p) && !isRejected(p))
    .sort((a, b) => (b.generatedAt ?? '').localeCompare(a.generatedAt ?? '') || a.id.localeCompare(b.id))[0] ?? null;
}

const at = (p: HubPost) => p.postedAt ?? p.publishAt ?? '';

/**
 * One type's quota candidates for a day: the day `now` falls on, or `day` (a later New York date, the Content
 * page's look-ahead tabs). A later day shows only what is already made or booked for it (made-ahead posts carry
 * their target date, lib/social-hub/lead.ts) and leaves the rest as open slots: its night run picks those ideas,
 * so no ranking is shown for it (the ranking is today's).
 */
export function quotaCandidates(
  data: { posts: readonly HubPost[]; ideas: readonly HubIdea[]; adjustments?: readonly IdeaAdjustment[]; dayQuotas?: DayQuotas | null },
  vertical: Vertical,
  now: Date,
  day?: string,
): QuotaCandidate[] {
  const actual = nyDateOf(now)!;
  const today = day && day > actual ? day : actual;
  const ahead = today !== actual;
  const windows = capacityWindows(vertical, today, data.dayQuotas?.lfdDays ?? [], placedCount(data.posts, vertical, today), actual, data.dayQuotas?.slots ?? null);
  if (isStoryVertical(vertical)) {
    // A Stories-format slot is its type's one series' set for the day (SS-1); its ideas feed the build.
    return windows.map((w) => {
      const sets = data.posts.filter((p) => p.vertical === vertical && p.nyDate === today && p.idea?.label === w.label && !['failed', 'skipped', 'cancelled'].includes(p.status));
      const post = sets.find((p) => HOLDS.has(p.status)) ?? sets.find((p) => p.status === 'generating' || hasMedia(p)) ?? null;
      return { vertical, idea: null, post, locked: Boolean(post && HOLDS.has(post.status)), rank: null, moved: null, series: w.label, seriesId: w.id };
    });
  }
  if (vertical === 'last_few_days' || vertical === 'ai_events' || vertical === 'field_notes') {
    // One card per slot on its days: the posts holding today's windows, then today's made posts. Last Few Days
    // has no idea pool to rank; AI Events' pool is the week's events, which go into its city posts (AE-29);
    // Field Notes' tips go one each into a post, picked by the run, so nothing is ranked here either.
    const quota = Math.min(data.dayQuotas?.[vertical] ?? 1, windows.length);
    if (quota <= 0) return [];
    const ownIdea = vertical === 'last_few_days' ? `lfd:${today}` : vertical === 'ai_events' ? `ai_events:${today}` : `field_notes:${today}`;
    const mine = data.posts.filter((p) => p.vertical === vertical && !isRejected(p));
    const held = mine.filter((p) => p.nyDate === today && HOLDS.has(p.status)).sort((a, b) => at(a).localeCompare(at(b)) || a.id.localeCompare(b.id));
    // Made for today: its own idea id, or (a cushion type, Bald-Eagle D4) an unbooked post stamped with today as its target date.
    const made = mine.filter((p) => !held.includes(p) && (p.idea?.id === ownIdea || p.nyDate === today) && (p.status === 'generating' || (p.status === 'ready' && hasMedia(p))));
    const posts: Array<HubPost | null> = [...held, ...made].slice(0, quota);
    if (!posts.length) posts.push(null);
    return posts.map((post) => ({ vertical, idea: null, post, locked: Boolean(post && HOLDS.has(post.status)), rank: null, moved: null }));
  }
  const quota = Math.min(data.dayQuotas?.[vertical] ?? windows.length, windows.length);
  if (quota <= 0) return [];
  const locked = data.posts
    // A slot holds with content to show; a posted one already went out.
    .filter((p) => p.vertical === vertical && p.nyDate === today && HOLDS.has(p.status) && (p.status === 'published' || hasMedia(p)))
    .sort((a, b) => at(a).localeCompare(at(b)) || a.id.localeCompare(b.id))
    .slice(0, quota);
  if (ahead) {
    // A later day: its booked posts, then posts made for it with no slot yet, then open slots.
    const madeFor = data.posts
      .filter((p) => p.vertical === vertical && p.nyDate === today && !locked.includes(p) && !isRejected(p) && (p.status === 'generating' || (p.status === 'ready' && hasMedia(p))))
      .sort((a, b) => (a.generatedAt ?? '').localeCompare(b.generatedAt ?? '') || a.id.localeCompare(b.id));
    const posts: Array<HubPost | null> = [...locked, ...madeFor].slice(0, quota);
    while (posts.length < quota) posts.push(null);
    return posts.map((post) => {
      const idea = post ? data.ideas.find((i) => i.vertical === vertical && ideaOwns(i, post)) ?? null : null;
      return { vertical, idea, post, locked: Boolean(post && HOLDS.has(post.status)), rank: null, moved: null };
    });
  }
  const full = dayRanking(data.ideas, vertical, data.adjustments ?? [], now);
  // The queue decides (2026-10-21 pool standard): the day's open slots are the top of the ranking, each with its
  // content if it has any. Content made for an idea that is not in the top no longer jumps the queue.
  const held = locked;
  const ranking = full.filter((r) => !held.some((p) => ideaOwns(r.idea, p)));
  const out: QuotaCandidate[] = held.map((post) => {
    const r = full.find((x) => ideaOwns(x.idea, post));
    return { vertical, idea: r?.idea ?? null, post, locked: true, rank: r?.rank ?? null, moved: r?.moved ?? null, tag: r?.tag ?? null };
  });
  for (const r of ranking.slice(0, quota - held.length)) {
    out.push({ vertical, idea: r.idea, post: contentFor(r.idea, data.posts), locked: false, rank: r.rank, moved: r.moved, tag: r.tag });
  }
  // Fewer open ideas than the quota (a pool not refilled yet): the rest are open slots the next run fills.
  while (out.length < quota) out.push({ vertical, idea: null, post: null, locked: false, rank: null, moved: null });
  return out;
}

const cardAt = (c: QuotaCandidate) => c.post?.postedAt ?? c.post?.publishAt ?? '';

/** 0 booked or posted, 1 made with no slot, 2 being made, 3 not made yet. */
function cardTier(c: QuotaCandidate): number {
  if (!c.post) return 3;
  if (c.post.status === 'generating') return 2;
  return c.locked || cardAt(c) ? 0 : 1;
}

/** Today's cards in posting order: booked slots by time, then made with no slot, then being made, then not made yet (2026-10-13). */
export function orderCards(cards: readonly QuotaCandidate[]): QuotaCandidate[] {
  return cards
    .map((c, i) => ({ c, i }))
    .sort((a, b) => cardTier(a.c) - cardTier(b.c) || cardAt(a.c).localeCompare(cardAt(b.c)) || a.i - b.i)
    .map((x) => x.c);
}

export const DAY_TYPES: readonly Vertical[] = ['reels', 'carousels', 'explainers', 'stories', 'ai_trivia', 'real_or_ai', 'last_few_days', 'ai_events', 'field_notes', 'reel_ai_drama'];

/** Every type's quota candidates for today (or a later `day`), as the day's cards in posting order. */
export function allQuotaCandidates(data: Parameters<typeof quotaCandidates>[0], now: Date, day?: string): QuotaCandidate[] {
  return orderCards(DAY_TYPES.flatMap((v) => quotaCandidates(data, v, now, day)));
}
