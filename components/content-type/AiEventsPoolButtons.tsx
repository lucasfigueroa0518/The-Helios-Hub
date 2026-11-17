'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { PROGRESS_EVENT } from '@/components/content-type/GenerationProgress';

/**
 * The AI Events pool's own controls (AE-04): Rebuild post, and Clear for a
 * pin left by the retired Pin / Exclude buttons (the shared pool row covers
 * Pin and Archive now). They post to the type's own route
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
 * Clear an event's old pin or exclude (ai_events.pool, set by the retired Pin / Exclude buttons). The pool screen calls
 * it when Unpin is pressed on a row the night still holds as pinned, so such a pin can be seen and removed.
 */
export async function clearOldHold(ideaId: string): Promise<void> {
  await send({ action: 'clear', eventId: eventIdOf(ideaId) });
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
