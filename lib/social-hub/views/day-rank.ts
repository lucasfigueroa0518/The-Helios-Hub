import type { HubIdea, HubPost, Vertical } from '@/lib/social-hub/types';
import { nyDateOf } from '@/lib/social-hub/time';
import { windowsOn } from '@/lib/social-hub/views/plan';
import { rankIdeas } from '@/lib/social-hub/views/pools';
import { isRejected } from '@/lib/social-hub/views/state';
import { applyMoves, movesFor, moveTags, type IdeaAdjustment, type MoveTag } from '@/lib/social-hub/views/moves';

/**
 * The day's ranking and its quota candidates (Lucas, 2026-10-09).
 *
 * Each type's day is filled by its highest-ranked ideas, not by whatever
 * content happens to be made. A person can move ideas for one day:
 *
 *   Promote  "make this next": the type's oldest promote goes first tonight;
 *            other promotes wait in their score place (views/moves.ts)
 *   Demote   the idea sinks below every idea that isn't demoted
 *
 * The shared rule sits on top of that day's score ranking; moves last until
 * their idea is made (B8).
 *
 * The quota candidates are, in order: what already holds a slot today
 * (scheduled, posting, posted); then content made today with no slot, for
 * any idea (the night picks its own, 2026-10-13: made content wins); then the
 * top of the adjusted ranking for what's left. Rejected content never fills a
 * card. One card per idea. Only quota candidates appear in Today's Content;
 * Run now makes the candidates that have no content yet.
 * Pure over plain data, so the page, Run now and the tests agree.
 */

export { applyMoves, movesFor };
export type { IdeaAdjustment, MoveTag };

/** Posts per day for the types with a quota (Stories go by series days). */
export type DayQuotas = { reels: number; carousels: number; explainers: number };

export type RankedIdea = { idea: HubIdea; rank: number; moved: 'promoted' | 'demoted' | null; tag: MoveTag | null };

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
  /** Stories: the series window id (Make it's target). */
  seriesId?: string;
};

const OPEN = new Set(['idea_only', 'content_ready']);
const HOLDS = new Set(['scheduled', 'publishing', 'published']);

/**
 * A type's open ideas in today's order: score order, then today's moves.
 * Stories rank within each series (`group`), never across series.
 */
export function dayRanking(ideas: readonly HubIdea[], vertical: Vertical, adjustments: readonly IdeaAdjustment[], now = new Date()): RankedIdea[] {
  const open = ideas.filter((i) => i.vertical === vertical && OPEN.has(i.state));
  const moves = movesFor(adjustments, vertical);
  const tags = moveTags(moves, vertical, now);
  const lastMove = new Map(moves.map((m) => [m.ideaId, m.kind === 'promote' ? ('promoted' as const) : ('demoted' as const)]));
  const groups = new Map<string, HubIdea[]>();
  for (const idea of open) {
    const g = vertical === 'stories' ? idea.group ?? '' : '';
    groups.set(g, [...(groups.get(g) ?? []), idea]);
  }
  const out: RankedIdea[] = [];
  for (const list of groups.values()) {
    applyMoves(rankIdeas(list), moves).forEach((idea, i) => out.push({ idea, rank: i + 1, moved: lastMove.get(idea.id) ?? null, tag: tags.get(idea.id) ?? null }));
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
    .filter((a) => a.vertical !== 'stories' && posts.some((p) =>
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
function contentFor(idea: HubIdea, posts: readonly HubPost[]): HubPost | null {
  const mine = posts.filter((p) => p.vertical === idea.vertical && ideaOwns(idea, p));
  const making = mine.find((p) => p.status === 'generating');
  if (making) return making;
  return mine
    .filter((p) => p.status === 'ready' && hasMedia(p) && !isRejected(p))
    .sort((a, b) => (b.generatedAt ?? '').localeCompare(a.generatedAt ?? '') || a.id.localeCompare(b.id))[0] ?? null;
}

const at = (p: HubPost) => p.postedAt ?? p.publishAt ?? '';

/** One type's quota candidates for the day `now` falls on. */
export function quotaCandidates(
  data: { posts: readonly HubPost[]; ideas: readonly HubIdea[]; adjustments?: readonly IdeaAdjustment[]; dayQuotas?: DayQuotas | null },
  vertical: Vertical,
  now: Date,
): QuotaCandidate[] {
  const today = nyDateOf(now)!;
  const windows = windowsOn(vertical, today);
  if (vertical === 'stories') {
    // A Stories slot is one series' set for the day; its ideas feed the build.
    return windows.map((w) => {
      const sets = data.posts.filter((p) => p.vertical === 'stories' && p.nyDate === today && p.idea?.label === w.label && !['failed', 'skipped', 'cancelled'].includes(p.status));
      const post = sets.find((p) => HOLDS.has(p.status)) ?? sets.find((p) => p.status === 'generating' || hasMedia(p)) ?? null;
      return { vertical, idea: null, post, locked: Boolean(post && HOLDS.has(post.status)), rank: null, moved: null, series: w.label, seriesId: w.id };
    });
  }
  const quota = Math.min(data.dayQuotas?.[vertical] ?? windows.length, windows.length);
  if (quota <= 0) return [];
  const locked = data.posts
    // A slot holds with content to show; a posted one already went out.
    .filter((p) => p.vertical === vertical && p.nyDate === today && HOLDS.has(p.status) && (p.status === 'published' || hasMedia(p)))
    .sort((a, b) => at(a).localeCompare(at(b)) || a.id.localeCompare(b.id))
    .slice(0, quota);
  const full = dayRanking(data.ideas, vertical, data.adjustments ?? [], now);
  const sameIdea = (a: HubPost, b: HubPost) => a.idea?.id != null && a.idea.id === b.idea?.id;
  // Made today with no slot, any idea (2026-10-13): the night picks its own topic, so what it made holds the
  // day's place ahead of the ranking. Newest first, one per idea, never one already in a slot.
  const madeToday: HubPost[] = [];
  for (const p of data.posts
    .filter((p) => p.vertical === vertical && p.status === 'ready' && hasMedia(p) && !isRejected(p) && p.generatedAt != null && nyDateOf(new Date(p.generatedAt)) === today)
    .sort((a, b) => (b.generatedAt ?? '').localeCompare(a.generatedAt ?? '') || a.id.localeCompare(b.id))) {
    if (madeToday.length >= Math.max(0, quota - locked.length)) break;
    if (locked.includes(p) || locked.some((l) => sameIdea(l, p)) || madeToday.some((m) => sameIdea(m, p))) continue;
    madeToday.push(p);
  }
  const held = [...locked, ...madeToday];
  const ranking = full.filter((r) => !held.some((p) => ideaOwns(r.idea, p)));
  const out: QuotaCandidate[] = held.map((post) => {
    const r = full.find((x) => ideaOwns(x.idea, post));
    return { vertical, idea: r?.idea ?? null, post, locked: locked.includes(post), rank: r?.rank ?? null, moved: r?.moved ?? null, tag: r?.tag ?? null };
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

export const DAY_TYPES: readonly Vertical[] = ['reels', 'carousels', 'explainers', 'stories'];

/** Every type's quota candidates for today, as the day's cards in posting order. */
export function allQuotaCandidates(data: Parameters<typeof quotaCandidates>[0], now: Date): QuotaCandidate[] {
  return orderCards(DAY_TYPES.flatMap((v) => quotaCandidates(data, v, now)));
}
