'use client';

import { useState } from 'react';

import type { GenerateIdea } from '@/lib/content-type/queue-client';

/**
 * "Generate this now?" (idea pool standard): asked when an idea without content lands in the day's top slots, by
 * a drag or a pin, and when a Generate click meets a daily cap. The Generate click is the person's authorization
 * for that one render (CLAUDE.md Rule 1); "Not now" keeps the move and spends nothing.
 */
export function GenerateConfirm({ generate, ideaId, title, reason, costUsd, onDone }: {
  generate: GenerateIdea;
  ideaId: string;
  title: string;
  /** Why we are asking: a move put it in the top slots, or a cap needs an answer. */
  reason: 'top' | 'click' | 'over_cap';
  /** Typical cost in USD, when known. */
  costUsd?: number | null;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [cap, setCap] = useState<{ message: string; costUsd: number } | null>(reason === 'over_cap' ? { message: 'A daily cap is used up.', costUsd: costUsd ?? 0 } : null);
  const cost = cap?.costUsd ?? costUsd ?? null;
  async function go() {
    setBusy(true);
    const out = await generate(ideaId, cap != null);
    setBusy(false);
    if (out.ok) onDone(); else if (out.ask === 'over_cap') setCap({ message: out.message, costUsd: out.costUsd });
    else setNote(out.message);
  }
  return (
    <div className="rh-genconfirm" role="alertdialog" aria-modal="true" aria-label="Generate this now?">
      <div className="rh-genconfirm__panel">
        <h3 className="rh-genconfirm__title">{cap ? 'Go over the daily cap?' : reason === 'click' ? 'Generate this idea?' : 'Generate this now?'}</h3>
        <p className="rh-genconfirm__text"><strong>{title}</strong></p>
        <p className="rh-muted">
          {cap ? `${cap.message} ` : reason === 'top' ? 'It is in today’s top slots and has nothing made yet. ' : ''}
          Generating makes live model, voice and video calls for this one post{cost ? `, about $${cost.toFixed(2)}` : ''}.
        </p>
        {note ? <p className="rh-run-status is-failed" role="alert">{note}</p> : null}
        <div className="rh-genconfirm__actions">
          <button type="button" className="rh-btn" onClick={onDone} disabled={busy}>Not now</button>
          <button type="button" className="rh-btn rh-btn--primary" onClick={go} disabled={busy}>{busy ? 'Starting…' : cap ? 'Generate anyway' : 'Generate'}</button>
        </div>
      </div>
    </div>
  );
}
