import { nyDateOf } from '@/lib/social-hub/time';
import { clock, relative, timeLeft, whenInline } from '@/lib/social-hub/views/format';
import type { HubPost } from '@/lib/social-hub/types';
import { lastWindowToday } from '@/lib/social-hub/health/approvals';

/**
 * The lifecycle state a person sees (planning/Social Hub/REDESIGN/MATRICES.md
 * §1). Every screen renders state from here and nowhere else, so a post looks
 * the same in Content, Calendar, Analytics and the drawer.
 */

export type StateId =
  | 'in_production'
  | 'ready'
  | 'needs_you'
  | 'approval_off'
  | 'slot_booked'
  | 'approved'
  | 'scheduled'
  | 'late'
  | 'posting'
  | 'published'
  | 'failed'
  | 'rejected'
  | 'not_approved'
  | 'cancelled'
  | 'skipped';

/** Only Needs you, Late and Failed carry color (DESIGN.md, The Quiet State Rule). */
export type StateTone = 'quiet' | 'needs' | 'failed';

export type StateIcon =
  | 'loader'
  | 'circle-dashed'
  | 'hand'
  | 'clock'
  | 'clock-alert'
  | 'check'
  | 'upload'
  | 'circle-check'
  | 'triangle-alert'
  | 'ban'
  | 'circle-slash'
  | 'skip-forward';

export type PostState = { id: StateId; label: string; tone: StateTone; icon: StateIcon; line: string | null };

const S: Record<StateId, Omit<PostState, 'line'>> = {
  in_production: { id: 'in_production', label: 'In production', tone: 'quiet', icon: 'loader' },
  ready: { id: 'ready', label: 'Ready', tone: 'quiet', icon: 'circle-dashed' },
  needs_you: { id: 'needs_you', label: 'Needs you', tone: 'needs', icon: 'hand' },
  approval_off: { id: 'approval_off', label: 'Approval off', tone: 'quiet', icon: 'hand' },
  slot_booked: { id: 'slot_booked', label: 'Slot booked', tone: 'quiet', icon: 'clock' },
  approved: { id: 'approved', label: 'Approved', tone: 'quiet', icon: 'check' },
  scheduled: { id: 'scheduled', label: 'Scheduled', tone: 'quiet', icon: 'clock' },
  late: { id: 'late', label: 'Late', tone: 'failed', icon: 'clock-alert' },
  posting: { id: 'posting', label: 'Posting', tone: 'quiet', icon: 'upload' },
  published: { id: 'published', label: 'Published', tone: 'quiet', icon: 'circle-check' },
  failed: { id: 'failed', label: 'Failed', tone: 'failed', icon: 'triangle-alert' },
  rejected: { id: 'rejected', label: 'Rejected', tone: 'quiet', icon: 'ban' },
  not_approved: { id: 'not_approved', label: 'Not approved in time', tone: 'quiet', icon: 'circle-slash' },
  cancelled: { id: 'cancelled', label: 'Cancelled', tone: 'quiet', icon: 'circle-slash' },
  skipped: { id: 'skipped', label: 'Skipped', tone: 'quiet', icon: 'skip-forward' },
};

export function stateMeta(id: StateId): Omit<PostState, 'line'> {
  return S[id];
}

/** A Trial Reels slot booked for an idea before its video exists (D39, D46). */
export function isIdeaSlot(post: HubPost): boolean {
  return post.vertical === 'reels' && !post.refs.videoJobId && post.id.startsWith('reels:idea:');
}

function rejectedNote(note: string | null): boolean {
  return note != null && /\brejected\b/i.test(note);
}

/**
 * Rejected, on the post or on its last slot. Carousels keep the rejection on
 * the slot they cancel ("This carousel was rejected, so it was not posted."),
 * not on the post's approval, so the post reads as rejected from its last try.
 */
export function isRejected(post: HubPost): boolean {
  return rejectedNote(post.approval.note) || rejectedNote(post.tries?.[0]?.note ?? null);
}

/** A Stories set built for a day already gone: approving it can't post it (the worker never schedules a past day). */
function pastStorySet(post: HubPost, now: Date): boolean {
  return post.vertical === 'stories' && post.nyDate != null && post.nyDate < nyDateOf(now)!;
}

/**
 * Does this post wait on a person? Scheduled slots not yet approved (and not
 * yet past), plus content in review that approving can still post. The
 * Content House's needsApproval uses this rule, so counts agree everywhere.
 */
export function needsPerson(post: HubPost, now: Date): boolean {
  if (post.status === 'scheduled') {
    return post.approval.required && !post.approval.approvedAt && (post.publishAt ?? '') > now.toISOString();
  }
  if (post.status !== 'ready') return false;
  if (isRejected(post) || pastStorySet(post, now)) return false;
  return !post.approval.approvedAt;
}

