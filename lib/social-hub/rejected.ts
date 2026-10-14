import type { HubQuery } from '@/lib/social-hub/db';
import type { HubDataset } from '@/lib/social-hub/dataset';
import { contentKey } from '@/lib/social-hub/lifecycle';
import type { Vertical } from '@/lib/social-hub/types';

/**
 * Rejected after it failed. Reject cancels only a waiting slot, so a failed
 * slot or attempt stays `failed` and nothing on the post says it was rejected.
 * The decision lives on the spine's approvals; this reads it (SELECT only) and
 * stamps "Rejected" on the approval note of failed posts, so the card reads
 * Rejected ("Won’t post.") and offers no Try again, Reschedule or Reject.
 */

export type RejectedItem = { vertical: Vertical; nativeRef: string };

export async function readRejected(q: HubQuery): Promise<RejectedItem[]> {
  const { rows } = await q<{ vertical: Vertical; native_ref: string }>(
    `SELECT ci.vertical, ci.native_ref FROM social_hub.approvals ap
       JOIN social_hub.content_items ci ON ci.id = ap.content_item_id
      WHERE ap.decision = 'rejected'`,
  );
  return rows.map((r) => ({ vertical: r.vertical, nativeRef: r.native_ref }));
}

export function withRejections(dataset: HubDataset, rejected: readonly RejectedItem[]): HubDataset {
  if (!rejected.length) return dataset;
  const set = new Set(rejected.map((r) => `${r.vertical}:${r.nativeRef}`));
  let changed = false;
  const posts = dataset.posts.map((p) => {
    if (p.status !== 'failed') return p;
    const key = contentKey(p);
    if (key?.kind !== 'content' || !set.has(`${p.vertical}:${key.ref}`)) return p;
    changed = true;
    return { ...p, approval: { ...p.approval, note: 'Rejected' } };
  });
  return changed ? { ...dataset, posts } : dataset;
}
