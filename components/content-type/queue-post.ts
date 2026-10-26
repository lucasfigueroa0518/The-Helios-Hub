'use client';

/**
 * The idea queue's one browser-side write (idea pool standard, 2026-10-21): a move on the queue, posted to its own route
 * (app/api/content-type/idea-queue). A hub control (tests/social-hub-scope.test.ts): the page's read code reaches the
 * network only through the controls it names.
 */

export type QueueBody =
  | { vertical: string; action: 'pin' | 'unpin' | 'archive'; ideaId: string }
  | { vertical: string; action: 'place'; ideaId: string; aboveId: string | null; belowId: string | null; up: boolean }
  | { vertical: string; action: 'reorder-pins'; order: string[] };

export async function postQueue(body: QueueBody): Promise<void> {
  const res = await fetch('/api/content-type/idea-queue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
}
