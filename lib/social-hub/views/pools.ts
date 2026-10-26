import { VERTICAL_IDS } from '@/lib/social-hub/verticals';
import type { HubIdea, IdeaState, Vertical } from '@/lib/social-hub/types';
import { applyMoves, movesFor, type IdeaAdjustment } from '@/lib/social-hub/views/moves';

/**
 * Idea pools (BRIEFS.md §1, REVISIONS C6): how full each type's tank is and
 * what's next. Each type keeps its own score scale, so scores are never
 * compared across types, only ranked within one.
 */

/** Every pool refills at least nightly; three days without one means its run has stopped (Last Few Days and AI Events refill less often). */
export const POOL_STALE_MS = 3 * 86_400_000;

/** Last Few Days refills twice a week (Friday to Tuesday is four days), so its pool is stale only after five. */
const LFD_STALE_MS = 5 * 86_400_000;

/** AI Events ranks its pool once a week (Sunday noon), so it is stale only after eight days. */
export const AI_EVENTS_STALE_MS = 8 * 86_400_000;

export function poolStale(lastRefill: string | null | undefined, now: Date, vertical?: Vertical): boolean {
  const limit = vertical === 'last_few_days' ? LFD_STALE_MS : vertical === 'ai_events' ? AI_EVENTS_STALE_MS : POOL_STALE_MS;
  return Boolean(lastRefill) && now.getTime() - Date.parse(lastRefill!) > limit;
}

export const IDEA_STATE_LABEL: Record<IdeaState, string> = {
  idea_only: 'Idea',
  content_ready: 'Content ready',
  on_deck: 'Scheduled',
  published: 'Posted',
  retired: 'Retired',
  skipped: 'Skipped',
};

/** Ideas that can still become a post. */
const OPEN: ReadonlySet<IdeaState> = new Set(['idea_only', 'content_ready']);

export type PoolSummary = {
  vertical: Vertical;
  open: number;
  ready: number;
  next: HubIdea[];
  lastRefill: string | null;
  scoreLabel: string | null;
};

export function rankIdeas(ideas: readonly HubIdea[]): HubIdea[] {
  return [...ideas].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.title.localeCompare(b.title));
}

export function poolSummary(ideas: readonly HubIdea[], vertical: Vertical): PoolSummary {
  const mine = ideas.filter((i) => i.vertical === vertical);
  const open = rankIdeas(mine.filter((i) => OPEN.has(i.state)));
  const lastRefill = mine.map((i) => i.createdAt ?? i.generatedAt).filter((d): d is string => Boolean(d)).sort().at(-1) ?? null;
  return {
    vertical,
    open: open.length,
    ready: open.filter((i) => i.state === 'content_ready').length,
    next: open.slice(0, 3),
    lastRefill,
    scoreLabel: mine[0]?.scoreLabel ?? null,
  };
}

/** How often a type's pool normally refills, for the stale note ("it normally refills …"). */
export const REFILL_CADENCE: Record<Vertical, string> = {
  reels: 'every night',
  explainers: 'every night',
  carousels: 'every night',
  stories: 'every night',
  last_few_days: 'twice a week',
  ai_events: 'every Sunday at noon',
};

export function poolSummaries(ideas: readonly HubIdea[]): PoolSummary[] {
  return VERTICAL_IDS.map((v) => poolSummary(ideas, v));
}

export type PoolFilter = 'open' | 'ready' | 'all';

/** A type's pool in score order, with the shared queue on top: tonight's promote first, demoted ideas last (L2). */
export function poolList(ideas: readonly HubIdea[], vertical: Vertical, filter: PoolFilter, adjustments: readonly IdeaAdjustment[] = []): HubIdea[] {
  const mine = ideas.filter((i) => i.vertical === vertical);
  const kept = filter === 'all' ? mine : filter === 'ready' ? mine.filter((i) => i.state === 'content_ready') : mine.filter((i) => OPEN.has(i.state));
  return applyMoves(rankIdeas(kept), movesFor(adjustments, vertical));
}
