'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { refreshHubPage } from '@/lib/content-type/refresh-client';
import type { Card } from '@/lib/seed/one-box/requests';
import { RUNNER, type SeedVerticalKey } from '@/lib/seed/one-box/types';

/** A stage's words. `checking` is the source match on Vercel; a worker's checks (Trivia, Real or AI?, AI Drama) read WORKER_STAGE_TEXT. */
export const STAGE_TEXT: Readonly<Record<string, string>> = {
  queued: 'Starting…', searching: 'Searching for a source…', reading: 'Reading the sources…', checking: 'Checking the match…', filing: 'Adding it to the queue…',
  claimed: 'Starting…', writing: 'Writing…', making: 'Making the images…',
};
export const WORKER_STAGE_TEXT: Readonly<Record<string, string>> = { ...STAGE_TEXT, checking: 'Checking…' };

export function stageText(c: Pick<Card, 'vertical' | 'stage'>): string {
  const words = RUNNER[c.vertical as SeedVerticalKey] && RUNNER[c.vertical as SeedVerticalKey] !== 'vercel' ? WORKER_STAGE_TEXT : STAGE_TEXT;
  return words[c.stage] ?? 'Working…';
}

/** How often the cards are read again: 3 s while one is genuinely running, 15 s while every working card waits in a worker's queue. */
export function pollEveryMs(cards: readonly Card[]): number | null {
  const working = cards.filter((c) => c.status === 'working');
  if (!working.length) return null;
  return working.some((c) => !c.cancellable) ? 3000 : 15000;
}

/** The one-box state for a pool: its placeholder cards, polled at pollEveryMs while one is working. */
export function useOneBox(vertical: string, skip = false): { cards: Card[]; reload: () => void } {
  const router = useRouter();
  const [state, setState] = useState<{ cards: Card[] }>({ cards: [] });
  const hadWorking = useRef(false);
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/seed/one-box?vertical=${encodeURIComponent(vertical)}`, { cache: 'no-store' });
      if (!res.ok) return;
      const next = (await res.json()) as { cards: Card[] };
      const working = next.cards.some((c) => c.status === 'working');
      // A card that was working and is gone (done) or failed: the queue may have changed, so refresh the page.
      if (hadWorking.current && !working) void refreshHubPage(router);
      hadWorking.current = working;
      setState({ cards: next.cards });
    } catch {
      // Keep what is shown; the next poll or reload tries again.
    }
  }, [vertical, router]);
  useEffect(() => { if (!skip) void load(); }, [load, skip]);
  const every = pollEveryMs(state.cards);
  useEffect(() => {
    if (every == null) return;
    const t = setInterval(() => void load(), every);
    return () => clearInterval(t);
  }, [every, load]);
  return { ...state, reload: () => void load() };
}

/** Placeholder cards for seeds still being found, failed ones with the reason, and done ones that carry a note. */
export function SeedRequestCards({ cards, reload }: { cards: Card[]; reload: () => void }) {
  if (cards.length === 0) return null;
  // DELETE cancels a card still waiting for a worker and dismisses one that has stopped.
  async function remove(id: string) {
    await fetch(`/api/seed/one-box/${id}`, { method: 'DELETE' }).catch(() => undefined);
    reload();
  }
  return (
    <div className="rh rh--scope" aria-live="polite">
      {cards.map((c) => (
        <div key={c.id} className={c.status === 'failed' ? 'rh-note rh-note--bad' : 'rh-note'} role="status">
          <p><strong>{c.status === 'failed' ? 'Not added' : c.status === 'done' ? 'Added' : c.cancellable ? 'Queued' : stageText(c)}</strong> “{c.blurb.length > 120 ? `${c.blurb.slice(0, 120)}…` : c.blurb}”</p>
          {c.message ? <p>{c.message}</p> : null}
          {c.status !== 'working' ? <button type="button" className="rh-btn" onClick={() => void remove(c.id)}>Dismiss</button> : null}
          {c.cancellable ? <button type="button" className="rh-btn" onClick={() => void remove(c.id)}>Cancel</button> : null}
        </div>
      ))}
    </div>
  );
}
