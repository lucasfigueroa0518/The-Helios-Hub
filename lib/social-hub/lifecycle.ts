import { hubId } from '@/lib/social-hub/ids';
import type { HubPost, HubStatus, Vertical } from '@/lib/social-hub/types';

/**
 * The hub's lifecycle view (unification Move 7, D46). Each adapter turns its
 * type's spine rows into candidate posts (one per attempt, slot, or piece of
 * content ready to post). This folds them into ONE post per piece of content,
 * in its current state, under a stable id that never changes as the content
 * moves from ready → scheduled → posting → published:
 *
 *   `vertical:<content id>`  carousel post, explainer render, reel video, story set
 *   `reels:idea:<idea id>`   a Trial Reels slot booked before its video exists
 *
 * The candidates' old ids stay on the post as `aliases`, so links made before
 * still open it; the earlier tries (a failed attempt, a cancelled slot) are
 * kept as `tries`.
 */

/** The content a candidate post belongs to, from the refs each adapter sets. */
export function contentKey(post: HubPost): { kind: 'content' | 'idea'; ref: string } | null {
  const r = post.refs;
  switch (post.vertical) {
    case 'carousels':
      return r.postId ? { kind: 'content', ref: r.postId } : null;
    case 'explainers':
      return r.jobId ? { kind: 'content', ref: r.jobId } : null;
    case 'reels':
      if (r.videoJobId) return { kind: 'content', ref: r.videoJobId };
      return r.postIdeaId ? { kind: 'idea', ref: r.postIdeaId } : null;
    case 'stories':
      return r.setId ? { kind: 'content', ref: r.setId } : null;
  }
}

/** Which candidate is the content's current state: live and final states first. */
const RANK: Record<HubStatus, number> = { published: 0, publishing: 1, generating: 1, scheduled: 2, ready: 3, failed: 4, cancelled: 4, skipped: 4 };

const when = (p: HubPost): number => Date.parse(p.postedAt ?? p.publishAt ?? p.generatedAt ?? '') || 0;

function pick(group: HubPost[]): HubPost {
  return [...group].sort((a, b) => RANK[a.status] - RANK[b.status] || when(b) - when(a))[0]!;
}

/** The older ids a candidate's refs stand for (lib/social-hub/ids.ts kinds before D46). */
function legacyIds(vertical: Vertical, group: readonly HubPost[]): string[] {
  const out: string[] = [];
  const add = (kind: Parameters<typeof hubId>[1], ref: string | undefined) => {
    if (!ref) return;
    try {
      out.push(hubId(vertical, kind, ref));
    } catch {
      // Not a ref this vertical makes ids from.
    }
  };
  for (const p of group) {
    add('attempt', p.refs.attemptId);
    add('schedule', p.refs.scheduleId);
    if (vertical === 'carousels') add('post', p.refs.postId);
    if (vertical === 'explainers') add('job', p.refs.jobId);
  }
  return out;
}

export function foldLifecycle(vertical: Vertical, candidates: readonly HubPost[]): HubPost[] {
  const groups = new Map<string, HubPost[]>();
  const loose: HubPost[] = [];
  for (const post of candidates) {
    const key = contentKey(post);
    if (!key) {
      loose.push(post);
      continue;
    }
    const id = hubId(vertical, key.kind, key.ref);
    const list = groups.get(id) ?? [];
    list.push(post);
    groups.set(id, list);
  }
  const out: HubPost[] = [];
  for (const [id, group] of groups) {
    const current = pick(group);
    const tries = group
      .filter((p) => p !== current && (p.status === 'failed' || p.status === 'cancelled' || p.status === 'skipped'))
      .sort((a, b) => when(b) - when(a))
      .map((p) => ({ status: p.status, at: p.postedAt ?? p.publishAt, note: p.statusNote }));
    // Content that is ready again after a failed or cancelled try says why its last try didn't post.
    const statusNote = current.status === 'ready' && tries[0]
      ? `Last try ${tries[0].status === 'failed' ? 'failed' : 'was cancelled'}: ${tries[0].note ?? 'no reason recorded'}`
      : current.statusNote;
    // Refs from every candidate (slot, attempt, content ids) so actions find what they need.
    const refs = Object.assign({}, ...group.map((p) => p.refs), current.refs) as Record<string, string>;
    // Every older id this content was shown under: the folded candidates' ids, and the slot,
    // attempt and content-ready ids it carries (a slot that became an attempt is no longer a row).
    const aliases = [...new Set([...group.map((p) => p.id), ...legacyIds(vertical, group)])].filter((alias) => alias !== id);
    out.push({ ...current, id, statusNote, refs, ...(aliases.length ? { aliases } : {}), ...(tries.length ? { tries } : {}) });
  }
  return [...out, ...loose];
}
