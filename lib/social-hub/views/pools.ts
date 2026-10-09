import { VERTICAL_IDS } from '@/lib/social-hub/verticals';
import type { HubIdea, IdeaState, Vertical } from '@/lib/social-hub/types';

/**
 * Idea pools (BRIEFS.md §1, REVISIONS C6): how full each type's tank is and
 * what's next. Each type keeps its own score scale, so scores are never
 * compared across types, only ranked within one.
 */

/** Every pool refills at least nightly; three days without one means its run has stopped. */
export const POOL_STALE_MS = 3 * 86_400_000;

export function poolStale(lastRefill: string | null | undefined, now: Date): boolean {
  return Boolean(lastRefill) && now.getTime() - Date.parse(lastRefill!) > POOL_STALE_MS;
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

export function poolSummaries(ideas: readonly HubIdea[]): PoolSummary[] {
  return VERTICAL_IDS.map((v) => poolSummary(ideas, v));
}

export type PoolFilter = 'open' | 'ready' | 'all';

export function poolList(ideas: readonly HubIdea[], vertical: Vertical, filter: PoolFilter): HubIdea[] {
  const mine = ideas.filter((i) => i.vertical === vertical);
  const kept = filter === 'all' ? mine : filter === 'ready' ? mine.filter((i) => i.state === 'content_ready') : mine.filter((i) => OPEN.has(i.state));
  return rankIdeas(kept);
}
