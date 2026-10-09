'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';

/**
 * Promote / Demote one idea in today's ranking (lib/content-type/idea-rank.ts).
 * Promote makes it #1 for today; Demote moves it below the idea right under
 * it. Today's quota goes to the top of the ranking, so this decides what
 * today's content is. Moves expire with the day.
 */
export function RankButtons({ vertical, ideaId, compact = false }: { vertical: string; ideaId: string; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function move(kind: 'promote' | 'demote') {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/content-type/idea-rank', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vertical, ideaId, kind }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="rh-rank" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button type="button" className="rh-btn rh-rank__btn" disabled={busy} onClick={() => move('promote')} title="Promote: #1 for today" aria-label="Promote to #1 for today">
        <ArrowUp size={13} />{compact ? null : ' Promote'}
      </button>
      <button type="button" className="rh-btn rh-rank__btn" disabled={busy} onClick={() => move('demote')} title="Demote: below the next idea, for today" aria-label="Demote one place for today">
        <ArrowDown size={13} />{compact ? null : ' Demote'}
      </button>
      {error ? <span className="rh-rank__error" role="alert">{error}</span> : null}
    </span>
  );
}
