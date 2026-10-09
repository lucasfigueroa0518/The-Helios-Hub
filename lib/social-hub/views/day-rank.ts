import type { HubIdea, HubPost, Vertical } from '@/lib/social-hub/types';
import { nyDateOf } from '@/lib/social-hub/time';
import { windowsOn } from '@/lib/social-hub/views/plan';
import { rankIdeas } from '@/lib/social-hub/views/pools';

/**
 * The day's ranking and its quota candidates (Lucas, 2026-10-09).
 *
 * Each type's day is filled by its highest-ranked ideas, not by whatever
 * content happens to be made. A person can move ideas for one day:
 *
 *   Promote  the idea goes to #1 (a manual bump above everything else)
 *   Demote   the idea drops below the idea right under it (#1 → #2)
 *
 * Moves are applied in the order they were made, on top of that day's score
 * ranking, and expire with the day. The quota candidates are: what already
 * holds a slot today (scheduled, posting, posted), then the top of the
 * adjusted ranking for the rest of the quota. Only quota candidates appear in
 * Today's Content; Run now makes the candidates that have no content yet.
 * Pure over plain data, so the page, Run now and the tests agree.
 */

export type IdeaAdjustment = { vertical: Vertical; ideaId: string; nyDate: string; kind: 'promote' | 'demote'; createdAt: string };

/** Posts per day for the types with a quota (Stories go by series days). */
export type DayQuotas = { reels: number; carousels: number; explainers: number };

export type RankedIdea = { idea: HubIdea; rank: number; moved: 'promoted' | 'demoted' | null };

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
  /** Stories: the series this slot is for. */
  series?: string;
};

const OPEN = new Set(['idea_only', 'content_ready']);
const HOLDS = new Set(['scheduled', 'publishing', 'published']);

/** Apply one day's moves, in order, to a ranked list. */
export function applyMoves<T extends { id: string }>(ranked: readonly T[], moves: ReadonlyArray<Pick<IdeaAdjustment, 'ideaId' | 'kind'>>): T[] {
  const list = [...ranked];
  for (const move of moves) {
    const i = list.findIndex((x) => x.id === move.ideaId);
    if (i < 0) continue;
    if (move.kind === 'promote') list.unshift(...list.splice(i, 1));
    else if (i < list.length - 1) [list[i], list[i + 1]] = [list[i + 1]!, list[i]!];
  }
  return list;
}

/** Today's moves for one type, oldest first. */
export function movesFor(adjustments: readonly IdeaAdjustment[], vertical: Vertical, nyDate: string): IdeaAdjustment[] {
  return adjustments.filter((a) => a.vertical === vertical && a.nyDate === nyDate).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * A type's open ideas in today's order: score order, then today's moves.
 * Stories rank within each series (`group`), never across series.
 */
export function dayRanking(ideas: readonly HubIdea[], vertical: Vertical, adjustments: readonly IdeaAdjustment[], nyDate: string): RankedIdea[] {
  const open = ideas.filter((i) => i.vertical === vertical && OPEN.has(i.state));
  const moves = movesFor(adjustments, vertical, nyDate);
  const lastMove = new Map(moves.map((m) => [m.ideaId, m.kind === 'promote' ? ('promoted' as const) : ('demoted' as const)]));
  const groups = new Map<string, HubIdea[]>();
  for (const idea of open) {
    const g = vertical === 'stories' ? idea.group ?? '' : '';
    groups.set(g, [...(groups.get(g) ?? []), idea]);
  }
  const out: RankedIdea[] = [];
  for (const list of groups.values()) {
    applyMoves(rankIdeas(list), moves).forEach((idea, i) => out.push({ idea, rank: i + 1, moved: lastMove.get(idea.id) ?? null }));
  }
  return out;
}

/** A post belongs to an idea when it names it (bare, or as the idea id's last part). */
export function ideaOwns(idea: HubIdea, post: HubPost): boolean {
  const ref = post.idea?.id;
  return Boolean(ref) && (idea.id === ref || idea.id.endsWith(`:${ref}`));
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
    .filter((p) => p.status === 'ready' && hasMedia(p))
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
      return { vertical, idea: null, post, locked: Boolean(post && HOLDS.has(post.status)), rank: null, moved: null, series: w.label };
    });
  }
  const quota = Math.min(data.dayQuotas?.[vertical] ?? windows.length, windows.length);
  if (quota <= 0) return [];
  const locked = data.posts
    // A slot holds with content to show; a posted one already went out.
    .filter((p) => p.vertical === vertical && p.nyDate === today && HOLDS.has(p.status) && (p.status === 'published' || hasMedia(p)))
    .sort((a, b) => at(a).localeCompare(at(b)) || a.id.localeCompare(b.id))
    .slice(0, quota);
  const ranking = dayRanking(data.ideas, vertical, data.adjustments ?? [], today).filter((r) => !locked.some((p) => ideaOwns(r.idea, p)));
  const out: QuotaCandidate[] = locked.map((post) => {
    const r = dayRanking(data.ideas, vertical, data.adjustments ?? [], today).find((x) => ideaOwns(x.idea, post));
    return { vertical, idea: r?.idea ?? null, post, locked: true, rank: r?.rank ?? null, moved: r?.moved ?? null };
  });
  for (const r of ranking.slice(0, quota - locked.length)) {
    out.push({ vertical, idea: r.idea, post: contentFor(r.idea, data.posts), locked: false, rank: r.rank, moved: r.moved });
  }
  // Fewer open ideas than the quota (a pool not refilled yet): the rest are open slots the next run fills.
  while (out.length < quota) out.push({ vertical, idea: null, post: null, locked: false, rank: null, moved: null });
  return out;
}

export const DAY_TYPES: readonly Vertical[] = ['reels', 'carousels', 'explainers', 'stories'];

/** Every type's quota candidates for today, in the hub's type order. */
export function allQuotaCandidates(data: Parameters<typeof quotaCandidates>[0], now: Date): QuotaCandidate[] {
  return DAY_TYPES.flatMap((v) => quotaCandidates(data, v, now));
}
