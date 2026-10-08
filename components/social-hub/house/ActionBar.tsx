'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import type { ActionFlag } from '@/lib/social-hub/flags';
import type { ActionPlan } from '@/lib/social-hub/house';

/**
 * Content House actions (spec §7). Each button posts to a flagged route that
 * calls one existing pipeline function. While its flag is off the button is
 * disabled and says so; with the flag on, a confirm comes first where the
 * spec asks for one (Hard publish, Hard regenerate with its cost estimate).
 */
export function ActionBar({ plans, enabled }: { plans: ActionPlan[]; enabled: Record<ActionFlag, boolean> }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState<Extract<ActionPlan, { kind: 'post' }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function run(plan: Extract<ActionPlan, { kind: 'post' }>) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(plan.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(plan.body) });
      const out = (await res.json().catch(() => ({}))) as { note?: string };
      setNote(out.note ?? (res.ok ? 'Done.' : `Failed (${res.status}).`));
      if (res.ok) router.refresh();
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }

  if (plans.length === 0) return null;
  return (
    <div className="sh-actions">
      {plans.map((plan) => {
        if (plan.kind === 'link') {
          return <Link key={plan.label} href={plan.href} className="sh-btn" title={plan.note}>{plan.label} ↗</Link>;
        }
        const off = !enabled[plan.action];
        const reason = off ? 'Turned off until Phase 2 (read-only hub).' : plan.disabled;
        return (
          <span key={plan.label} className="sh-actions__item">
            <button
              type="button"
              className={`sh-btn${plan.action === 'hardPublish' || plan.action.startsWith('approve') ? ' sh-btn--primary' : ''}`}
              disabled={Boolean(reason) || busy}
              title={reason ?? undefined}
              aria-describedby={reason ? `why-${plan.action}` : undefined}
              onClick={() => {
                if (plan.confirm) {
                  setPending(plan);
                  dialog.current?.showModal();
                } else void run(plan);
              }}
            >
              {plan.label}
            </button>
            {/* Flag-off is said once by the page banner; real reasons (quota, no content) show here. */}
            {reason ? <span id={`why-${plan.action}`} className={off ? 'sh-sr' : 'sh-subtle'}>{reason}</span> : null}
          </span>
        );
      })}
      {note ? <p className="sh-note" role="status">{note}</p> : null}
      <dialog ref={dialog} className="sh-confirm" aria-label="Confirm action" onClose={() => setPending(null)}>
        <p>{pending?.confirm}</p>
        <div className="sh-actions">
          <button type="button" className="sh-btn" onClick={() => dialog.current?.close()}>Cancel</button>
          <button
            type="button"
            className="sh-btn sh-btn--primary"
            onClick={() => {
              const plan = pending;
              dialog.current?.close();
              if (plan) void run(plan);
            }}
          >
            {pending?.label}
          </button>
        </div>
      </dialog>
    </div>
  );
}
