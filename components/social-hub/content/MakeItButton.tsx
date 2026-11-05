'use client';

import { Loader } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { useHubRefresh } from '@/components/social-hub/nav/useHubRefresh';
import { narrowStep, type PlanStep, type RunPlan } from '@/lib/social-hub/run-today';
import type { Vertical } from '@/lib/social-hub/types';

const RUN_TODAY = '/api/content-type/run-today';
const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * Make it (spec D9): one card's run. The plan is read first so the person sees
 * the cost; the server plans again on the click, so a card made meanwhile
 * starts nothing.
 */
export function MakeItButton({ vertical, target }: { vertical: Vertical; target: string | undefined }) {
  const { pending, refresh } = useHubRefresh();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<PlanStep | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function open() {
    setNote(null);
    setBusy(true);
    try {
      const res = await fetch(RUN_TODAY, { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const plan = (await res.json()) as RunPlan;
      const own = plan.steps.find((s) => s.vertical === vertical);
      const narrowed = own ? narrowStep(own, target) : null;
      if (!narrowed || narrowed.action === 'none') {
        setNote({ ok: true, text: narrowed?.note ?? 'Nothing to make for this card.' });
        refresh();
        return;
      }
      setStep(narrowed);
      dialog.current?.showModal();
    } catch {
      setNote({ ok: false, text: 'Couldn’t reach the hub. Try again in a moment.' });
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    dialog.current?.close();
    setBusy(true);
    try {
      const res = await fetch(RUN_TODAY, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ only: vertical, ...(target ? { target } : {}) }) });
      const out = (await res.json().catch(() => ({}))) as { results?: Array<{ ok: boolean; note: string }>; error?: string };
      const r = out.results?.[0];
      setNote(r ? { ok: r.ok, text: r.note } : { ok: res.ok, text: out.error ?? (res.ok ? 'Nothing needed making.' : 'That didn’t work. Try again in a moment.') });
      refresh();
    } catch {
      setNote({ ok: false, text: 'Couldn’t reach the hub. Try again in a moment.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sh-actions sh-actions--card">
      <div className="sh-actions__row">
        <button type="button" className="sh-btn sh-btn--primary" disabled={busy || pending} data-busy={busy || pending ? '' : undefined} onClick={() => void open()}>
          {busy || pending ? <Loader size={14} aria-hidden="true" /> : null}
          Make it
        </button>
      </div>
      {note ? <p className={`sh-actions__note${note.ok ? '' : ' sh-actions__note--failed'}`} role="status">{note.text}</p> : null}
      <dialog ref={dialog} className="sh-confirm" aria-labelledby={titleId} onClose={() => setStep(null)}>
        <h2 id={titleId}>Make it?</h2>
        <p>{step?.note} Up to {usd(step?.estimateUsd ?? 0)}. Your click approves this spend.</p>
        <div className="sh-confirm__actions">
          <button type="button" className="sh-btn" onClick={() => dialog.current?.close()}>Cancel</button>
          <button type="button" className="sh-btn sh-btn--primary" disabled={busy || pending} onClick={() => void run()}>Make it (up to {usd(step?.estimateUsd ?? 0)})</button>
        </div>
      </dialog>
    </div>
  );
}
