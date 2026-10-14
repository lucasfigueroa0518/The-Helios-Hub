/**
 * Run now (the Content page): complete today's runs. Each type's day is
 * filled by its quota candidates (lib/social-hub/views/day-rank.ts): what
 * already holds a slot, then the top of today's ranking with Promote / Demote
 * applied. Run now makes the candidates that have no content yet, the way the
 * type's own buttons would (the person's click approves that spend, rule 1):
 *
 *   Text on Screen   each missing idea on today's slate is built (copy → frame → video);
 *                    with no slate today, a reels night is queued instead
 *   Carousels        a carousel run for the top of the ranked queue, in order (made
 *                    carousels are kept); with no ranked story it picks from fresh news
 *   Explainers       a render for each missing topic
 *   Stories          today's set for each series due today that has none
 *
 * `planFrom` decides from plain inputs (tested offline); the live layer
 * (lib/content-type/run-today-live.ts) reads them and re-plans on the server
 * when the person clicks, so a stale page can't run more than today needs.
 */
import type { Vertical } from '@/lib/social-hub/types';
import { verticalInfo } from '@/lib/social-hub/verticals';
import { quotaCandidates, type QuotaCandidate } from '@/lib/social-hub/views/day-rank';
import { ideaRef } from '@/lib/social-hub/views/moves';

/** One type's day: its quota and the candidates that still need content. */
export type TypeDay = { quota: number; held: number; missing: Array<{ ideaId: string; ref: string; title: string }> };

export type RunInputs = {
  today: string;
  reels: TypeDay & { slateToday: boolean };
  carousels: TypeDay;
  explainers: TypeDay;
  /** Series due today and whether each already has today's set. */
  series: Array<{ id: string; label: string; held: boolean }>;
  inFlight: { reelsRun: boolean; reelsBuilding: string[]; carouselRun: boolean; explainerTopics: string[] };
  cost: { reelsNight: number; reelBuild: number; carouselCap: number; explainerCap: number; storySet: number };
};

export type PlanStep = {
  vertical: Vertical;
  label: string;
  quota: number;
  held: number;
  needed: number;
  action: 'none' | 'reels_build' | 'reels_run' | 'carousel_run' | 'explainer_renders' | 'story_sets';
  /** Idea refs (reel post ideas, explainer topics) or Stories series ids to act on. */
  targets: string[];
  note: string;
  /** Rough ceiling for the spend this step starts. */
  estimateUsd: number;
};

export type RunPlan = { today: string; steps: PlanStep[]; estimateUsd: number; anything: boolean };

const label = (v: Vertical) => verticalInfo(v).label;
const n = (x: number, one: string, many = `${one}s`) => `${x} ${x === 1 ? one : many}`;
const titles = (list: Array<{ title: string }>) => list.map((m) => `“${m.title.length > 48 ? `${m.title.slice(0, 47)}…` : m.title}”`).join(', ');

