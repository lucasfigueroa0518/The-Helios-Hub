/**
 * Run now (the Content page): complete today's runs. For each content type,
 * today's quota less what already holds it (placed, posted, made and waiting,
 * or being made) is what is still needed; only a type with something needed
 * is run, and only the way its own Generate / Run now would (the person's
 * click is the approval for that live spend, rule 1):
 *
 *   Text on Screen   queue a reels night (helios-reels makes posts_per_day videos)
 *   Carousels        queue a carousel run (makes quota − placed, capped by the run cap)
 *   Explainers       queue a render for each needed slot, best open pool topic first
 *   Stories          request today's set for each series due today that has none
 *
 * `planFrom` decides from plain inputs (tested offline); `livePlan` reads
 * them and `runToday` re-plans on the server and acts, so a stale page can
 * never run more than today still needs.
 */
import type { HubDataset } from '@/lib/social-hub/dataset';
import { nyDateOf, weekdayOf } from '@/lib/social-hub/time';
import type { Vertical } from '@/lib/social-hub/types';
import { todaysContent } from '@/lib/social-hub/views/today';
import { verticalInfo } from '@/lib/social-hub/verticals';

export type SeriesDue = { id: string; label: string; due: boolean; held: boolean };

export type RunInputs = {
  today: string;
  /** Posts per day each type is set to make (Stories: one per series due today). */
  quota: { reels: number; carousels: number; explainers: number };
  /** What holds today's slots, from Today's Content. */
  held: Record<Vertical, number>;
  inFlight: { reels: boolean; carousels: boolean; explainers: number };
  /** Explainers: open pool topics, best first (topic ids). */
  topics: string[];
  series: SeriesDue[];
  cost: { reelsNight: number; carouselCap: number; explainerCap: number; storySet: number };
};

export type PlanStep = {
  vertical: Vertical;
  label: string;
  quota: number;
  held: number;
  needed: number;
  /** What Run now does for this type. */
  action: 'none' | 'reels_run' | 'carousel_run' | 'explainer_renders' | 'story_sets';
  /** Explainer topic ids or Stories series ids to act on. */
  targets: string[];
  note: string;
  /** Rough ceiling for the spend this step starts. */
  estimateUsd: number;
};

export type RunPlan = { today: string; steps: PlanStep[]; estimateUsd: number; anything: boolean };

const label = (v: Vertical) => verticalInfo(v).label;
const n = (x: number, one: string, many = `${one}s`) => `${x} ${x === 1 ? one : many}`;

export function planFrom(i: RunInputs): RunPlan {
  const steps: PlanStep[] = [];

  {
    const quota = i.quota.reels;
    const held = Math.min(i.held.reels, quota);
    const needed = Math.max(0, quota - held);
    const base = { vertical: 'reels' as const, label: label('reels'), quota, held, needed, targets: [] };
    if (needed === 0) steps.push({ ...base, action: 'none', note: quota === 0 ? 'Quota is 0.' : 'Today’s quota is filled.', estimateUsd: 0 });
    else if (i.inFlight.reels) steps.push({ ...base, action: 'none', note: 'A run is already queued or running.', estimateUsd: 0 });
    else steps.push({ ...base, action: 'reels_run', note: `Runs tonight’s pipeline again: makes up to ${n(quota, 'video')}.`, estimateUsd: i.cost.reelsNight });
  }

  {
    const quota = i.quota.carousels;
    const held = Math.min(i.held.carousels, quota);
    const needed = Math.max(0, quota - held);
    const base = { vertical: 'carousels' as const, label: label('carousels'), quota, held, needed, targets: [] };
    if (needed === 0) steps.push({ ...base, action: 'none', note: quota === 0 ? 'Quota is 0.' : 'Today’s quota is filled.', estimateUsd: 0 });
    else if (i.inFlight.carousels) steps.push({ ...base, action: 'none', note: 'A run is already queued or running.', estimateUsd: 0 });
    else steps.push({ ...base, action: 'carousel_run', note: `Runs the carousel pipeline for ${n(needed, 'post')}.`, estimateUsd: i.cost.carouselCap });
  }

  {
    const quota = i.quota.explainers;
    const held = Math.min(i.held.explainers + i.inFlight.explainers, quota);
    const needed = Math.max(0, quota - held);
    const targets = i.topics.slice(0, needed);
    const base = { vertical: 'explainers' as const, label: label('explainers'), quota, held, needed };
    if (needed === 0) steps.push({ ...base, targets: [], action: 'none', note: quota === 0 ? 'Quota is 0.' : 'Today’s quota is filled.', estimateUsd: 0 });
    else if (!targets.length) steps.push({ ...base, targets: [], action: 'none', note: 'The idea pool is empty.', estimateUsd: 0 });
    else steps.push({ ...base, targets, action: 'explainer_renders', note: `Renders the top ${n(targets.length, 'pool topic')}.`, estimateUsd: targets.length * i.cost.explainerCap });
  }

  {
    const due = i.series.filter((s) => s.due);
    const missing = due.filter((s) => !s.held);
    const base = { vertical: 'stories' as const, label: label('stories'), quota: due.length, held: due.length - missing.length, needed: missing.length };
    if (!due.length) steps.push({ ...base, targets: [], action: 'none', note: 'No series is due today.', estimateUsd: 0 });
    else if (!missing.length) steps.push({ ...base, targets: [], action: 'none', note: 'Every series due today has its set.', estimateUsd: 0 });
    else steps.push({ ...base, targets: missing.map((s) => s.id), action: 'story_sets', note: `Makes ${missing.map((s) => s.label).join(', ')}.`, estimateUsd: missing.length * i.cost.storySet });
  }

  const estimateUsd = Number(steps.reduce((s, x) => s + x.estimateUsd, 0).toFixed(2));
  return { today: i.today, steps, estimateUsd, anything: steps.some((s) => s.action !== 'none') };
}

/** How many of today's quota candidates each type already has (Today's Content, never generating-only for explainers: their jobs count as in flight). */
export function heldToday(dataset: Pick<HubDataset, 'posts'>, now: Date): Record<Vertical, number> {
  const held: Record<Vertical, number> = { reels: 0, carousels: 0, explainers: 0, stories: 0 };
  for (const p of todaysContent(dataset.posts, now)) {
    if (p.vertical === 'explainers' && p.status === 'generating') continue;
    held[p.vertical] += 1;
  }
  return held;
}

/** Series due today by their weekday settings. */
export function seriesDue(today: string, series: Array<{ id: string; label: string; enabled: boolean; days: number[] }>, heldIds: ReadonlySet<string>): SeriesDue[] {
  const day = weekdayOf(today);
  return series.map((s) => ({ id: s.id, label: s.label, due: s.enabled && s.days.includes(day), held: heldIds.has(s.id) }));
}

export const todayNy = (now: Date) => nyDateOf(now)!;