/** "within 16 h" while the deadline is under two days off, else "by Sat 7:11 AM". */
function deadline(iso: string | null, now: Date): string {
  if (!iso) return '';
  const ms = Date.parse(iso) - now.getTime();
  return ms > 0 && ms < 48 * 3_600_000 ? `within ${relative(iso, now).replace(/^in /, '')}` : `by ${whenInline(iso, now)}`;
}

/** When a post goes out, without repeating the clock time its row already shows. */
function goesOut(iso: string | null, now: Date): string {
  if (!iso) return '';
  const ms = Date.parse(iso) - now.getTime();
  return ms > 0 && ms < 12 * 3_600_000 ? relative(iso, now) : whenInline(iso, now);
}

/**
 * Needs you, but nothing here can act on it: hub approval for the type is off
 * and it has no review page of its own (MATRICES.md S3b). Quiet, so the orange
 * signal only ever points at something a person can do.
 */
export function approvalOffState(post: HubPost, now: Date): PostState {
  return { ...S.approval_off, line: post.vertical === 'carousels' ? 'Waits here until approving Carousels from the hub is switched on' : 'Approving here is turned off' };
}

function lastTry(post: HubPost): string | null {
  const t = post.tries?.[0];
  if (!t) return null;
  return `Last try ${t.status === 'failed' ? 'failed' : 'didn’t post'}${t.note ? `: ${t.note}` : ''}`;
}

export function postState(post: HubPost, now: Date): PostState {
  switch (post.status) {
    case 'published':
      return { ...S.published, line: post.postedAt ? `Posted ${whenInline(post.postedAt, now)}` : null };
    case 'publishing':
      return { ...S.posting, line: 'Posting now' };
    case 'generating':
      return { ...S.in_production, line: 'Being made' };
    case 'failed':
      // Rejected after it failed: it won't go again (the failed slot stays failed; the rejection rides the approval note).
      if (isRejected(post)) return { ...S.rejected, line: 'Won’t post.' };
      return { ...S.failed, line: post.statusNote ?? 'The post didn’t go out.' };
    case 'skipped':
      return { ...S.skipped, line: 'Missed its window. Story sets aren’t reused.' };
    case 'cancelled':
      if (rejectedNote(post.statusNote) || rejectedNote(post.approval.note)) return { ...S.rejected, line: 'Won’t post.' };
      if (post.statusNote && /approv/i.test(post.statusNote)) {
        return { ...S.not_approved, line: post.publishAt ? `Nobody approved it before its ${clock(post.publishAt)} slot.` : 'Nobody approved it before its slot.' };
      }
      return { ...S.cancelled, line: post.statusNote };
    case 'scheduled': {
      const left = timeLeft(post.publishAt, now);
      if (needsPerson(post, now)) {
        const by = post.publishAt ? `Approve ${deadline(post.publishAt, now)}` : 'Approve to schedule';
        return { ...S.needs_you, line: isIdeaSlot(post) ? `${by} · video renders tonight` : by };
      }
      if (isIdeaSlot(post)) return { ...S.slot_booked, line: `Video renders tonight · posts ${goesOut(post.publishAt, now)}` };
      // Past its slot and still not out: say so plainly, never "Scheduled" (critique 2026-10-08, P1-B).
      if (!left && post.publishAt) return { ...S.late, line: `Was due ${clock(post.publishAt)} and hasn’t gone out yet` };
      return { ...S.scheduled, line: post.publishAt ? `Posts ${goesOut(post.publishAt, now)}` : null };
    }
    case 'ready': {
      if (isRejected(post)) return { ...S.rejected, line: 'Won’t post.' };
      if (pastStorySet(post, now)) return { ...S.ready, line: 'Its day has passed, so approving won’t post it. Publish now still can.' };
      const tried = lastTry(post);
      // The made date tells apart two versions of the same topic (one waiting, one scheduled).
      // Never a made time in the future (a set built for tomorrow can carry tomorrow's date).
      const made = post.generatedAt && post.generatedAt <= now.toISOString() ? `Made ${whenInline(post.generatedAt, now)}` : null;
      if (needsPerson(post, now)) {
        // Today's last window is its deadline (Stories: 10 AM); once it has closed, approving schedules it for another day.
        const end = lastWindowToday(post.vertical, now);
        const ask = end ? `approve by ${clock(end.toISOString())} to post today` : 'approve to schedule it';
        return { ...S.needs_you, line: tried ?? [made, ask].filter(Boolean).join(' · ').replace(/^a/, 'A') };
      }
      if (post.approval.approvedAt) return { ...S.approved, line: tried ?? 'Waiting for the next open slot' };
      return { ...S.ready, line: tried ?? (made ? `${made} · not scheduled` : 'Not scheduled') };
    }
  }
}
