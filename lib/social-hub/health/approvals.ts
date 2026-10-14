import { zonedTime } from '@/lib/instagram/clock';
import type { HubPost, Vertical } from '@/lib/social-hub/types';

/**
 * The 8 AM approval-deadline alert (reliability plan #3): everything made but
 * not approved, each with the time it must be approved by. Nothing posts
 * without a person's approval (Tommy, 2026-10-08), so an unapproved post at
 * its deadline is a lost slot.
 */

/** Each type's posting windows today, New York (docs/social-overnight.md, the clock). */
export const WINDOWS: Record<Vertical, { first: [number, number]; lastEnd: [number, number] }> = {
  stories: { first: [8, 30], lastEnd: [10, 0] },
  reels: { first: [8, 45], lastEnd: [21, 0] },
  carousels: { first: [9, 0], lastEnd: [15, 30] },
  explainers: { first: [13, 0], lastEnd: [17, 0] },
};

export type ApprovalDue = {
  post: HubPost;
  /** Approve by this time or the post misses its slot (or today's windows). */
  deadline: Date;
  /** What happens at the deadline, in words. */
  consequence: string;
  overdue: boolean;
};

const at = (nyDate: string, [h, m]: [number, number]) => {
  const [y, mo, d] = nyDate.split('-').map(Number) as [number, number, number];
  return zonedTime(y, mo, d, h, m);
};

/**
 * What is waiting on an approval today: ready, or scheduled today without an
 * approval, that the hub marks as needing a person (overnight_check.ts's rule).
 * A scheduled post from another day is not today's deadline.
 */
export function waitingForApproval(posts: readonly HubPost[], needsYou: (p: HubPost) => boolean, today: string): HubPost[] {
  return posts.filter((p) => (p.status === 'ready' || (p.status === 'scheduled' && !p.approval.approvedAt && p.nyDate === today)) && needsYou(p));
}

/**
 * `waiting` is what the hub already marks as needing approval (overnight_check's
 * rule: ready, or scheduled without an approval, whose offer tone is 'needs').
 * A scheduled post's deadline is its slot; an unscheduled one's is the end of
 * its type's last window today (Stories: 10 AM, after which a set is never scheduled).
 */
export function approvalsDue(waiting: readonly HubPost[], today: string, now: Date): ApprovalDue[] {
  return waiting
    .map((post): ApprovalDue => {
      const slot = post.status === 'scheduled' && post.publishAt ? new Date(post.publishAt) : null;
      const deadline = slot ?? at(today, WINDOWS[post.vertical].lastEnd);
      const consequence = slot
        ? 'its slot is cancelled'
        : post.vertical === 'stories'
          ? 'the set is never scheduled'
          : "it misses today's windows";
      return { post, deadline, consequence, overdue: deadline.getTime() <= now.getTime() };
    })
    .sort((a, b) => a.deadline.getTime() - b.deadline.getTime());
}

const clock = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(d);

/** The alert as plain lines (a terminal, an email body or a push notification). Empty: nothing is waiting. */
export function approvalAlertLines(due: readonly ApprovalDue[], label: (v: Vertical) => string): string[] {
  if (!due.length) return [];
  const open = due.filter((d) => !d.overdue);
  const lines = [`${due.length} post${due.length === 1 ? '' : 's'} waiting for approval${open.length ? `; the first deadline is ${clock(open[0]!.deadline)}` : ''}.`];
  for (const d of due) {
    const when = d.overdue ? `missed ${clock(d.deadline)}` : `by ${clock(d.deadline)}`;
    lines.push(`${d.overdue ? '✖' : '⚠'} ${label(d.post.vertical)} · ${when} or ${d.consequence}: ${d.post.name.slice(0, 70)}`);
  }
  return lines;
}
