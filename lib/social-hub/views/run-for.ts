import type { AllProgress, ProgressItem } from '@/lib/content-type/progress';
import type { QuotaCandidate } from '@/lib/social-hub/views/day-rank';

const TYPES = ['carousels', 'stories', 'explainers', 'last_few_days'] as const;

const TYPE_LABEL = { carousels: 'Carousels', stories: 'Stories', explainers: 'Explainers', last_few_days: 'Last Few Days' } as const;

/** Stable id of what the Content page already knows is in flight, so a poll can tell when that changed. */
export function inFlightKey(runs: AllProgress): string {
  return TYPES.flatMap((v) => (runs[v] ?? []).map((i) => `${v}:${i.id}:${i.state}:${i.stage ?? ''}`)).sort().join('|');
}

/** One line per type that is queued or running, for the top of the Content page. */
export function runningSummary(runs: AllProgress): string[] {
  return TYPES.flatMap((v) => {
    const items = runs[v] ?? [];
    if (!items.length) return [];
    return [`${TYPE_LABEL[v]} ${items.some((i) => i.state === 'running') ? 'running' : 'queued'}`];
  });
}

/**
 * The run behind a Today's Content card.
 * Explainers name their topic. Stories name their series. A carousel run
 * asked for particular stories (Run now) names them, like an explainer; one
 * that picks its own is a single job for the type and shows on every card,
 * including ones that already have a post. Those posts are never status
 * "generating".
 */
export function runForCandidate(c: QuotaCandidate, runs: AllProgress): ProgressItem | null {
  if (c.vertical === 'reels') return null;
  const items = runs[c.vertical] ?? [];
  const own = items.find((i) => i.topicId && c.idea && (c.idea.id === i.topicId || c.idea.id.endsWith(`:${i.topicId}`)));
  if (own) return own;
  if (c.vertical === 'explainers') return null;
  if (c.vertical === 'stories') return c.series ? items.find((i) => i.label === c.series) ?? null : null;
  // A run that picks its own stories shows on every card; one asked for particular stories (topicId) only on those.
  // A Last Few Days run is always the type's own job: it shows on its card.
  if (c.vertical === 'carousels' || c.vertical === 'last_few_days') {
    const open = items.filter((i) => !i.topicId);
    return open.find((i) => i.state === 'running') ?? open.find((i) => i.state === 'queued') ?? null;
  }
  return null;
}

/**
 * The run chip on a made card. A carousel run that picks its own stories is a
 * job for the type, not for this post, so it only shows here when the post is
 * being made or the run names this post's idea. Otherwise the card keeps its
 * state badge and buttons.
 */
export function runOnMadeCard(post: { status: string; idea?: { id: string } | null }, run: ProgressItem | null): ProgressItem | null {
  if (!run) return null;
  if (post.status === 'generating') return run;
  const id = post.idea?.id;
  if (id && run.topicId && (id === run.topicId || id.endsWith(`:${run.topicId}`))) return run;
  return null;
}

/**
 * Whether Make it can target this card alone. A card with a target (Stories
 * series, or an idea) can; a carousel can too (the fresh-news run picks its own
 * story, one run at its cap). An idea-less Open slot of another type would run
 * the whole type step, so it waits for Run now.
 */
export function canMakeCard(c: QuotaCandidate): boolean {
  if (c.vertical === 'stories') return Boolean(c.seriesId);
  return Boolean(c.idea) || c.vertical === 'carousels' || c.vertical === 'last_few_days';
}
