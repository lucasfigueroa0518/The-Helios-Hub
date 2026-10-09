import type { HubDataset } from '@/lib/social-hub/dataset';
import { quotaFrom, type Quota } from '@/lib/social-hub/house';
import { addDays, nyDateOf } from '@/lib/social-hub/time';
import { dayPlan, type DayPlan } from '@/lib/social-hub/views/plan';
import { needsPerson } from '@/lib/social-hub/views/state';
import type { HubPost } from '@/lib/social-hub/types';

/**
 * The Content page's model (BRIEFS.md §1): what needs a person, today's
 * lineup by part of day with a "now" line, and content made but not placed.
 * Pure over the dataset, so the fixture preview draws exactly what live data would.
 */

export type NeedsGroup = { id: 'today' | 'tomorrow' | 'later' | 'unplaced' | 'older'; label: string; posts: HubPost[] };

export type LineupBand = {
  id: 'morning' | 'afternoon' | 'evening';
  label: string;
  entries: Array<{ post: HubPost; past: boolean; needsYou: boolean }>;
};

export type ContentModel = {
  today: string;
  needs: NeedsGroup[];
  needsCount: number;
  lineup: LineupBand[];
  /** Index into the flattened lineup where "Now" sits (entries before it are past). */
  nowAfter: string | null;
  unplaced: HubPost[];
  plan: DayPlan;
  quota: Quota;
  next: HubPost | null;
};

/** Content waiting for review longer than this folds into "Older" (REVISIONS C2). */
export const STALE_DAYS = 3;

const at = (p: HubPost) => p.postedAt ?? p.publishAt;
const bySoonest = (a: HubPost, b: HubPost) => (at(a) ?? '9').localeCompare(at(b) ?? '9') || a.id.localeCompare(b.id);

function minuteOfDay(iso: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZone: 'America/New_York' }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

function band(iso: string | null): LineupBand['id'] {
  if (!iso) return 'evening';
  const m = minuteOfDay(iso);
  if (m < 12 * 60) return 'morning';
  if (m < 17 * 60) return 'afternoon';
  return 'evening';
}

const BAND_LABEL: Record<LineupBand['id'], string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };

export function needsGroups(posts: readonly HubPost[], now: Date): NeedsGroup[] {
  const today = nyDateOf(now)!;
  const tomorrow = addDays(today, 1);
  const staleBefore = new Date(now.getTime() - STALE_DAYS * 86_400_000).toISOString();
  const groups: Record<NeedsGroup['id'], HubPost[]> = { today: [], tomorrow: [], later: [], unplaced: [], older: [] };
  for (const post of posts) {
    if (!needsPerson(post, now)) continue;
    if (post.status === 'scheduled' && post.nyDate) {
      groups[post.nyDate === today ? 'today' : post.nyDate === tomorrow ? 'tomorrow' : 'later'].push(post);
    } else if ((post.generatedAt ?? '') < staleBefore) groups.older.push(post);
    else groups.unplaced.push(post);
  }
  const labels: Record<NeedsGroup['id'], string> = { today: 'Today', tomorrow: 'Tomorrow', later: 'Later', unplaced: 'Made, waiting for a slot', older: 'Older' };
  return (Object.keys(groups) as NeedsGroup['id'][])
    .map((id) => ({ id, label: labels[id], posts: groups[id].sort(id === 'unplaced' || id === 'older' ? (a, b) => (b.generatedAt ?? '').localeCompare(a.generatedAt ?? '') : bySoonest) }))
    .filter((g) => g.posts.length > 0);
}

export function contentModel(dataset: HubDataset, now: Date): ContentModel {
  const today = nyDateOf(now)!;
  const nowIso = now.toISOString();
  const needs = needsGroups(dataset.posts, now);
  const todays = dataset.posts.filter((p) => p.nyDate === today && p.status !== 'ready').sort(bySoonest);
  const bands = new Map<LineupBand['id'], LineupBand>();
  let nowAfter: string | null = null;
  for (const post of todays) {
    const id = band(at(post));
    const b = bands.get(id) ?? { id, label: BAND_LABEL[id], entries: [] };
    const past = (at(post) ?? '') <= nowIso;
    if (past) nowAfter = post.id;
    b.entries.push({ post, past, needsYou: needsPerson(post, now) });
    bands.set(id, b);
  }
  const lineup = (['morning', 'afternoon', 'evening'] as const).map((id) => bands.get(id)).filter((b): b is LineupBand => Boolean(b));
  const unplaced = dataset.posts
    .filter((p) => p.status === 'ready' && !needsPerson(p, now) && nyDateOf(p.generatedAt) === today)
    .sort((a, b) => (b.generatedAt ?? '').localeCompare(a.generatedAt ?? ''));
  const next = dataset.posts.filter((p) => (p.status === 'scheduled' || p.status === 'publishing') && (p.publishAt ?? '') > nowIso).sort(bySoonest)[0] ?? null;
  return {
    today,
    needs,
    needsCount: needs.reduce((n, g) => n + g.posts.length, 0),
    lineup,
    nowAfter,
    unplaced,
    plan: dayPlan(dataset.posts, today),
    quota: quotaFrom(dataset.latestQuota, dataset.posts, now),
    next,
  };
}
