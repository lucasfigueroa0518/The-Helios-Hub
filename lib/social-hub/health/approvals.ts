import { zonedTime } from '@/lib/instagram/clock';
import { nyDateOf } from '@/lib/social-hub/time';
import type { HubPost, Vertical } from '@/lib/social-hub/types';

/**
 * Approval deadlines for today's lineup (reliability plan #3). The only thing
 * to approve each morning is what the night run made for today (Tommy,
 * 2026-10-14); nothing posts without a person's approval (2026-10-08), so an
 * unapproved post at its deadline is a lost slot.
 */

/** Each type's posting windows, New York (docs/social-overnight.md, the clock). */
export const WINDOWS: Record<Vertical, { first: [number, number]; lastEnd: [number, number] }> = {
  stories: { first: [8, 30], lastEnd: [10, 0] },
  reels: { first: [8, 45], lastEnd: [21, 0] },
  carousels: { first: [9, 0], lastEnd: [15, 30] },
  explainers: { first: [13, 0], lastEnd: [17, 0] },
};

/** When the type's last window closes today; null once it has. Stories: 10 AM, after which a set is never scheduled. */
export function lastWindowToday(vertical: Vertical, now: Date): Date | null {
  const [y, m, d] = nyDateOf(now)!.split('-').map(Number) as [number, number, number];
  const [h, min] = WINDOWS[vertical].lastEnd;
  const end = zonedTime(y, m, d, h, min);
  return end.getTime() > now.getTime() ? end : null;
}

/** Approve by this time or the post misses its slot (scheduled) or today's windows (not yet scheduled). Null: already missed. */
export function approvalDeadline(post: HubPost, now: Date): Date | null {
  if (post.status === 'scheduled' && post.publishAt) return Date.parse(post.publishAt) > now.getTime() ? new Date(post.publishAt) : null;
  return lastWindowToday(post.vertical, now);
}

/** The soonest deadline among `posts` (today's lineup waiting on a person); null when none is still open. */
export function firstDeadline(posts: readonly HubPost[], now: Date): Date | null {
  const open = posts.map((p) => approvalDeadline(p, now)).filter((d): d is Date => d != null);
  return open.length ? new Date(Math.min(...open.map((d) => d.getTime()))) : null;
}

const clock = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(d);

/** The alert as plain lines for a terminal, soonest deadline first. Empty: nothing in today's lineup waits on you. */
export function approvalAlertLines(posts: readonly HubPost[], now: Date, label: (v: Vertical) => string): string[] {
  if (!posts.length) return [];
  const rows = posts
    .map((post) => ({ post, deadline: approvalDeadline(post, now) }))
    .sort((a, b) => (a.deadline?.getTime() ?? 0) - (b.deadline?.getTime() ?? 0));
  const first = firstDeadline(posts, now);
  const lines = [`${posts.length} to approve in today's lineup${first ? `; the first deadline is ${clock(first)}` : ''}.`];
  for (const { post, deadline } of rows) {
    const what = post.status === 'scheduled' ? 'its slot is cancelled' : post.vertical === 'stories' ? 'the set is never scheduled' : "it misses today's windows";
    lines.push(deadline ? `⚠ ${label(post.vertical)} · by ${clock(deadline)} or ${what}: ${post.name.slice(0, 70)}` : `✖ ${label(post.vertical)} · missed: ${post.name.slice(0, 70)}`);
  }
  return lines;
}
