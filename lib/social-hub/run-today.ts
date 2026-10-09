/**
 * Run now (the Content page): complete today's runs. Each type's day is
 * filled by its quota candidates (lib/social-hub/views/day-rank.ts): what
 * already holds a slot, then the top of today's ranking with Promote / Demote
 * applied. Run now makes the candidates that have no content yet, the way the
 * type's own buttons would (the person's click approves that spend, rule 1):
 *
 *   Text on Screen   each missing idea on today's slate is built (copy → frame → video);
 *                    with no slate today, a reels night is queued instead
 *   Carousels        a carousel run (it picks its stories from fresh news, so a
 *                    story can't be made on its own; made carousels are kept)
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
    else steps.push({ ...base, needed, action: 'carousel_run', targets: [], note: `Runs the carousel pipeline for ${n(needed, 'post')}. It picks its stories from fresh news.`, estimateUsd: i.cost.carouselCap });
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

/** The native id an idea id ends with (`reels:idea:<id>` → `<id>`). */
export function ideaRef(ideaId: string): string {
  const parts = ideaId.split(':');
  return parts.slice(2).join(':');
}

/** One type's day from its quota candidates: held = has content (made, being made, or in its slot). */
export function typeDay(candidates: readonly QuotaCandidate[], quota: number): TypeDay {
  return {
    quota,
    held: candidates.filter((c) => c.post).length,
    missing: candidates.filter((c) => !c.post && c.idea).map((c) => ({ ideaId: c.idea!.id, ref: ideaRef(c.idea!.id), title: c.idea!.title })),
  };
}

export { quotaCandidates };
