'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';

/**
 * Promote / Demote one idea in today's ranking (lib/content-type/idea-rank.ts).
 * Promote makes it next: the night makes one promote per type, oldest first
 * (lib/social-hub/views/moves.ts). Demote sinks it below every other idea.
 * A move lasts until its idea is made.
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
      <button type="button" className="rh-btn rh-rank__btn" disabled={busy} onClick={() => move('promote')} title="Promote: the night makes it next (one a night, oldest first)" aria-label="Promote: make it next">
        <ArrowUp size={13} />{compact ? null : ' Promote'}
      </button>
      <button type="button" className="rh-btn rh-rank__btn" disabled={busy} onClick={() => move('demote')} title="Demote: below every other idea" aria-label="Demote below every other idea">
        <ArrowDown size={13} />{compact ? null : ' Demote'}
      </button>
      {error ? <span className="rh-rank__error" role="alert">{error}</span> : null}
    </span>
  );
}
