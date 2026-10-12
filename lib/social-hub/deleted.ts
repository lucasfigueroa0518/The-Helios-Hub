import type { HubQuery } from '@/lib/social-hub/db';
import type { HubDataset } from '@/lib/social-hub/dataset';
import { contentKey } from '@/lib/social-hub/lifecycle';
import type { HubIdea, Vertical } from '@/lib/social-hub/types';

/**
 * Deleted posts (lib/social-hub/spine.ts deleteItem). The rows stay in the
 * database; this takes them out of what the hub shows, once, after the
 * dataset is built, so every type is treated alike: the post leaves every
 * list, and the idea it was made for goes back to the pool (its content
 * count drops by what was deleted).
 */

export type DeletedItem = { vertical: Vertical; nativeRef: string; ideaRef: string | null };

/** The idea id each type gives a pool entry (adapters/*.ts), by the item's idea_ref. */
const IDEA_ID: Partial<Record<Vertical, (ref: string) => string>> = {
  carousels: (ref) => `carousels:story:${ref}`,
  explainers: (ref) => `explainers:topic:${ref}`,
  reels: (ref) => `reels:idea:${ref}`,
};

export async function readDeleted(q: HubQuery): Promise<DeletedItem[]> {
  const { rows } = await q<{ vertical: Vertical; native_ref: string; idea_ref: string | null }>(
    `SELECT vertical, native_ref, idea_ref FROM social_hub.content_items WHERE deleted_at IS NOT NULL`,
  );
  return rows.map((r) => ({ vertical: r.vertical, nativeRef: r.native_ref, ideaRef: r.idea_ref }));
}

function reopened(idea: HubIdea, gone: number): HubIdea {
  if (!gone || idea.state === 'published' || idea.state === 'on_deck') return idea;
  const versionCount = Math.max(0, idea.versionCount - gone);
  if (versionCount > 0) return { ...idea, versionCount };
  return { ...idea, versionCount: 0, hasContent: false, state: idea.state === 'content_ready' ? 'idea_only' : idea.state };
}

/** The dataset without deleted posts; ideas whose only content was deleted are open again. */
export function withoutDeleted(dataset: HubDataset, deleted: readonly DeletedItem[]): HubDataset {
  if (!deleted.length) return dataset;
  const gone = new Set(deleted.map((d) => `${d.vertical}:${d.nativeRef}`));
  const posts = dataset.posts.filter((p) => {
    const key = contentKey(p);
    return !(key?.kind === 'content' && gone.has(`${p.vertical}:${key.ref}`));
  });
  if (posts.length === dataset.posts.length) return dataset;
  const perIdea = new Map<string, number>();
  for (const d of deleted) {
    const id = d.ideaRef ? IDEA_ID[d.vertical]?.(d.ideaRef) : null;
    if (id) perIdea.set(id, (perIdea.get(id) ?? 0) + 1);
  }
  return { ...dataset, posts, ideas: dataset.ideas.map((i) => reopened(i, perIdea.get(i.id) ?? 0)) };
}
