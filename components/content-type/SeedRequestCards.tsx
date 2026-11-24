'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { refreshHubPage } from '@/lib/content-type/refresh-client';
import type { Card } from '@/lib/seed/one-box/requests';

const STAGE_TEXT: Record<string, string> = { queued: 'Starting…', searching: 'Searching for a source…', reading: 'Reading the sources…', checking: 'Checking the match…', filing: 'Adding it to the queue…' };

/** The one-box state for a pool: its placeholder cards. Polls every 3 s while one is working. */
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
  const working = state.cards.some((c) => c.status === 'working');
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [working, load]);
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
          <p><strong>{c.status === 'failed' ? 'Not added' : c.status === 'done' ? 'Added' : STAGE_TEXT[c.stage] ?? 'Working…'}</strong> “{c.blurb.length > 120 ? `${c.blurb.slice(0, 120)}…` : c.blurb}”</p>
          {c.message ? <p>{c.message}</p> : null}
          {c.status !== 'working' ? <button type="button" className="rh-btn" onClick={() => void remove(c.id)}>Dismiss</button> : null}
          {c.cancellable ? <button type="button" className="rh-btn" onClick={() => void remove(c.id)}>Cancel</button> : null}
        </div>
      ))}
    </div>
  );
}
