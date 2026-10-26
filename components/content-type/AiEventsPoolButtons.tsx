'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Ban, Pin, RefreshCw, X } from 'lucide-react';

import { PROGRESS_EVENT } from '@/components/content-type/GenerationProgress';

/**
 * The AI Events pool's controls (AE-04): Pin, Exclude and Clear on one event
 * of the coming week, and Rebuild post. They post to the type's own route
 * (/api/ai-events/pool), which writes only the pin and exclude columns of
 * ai_events.pool or queues a rebuild; the social worker re-renders the post
 * from the scores it already has. No model call from any of them.
 * Listed as a hub control in tests/social-hub-scope.test.ts: every fetch
 * here goes to /api/ai-events/pool or /api/content-type/progress.
 */

const POOL_ENDPOINT = '/api/ai-events/pool';

/** Mark the shared hub read stale, then re-render (see POST /api/content-type/progress). */
async function refreshHubPage(router: { refresh: () => void }): Promise<void> {
  await fetch('/api/content-type/progress', { method: 'POST' }).catch(() => undefined);
  router.refresh();
}

async function send(body: Record<string, unknown>): Promise<string> {
  const res = await fetch(POOL_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { note?: string; error?: string };
  if (!res.ok) throw new Error(json.note ?? json.error ?? `Request failed (${res.status})`);
  return json.note ?? 'Saved.';
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The event id behind a pool idea (`ai_events:event:<uuid>`). */
export const eventIdOf = (ideaId: string): string => ideaId.replace(/^ai_events:event:/, '');

/**
 * Pin / Exclude / Clear on one bench row. `hold` is the event's current pin
 * or exclude. `editable` is false once the shown week's post is out (the
 * buttons only change the coming week).
 */
export function PoolButtons({ ideaId, hold, editable, compact = false }: { ideaId: string; hold: 'pinned' | 'excluded' | null | undefined; editable: boolean; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function act(action: 'pin' | 'exclude' | 'clear') {
    setBusy(true);
    setNote(null);
    try {
      setNote(await send({ action, eventId: eventIdOf(ideaId) }));
      void refreshHubPage(router);
    } catch (e) {
      setNote(msg(e));
    } finally {
      setBusy(false);
    }
  }
  if (!editable) return null;
  return (
    <span className="rh-rank ae-pool__buttons" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {hold !== 'pinned' ? (
        <button type="button" className="rh-btn rh-rank__btn" disabled={busy} onClick={() => act('pin')} title="Pin: it goes into its city on the next build or Rebuild post" aria-label="Pin into its city">
          <Pin size={13} />{compact ? null : ' Pin'}
        </button>
      ) : null}
      {hold !== 'excluded' ? (
        <button type="button" className="rh-btn rh-rank__btn" disabled={busy} onClick={() => act('exclude')} title="Exclude: it stays out of the post" aria-label="Exclude from the post">
          <Ban size={13} />{compact ? null : ' Exclude'}
        </button>
      ) : null}
      {hold ? (
        <button type="button" className="rh-btn rh-rank__btn" disabled={busy} onClick={() => act('clear')} title="Clear: the ranking decides again" aria-label={`Clear the ${hold === 'pinned' ? 'pin' : 'exclude'}`}>
          <X size={13} />{compact ? null : ' Clear'}
        </button>
      ) : null}
      {note ? <span className={compact ? 'rh-rank__error' : 'rh-muted'} role="status">{note}</span> : null}
    </span>
  );
}

/** Rebuild post: re-render the coming week's post from the pool with today's pins and excludes. */
export function RebuildPostButton({ disabled = null }: { disabled?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function rebuild() {
    if (!confirm('Rebuild this week’s Miami and Boston posts? They are re-ranked from the pool with your pins and excludes, from the scores they already have (no model spend). Each keeps its look, approval and slot.')) return;
    setBusy(true);
    try {
      setNote(await send({ action: 'rebuild' }));
      window.dispatchEvent(new Event(PROGRESS_EVENT));
      void refreshHubPage(router);
    } catch (e) {
      setNote(msg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button type="button" className="rh-btn" disabled={busy || Boolean(disabled)} title={disabled ?? undefined} onClick={rebuild}>
        <RefreshCw size={15} /> Rebuild post
      </button>
      {note ? <p className="rh-muted" role="status">{note}</p> : null}
    </div>
  );
}
