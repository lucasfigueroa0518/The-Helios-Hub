'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { PROGRESS_EVENT } from '@/components/content-type/GenerationProgress';

/**
 * Generate on the Field Notes page: queues one run. The click is the approval for that run's live model
 * spend (Claude for the writing, Jev for scoring), capped by the run cap in the settings. The post waits for approval.
 */
export function FieldNotesRunButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function run() {
    if (!confirm('Generate a Field Notes post? It picks one tip, writes the slides with live Claude and Jev calls (capped by the run cap in Settings, $0.50 by default) and renders the carousel on your photos. The post waits for your approval.')) return;
    setBusy(true);
    try {
      const res = await fetch('/api/field-notes/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const json = (await res.json().catch(() => ({}))) as { queued?: boolean; note?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      window.dispatchEvent(new Event(PROGRESS_EVENT));
      setNote(json.queued ? (json.note ?? 'Run queued.') : (json.note ?? 'A run is already queued.'));
      router.refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button type="button" className="rh-btn rh-btn--primary" disabled={busy} onClick={run}>Generate</button>
      {note ? <p className="rh-muted" role="status">{note}</p> : null}
    </div>
  );
}
