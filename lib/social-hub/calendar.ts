import { formatMetricKey, postMetric } from '@/lib/social-hub/metrics';
import { verticalInfo } from '@/lib/social-hub/verticals';
import type { HubPost, HubStatus, MetricKey } from '@/lib/social-hub/types';

/**
 * Calendar model (spec §4, SH-11): published, scheduled / on deck, failed,
 * cancelled-unapproved and Stories sets. Content with no slot ("ready") has
 * no day and stays in Content House.
 */
export const CALENDAR_STATUSES: readonly HubStatus[] = ['published', 'publishing', 'scheduled', 'failed', 'cancelled', 'skipped'];

export const CHIPS_PER_DAY = 3;

export function postTime(post: HubPost): string | null {
  return post.postedAt ?? post.publishAt;
}

export function onCalendar(post: HubPost): boolean {
  return post.nyDate != null && CALENDAR_STATUSES.includes(post.status);
}

/** Posts per New York day, in time order (no time last). */
export function postsByDay(posts: readonly HubPost[]): Map<string, HubPost[]> {
  const out = new Map<string, HubPost[]>();
  for (const post of posts) {
    if (!onCalendar(post)) continue;
    const list = out.get(post.nyDate!) ?? [];
    list.push(post);
    out.set(post.nyDate!, list);
  }
  for (const list of out.values()) {
    list.sort((a, b) => (postTime(a) ?? '9').localeCompare(postTime(b) ?? '9') || a.id.localeCompare(b.id));
  }
  return out;
}

/** Spec §4 short name: the adapter's name, clipped for a chip. */
export function shortName(post: HubPost, max = 42): string {
  return post.name.length > max ? `${post.name.slice(0, max - 1).trimEnd()}…` : post.name;
}

export function statusLabel(post: HubPost): string {
  switch (post.status) {
    case 'published': return 'Published';
    case 'publishing': return 'Publishing';
    case 'scheduled': return post.approval.required && !post.approval.approvedAt ? 'Scheduled · needs approval' : 'Scheduled';
    case 'failed': return 'Failed';
    case 'cancelled': return post.statusNote ?? 'Cancelled';
    case 'skipped': return 'Skipped';
    case 'ready': return 'Content ready';
  }
}

/** Day view metric line (spec §4): views, shares, saves. Stories have no saves, so reach. */
export function metricLine(post: HubPost): string | null {
  if (post.status !== 'published') return null;
  const keys: MetricKey[] = post.format === 'story' ? ['views', 'reach', 'shares'] : ['views', 'shares', 'saved'];
  const labels: Record<string, string> = { views: 'views', reach: 'reach', shares: 'shares', saved: 'saves' };
  const parts = keys
    .map((key) => ({ key, value: postMetric(post, key) }))
    .filter((p) => p.value != null)
    .map((p) => `${formatMetricKey(p.value, p.key)} ${labels[p.key]}`);
  return parts.length ? parts.join(' · ') : 'No numbers yet';
}

export function chipLabel(post: HubPost): string {
  const info = verticalInfo(post.vertical);
  if (post.vertical === 'stories' && post.media.kind === 'frames') return `${shortName(post, 30)} (${post.media.frames.length})`;
  return `${info.short}: ${shortName(post, 34)}`;
}