export function planFrom(i: RunInputs): RunPlan {
  const steps: PlanStep[] = [];
  const filled = (v: Vertical, d: TypeDay) => ({ vertical: v, label: label(v), quota: d.quota, held: d.held, needed: d.missing.length });

  {
    const d = i.reels;
    const base = filled('reels', d);
    const missing = d.missing.filter((m) => !i.inFlight.reelsBuilding.includes(m.ref));
    if (d.quota === 0) steps.push({ ...base, action: 'none', targets: [], note: 'Quota is 0.', estimateUsd: 0 });
    else if (i.inFlight.reelsRun) steps.push({ ...base, action: 'none', targets: [], note: 'A reels night is already queued or running.', estimateUsd: 0 });
    else if (!d.slateToday) steps.push({ ...base, needed: d.quota - d.held, action: 'reels_run', targets: [], note: `No slate today yet: runs tonight’s pipeline, which makes up to ${n(d.quota, 'video')}.`, estimateUsd: i.cost.reelsNight });
    else if (!d.missing.length) steps.push({ ...base, action: 'none', targets: [], note: 'Today’s quota is made.', estimateUsd: 0 });
    else if (!missing.length) steps.push({ ...base, action: 'none', targets: [], note: 'Its missing reels are already being made.', estimateUsd: 0 });
    else steps.push({ ...base, action: 'reels_build', targets: missing.map((m) => m.ref), note: `Makes ${titles(missing)}.`, estimateUsd: missing.length * i.cost.reelBuild });
  }

  {
    const d = i.carousels;
    const base = filled('carousels', d);
    const needed = d.quota - d.held;
    if (d.quota === 0) steps.push({ ...base, action: 'none', targets: [], note: 'Quota is 0.', estimateUsd: 0 });
    else if (needed <= 0) steps.push({ ...base, action: 'none', targets: [], note: 'Today’s quota is made.', estimateUsd: 0 });
    else if (i.inFlight.carouselRun) steps.push({ ...base, needed, action: 'none', targets: [], note: 'A carousel run is already queued or running.', estimateUsd: 0 });
    else {
      // The top of today's ranked queue, in order (Promote / Demote applied), as many as the day still needs.
      const queue = d.missing.slice(0, needed);
      if (queue.length) steps.push({ ...base, needed, action: 'carousel_run', targets: queue.map((m) => m.ref), note: `Makes ${titles(queue)}.`, estimateUsd: i.cost.carouselCap });
      // Nothing ranked to name (the pool is empty): the run picks from fresh news, as the 3:00 AM run does.
      else steps.push({ ...base, needed, action: 'carousel_run', targets: [], note: `No ranked story to make, so it runs the carousel pipeline for ${n(needed, 'post')} and picks from fresh news.`, estimateUsd: i.cost.carouselCap });
    }
  }

  {
    const d = i.explainers;
    const base = filled('explainers', d);
    const missing = d.missing.filter((m) => !i.inFlight.explainerTopics.includes(m.ref));
    if (d.quota === 0) steps.push({ ...base, action: 'none', targets: [], note: 'Quota is 0.', estimateUsd: 0 });
    else if (!d.missing.length) steps.push({ ...base, action: 'none', targets: [], note: d.held >= d.quota ? 'Today’s quota is made.' : 'The idea pool is empty.', estimateUsd: 0 });
    else if (!missing.length) steps.push({ ...base, action: 'none', targets: [], note: 'Its missing renders are already being made.', estimateUsd: 0 });
    else steps.push({ ...base, action: 'explainer_renders', targets: missing.map((m) => m.ref), note: `Renders ${titles(missing)}.`, estimateUsd: missing.length * i.cost.explainerCap });
  }

  {
    const missing = i.series.filter((s) => !s.held);
    const base = { vertical: 'stories' as const, label: label('stories'), quota: i.series.length, held: i.series.length - missing.length, needed: missing.length };
    if (!i.series.length) steps.push({ ...base, action: 'none', targets: [], note: 'No series is due today.', estimateUsd: 0 });
    else if (!missing.length) steps.push({ ...base, action: 'none', targets: [], note: 'Every series due today has its set.', estimateUsd: 0 });
    else steps.push({ ...base, action: 'story_sets', targets: missing.map((s) => s.id), note: `Makes ${missing.map((s) => s.label).join(', ')}.`, estimateUsd: missing.length * i.cost.storySet });
  }

  const estimateUsd = Number(steps.reduce((s, x) => s + x.estimateUsd, 0).toFixed(2));
  return { today: i.today, steps, estimateUsd, anything: steps.some((s) => s.action !== 'none') };
}

/**
 * One card's share of a type's step (Make it, 2026-10-13): only that target,
 * with its share of the estimate. A carousel run's cap is per run, so it
 * stays whole. A step with no targets to split (a reels night with no slate,
 * a carousel run picking from fresh news) runs as a whole. A target the plan
 * no longer needs (made meanwhile) is `none`.
 */
export function narrowStep(step: PlanStep, target: string | undefined): PlanStep {
  if (!target || step.action === 'none' || step.targets.length === 0) return step;
  if (!step.targets.includes(target)) return { ...step, action: 'none', targets: [], needed: 0, note: 'Already made or being made.', estimateUsd: 0 };
  const share = step.action === 'carousel_run' ? step.estimateUsd : step.estimateUsd / step.targets.length;
  return { ...step, targets: [target], needed: 1, note: 'Makes this card only.', estimateUsd: Number(share.toFixed(2)) };
}

/** The steps a Run button starts: Content's Run now every step, a type's own button its step, a card's Make it that step narrowed to the card. */
export function stepsFor(plan: RunPlan, only?: Vertical, target?: string): PlanStep[] {
  const steps = only ? plan.steps.filter((s) => s.vertical === only) : plan.steps;
  return only && target ? steps.map((s) => narrowStep(s, target)) : steps;
}

const RUN_TYPES: readonly Vertical[] = ['reels', 'carousels', 'explainers', 'stories'];
const TARGET_MAX = 2048;

/**
 * The run-today POST body. No body is Run now; `{ only }` a type's own button;
 * `{ only, target }` one card's Make it. A target that cannot be honored is an
 * error, never a wider run: Make it must not spend more than its card.
 */
export function parseRunBody(body: unknown): { only?: Vertical; target?: string } | { error: string } {
  if (body === null || body === undefined) return {};
  if (typeof body !== 'object' || Array.isArray(body)) return { error: 'Unknown content type.' };
  const { only, target } = body as { only?: unknown; target?: unknown };
  if (only !== undefined && !RUN_TYPES.includes(only as Vertical)) return { error: 'Unknown content type.' };
  if (target !== undefined) {
    if (only === undefined || typeof target !== 'string' || target.length === 0 || target.length > TARGET_MAX) {
      return { error: 'That card can’t be made from here.' };
    }
    return { only: only as Vertical, target };
  }
  return only === undefined ? {} : { only: only as Vertical };
}

export { ideaRef };

/** One type's day from its quota candidates: held = has content (made, being made, or in its slot). */
export function typeDay(candidates: readonly QuotaCandidate[], quota: number): TypeDay {
  return {
    quota,
    held: candidates.filter((c) => c.post).length,
    missing: candidates.filter((c) => !c.post && c.idea).map((c) => ({ ideaId: c.idea!.id, ref: ideaRef(c.idea!.id), title: c.idea!.title })),
  };
}

export { quotaCandidates };
