import type { AllProgress, ProgressItem } from '@/lib/content-type/progress';
import type { QuotaCandidate } from '@/lib/social-hub/views/day-rank';

const TYPES = ['carousels', 'stories', 'explainers'] as const;

const TYPE_LABEL = { carousels: 'Carousels', stories: 'Stories', explainers: 'Explainers' } as const;

/** Stable id of what the Content page already knows is in flight, so a poll can tell when that changed. */
export function inFlightKey(runs: AllProgress): string {
  return TYPES.flatMap((v) => runs[v].map((i) => `${v}:${i.id}:${i.state}:${i.stage ?? ''}`)).sort().join('|');
}

/** One line per type that is queued or running, for the top of the Content page. */
export function runningSummary(runs: AllProgress): string[] {
  return TYPES.flatMap((v) => {
    const items = runs[v];
    if (!items.length) return [];
    return [`${TYPE_LABEL[v]} ${items.some((i) => i.state === 'running') ? 'running' : 'queued'}`];
  });
}

/**
 * The run behind a Today's Content card.
 * Explainers name their topic. Stories name their series. A carousel run is
 * one job for the type, and the carousel page stamps it on every card, so
 * today's carousel cards do too — including ones that already have a post.
 * Those posts are never status "generating".
 */
export function runForCandidate(c: QuotaCandidate, runs: AllProgress): ProgressItem | null {
  if (c.vertical === 'reels') return null;
  const items = runs[c.vertical] ?? [];
  const own = items.find((i) => i.topicId && c.idea && (c.idea.id === i.topicId || c.idea.id.endsWith(`:${i.topicId}`)));
  if (own) return own;
  if (c.vertical === 'explainers') return null;
  if (c.vertical === 'stories') return c.series ? items.find((i) => i.label === c.series) ?? null : null;
  if (c.vertical === 'carousels') return items.find((i) => i.state === 'running') ?? items.find((i) => i.state === 'queued') ?? null;
  return null;
}
