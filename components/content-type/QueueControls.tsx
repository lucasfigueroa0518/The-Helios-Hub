'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Archive, Pin, PinOff } from 'lucide-react';

import { postQueue } from '@/components/content-type/queue-post';

/**
 * Pin / Unpin and Archive for one idea (idea pool standard). Pin puts it at the top of the queue until it is made;
 * Archive hides it for good (a soft delete: kept, never brought back by a refill).
 */
export function QueueControls({ vertical, ideaId, pinned, title, compact = false, buttonClass = 'rh-btn rh-rank__btn', onPinned }: {
  vertical: string;
  ideaId: string;
  pinned: boolean;
  title: string;
  compact?: boolean;
  /** The page's own button class (the Social Hub pages use `sh-btn`). */
  buttonClass?: string;
  /** Called after a pin lands, so the page can ask about generating an idea that has nothing made yet. */
  onPinned?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: 'pin' | 'unpin' | 'archive') {
    if (action === 'archive' && !confirm(`Archive "${title}"? It leaves the pool and is not brought back. (It is kept, not deleted.)`)) return;
    setBusy(true);
    setError(null);
    try {
      await postQueue({ vertical, action, ideaId });
      if (action === 'pin') onPinned?.();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="rh-rank" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button type="button" className={buttonClass} disabled={busy} onClick={() => run(pinned ? 'unpin' : 'pin')} title={pinned ? 'Unpin: back to its place by score' : 'Pin: top of the queue until it is made'} aria-label={pinned ? 'Unpin' : 'Pin to the top of the queue'}>
        {pinned ? <PinOff size={13} /> : <Pin size={13} />}{compact ? null : pinned ? ' Unpin' : ' Pin'}
      </button>
      <button type="button" className={buttonClass} disabled={busy} onClick={() => run('archive')} title="Archive: hide it for good" aria-label="Archive">
        <Archive size={13} />{compact ? null : ' Archive'}
      </button>
      {error ? <span className="rh-rank__error" role="alert">{error}</span> : null}
    </span>
  );
}
