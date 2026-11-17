import { dbQuery } from '@/lib/db';
import type { HubDataset } from '@/lib/social-hub/dataset';
import { configFor } from '@/lib/content-type/config';
import { dropKeyBetween, queueOrder, runLead } from '@/lib/social-hub/queue';
import { archiveIdea, pinIdea, placeIdea, reorderPins, unpinIdea } from '@/lib/social-hub/queue-store';
import { ideaOfType } from '@/lib/content-type/story-series';
import type { Vertical } from '@/lib/social-hub/types';
import { isUnscoredSeed } from '@/lib/reels/seeds';

/**
 * One person's move on a type's idea queue (spec 2026-10-21-idea-pool-standard-design):
 * Pin, Unpin, a drag (place), reordering the pins, or Archive. The server works out a
 * drag's key from the neighbours the browser saw, never from a number the browser sends.
 */

const IDEA_ID = /^(reels|carousels|explainers|stories|last_few_days|reel_ai_drama|field_notes|ai_events|ai_trivia|real_or_ai):[A-Za-z_]+:[^\s]{1,2000}$/;

export type QueueAction =
  | { action: 'pin' | 'unpin' | 'archive'; vertical: Vertical; ideaId: string }
  | { action: 'place'; vertical: Vertical; ideaId: string; aboveId: string | null; belowId: string | null; up: boolean }
  | { action: 'reorder-pins'; vertical: Vertical; order: string[] };

export function parseQueueAction(body: unknown): QueueAction {
  const b = (body ?? {}) as Record<string, unknown>;
  // Every type's pool is on the shared queue (lib/content-type/config.ts), so every type takes pins, drags and archives.
  if (typeof b.vertical !== 'string' || !configFor(b.vertical)) throw new Error('Unknown content type.');
  const vertical = b.vertical as Vertical;
  const idea = (v: unknown, what: string) => {
    if (typeof v !== 'string' || !IDEA_ID.test(v) || !ideaOfType(vertical, v)) throw new Error(`Unknown ${what}.`);
    return v;
  };
  const neighbour = (v: unknown) => (v == null ? null : idea(v, 'neighbour'));
  switch (b.action) {
    case 'pin': case 'unpin': case 'archive':
      return { action: b.action, vertical, ideaId: idea(b.ideaId, 'idea') };
    case 'place':
      return { action: 'place', vertical, ideaId: idea(b.ideaId, 'idea'), aboveId: neighbour(b.aboveId), belowId: neighbour(b.belowId), up: b.up === true };
    case 'reorder-pins':
      if (!Array.isArray(b.order) || b.order.length > 200) throw new Error('order must be a list of ideas.');
      return { action: 'reorder-pins', vertical, order: b.order.map((x) => idea(x, 'idea')) };
    default:
      throw new Error('action must be pin, unpin, place, archive or reorder-pins.');
  }
}

/** A drag's key from the queue as the dataset shows it now. A neighbour that is gone counts as the end of the list. */
export function keyFor(dataset: HubDataset, move: Extract<QueueAction, { action: 'place' }>): number {
  const ideas = dataset.ideas.filter((i) => i.vertical === move.vertical);
  const queued = queueOrder(ideas, (dataset.adjustments ?? []).filter((a) => a.vertical === move.vertical), runLead(ideas));
  const effective = (id: string | null) => (id == null ? undefined : queued.find((q) => q.item.id === id && !q.pinned)?.effective);
  return dropKeyBetween(effective(move.aboveId), effective(move.belowId), move.up);
}

export async function recordQueueAction(move: QueueAction, by: string, dataset: HubDataset): Promise<void> {
  const q = (text: string, params?: unknown[]) => dbQuery(text, params as never) as never;
  switch (move.action) {
    case 'pin': {
      // A typed-in Text on Screen idea with no net score cannot be copied onto tonight's slate: say so now, not as "not in the pool" at 1 AM.
      const id = move.vertical === 'reels' ? /^reels:idea:([0-9a-f-]{36})$/.exec(move.ideaId)?.[1] : undefined;
      if (id && (await isUnscoredSeed(id))) throw Object.assign(new Error('No bucket cleared its bar, so the night has nothing to make it from.'), { status: 409 });
      return pinIdea(q, move.vertical, move.ideaId, by);
    }
    case 'unpin': return unpinIdea(q, move.vertical, move.ideaId);
    case 'archive': return archiveIdea(q, move.vertical, move.ideaId, by);
    case 'place': return placeIdea(q, move.vertical, move.ideaId, keyFor(dataset, move), by);
    case 'reorder-pins': return reorderPins(q, move.vertical, move.order, by);
  }
}
