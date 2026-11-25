'use client';

import { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';

import { useHubRefresh } from '@/components/social-hub/nav/useHubRefresh';

/** Mark the shared hub read stale, then re-render (see POST /api/content-type/progress). */
async function refreshHubPage(refresh: () => void): Promise<void> {
  await fetch('/api/content-type/progress', { method: 'POST' }).catch(() => undefined);
  refresh();
}

/**
 * The Content page's control: Run now (complete today's runs across every
 * type). Its Settings dialog (each type's Live and nightly-run switches) is
 * gone: a type's settings live only in its pool's Settings tab (settings
 * standard D8, D9). Writes go only to /api/content-type/*
 * (tests/social-hub-scope.test.ts).
 */

type Step = { vertical: string; label: string; quota: number; held: number; needed: number; action: string; note: string; estimateUsd: number };
type Plan = { today: string; steps: Step[]; estimateUsd: number; anything: boolean };
type Result = { vertical: string; label: string; ok: boolean; note: string };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

const RUN_TODAY = '/api/content-type/run-today';
const usd = (n: number) => `$${n.toFixed(2)}`;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function useDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return ref;
}

// ── Run now ─────────────────────────────────────────────────────────────────

export function RunTodayButton() {
  const { pending, refresh } = useHubRefresh();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useDialog(open);

  async function start() {
    setOpen(true);
    setPlan(null);
    setResults(null);
    setError(null);
    try {
      setPlan(await getJson<Plan>(RUN_TODAY));
    } catch (e) {
      setError(msg(e));
    }
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const out = await postJson<{ plan: Plan; results: Result[] }>(RUN_TODAY, {});
      setPlan(out.plan);
      setResults(out.results);
      void refreshHubPage(refresh);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="sh-btn sh-btn--primary" onClick={start}>
        <Play size={14} aria-hidden="true" /> Run now
      </button>
      <dialog ref={ref} className="sh-confirm sh-run" aria-labelledby="sh-run-title" onClose={() => setOpen(false)}>
        <h2 id="sh-run-title">Run today</h2>
        {!plan && !error ? <p className="sh-muted">Checking what today still needs…</p> : null}
        {plan ? (
          <>
            <p className="sh-muted">
              {results ? 'Started:' : plan.anything ? 'Runs only the types whose quota isn’t filled yet. Your click approves this spend.' : 'Every type’s quota for today is filled or already being made. Nothing to run.'}
            </p>
            <ul className="sh-run__list">
              {plan.steps.map((s) => {
                const r = results?.find((x) => x.vertical === s.vertical);
                return (
                  <li key={s.vertical} className={`sh-run__row${s.action === 'none' ? ' is-idle' : ''}`}>
                    <span className="sh-run__name">{s.label}</span>
                    <span className="sh-run__count">{s.held} of {s.quota}</span>
                    <span className="sh-run__note">{r ? r.note : s.note}</span>
                    <span className="sh-run__cost">{s.action === 'none' ? '—' : r ? (r.ok ? 'Queued' : 'Not started') : `≤ ${usd(s.estimateUsd)}`}</span>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
        {error ? <p className="sh-run__error" role="alert">{error}</p> : null}
        <div className="sh-confirm__actions">
          <button type="button" className="sh-btn" onClick={() => setOpen(false)}>{results ? 'Done' : 'Cancel'}</button>
          {plan?.anything && !results ? (
            <button type="button" className="sh-btn sh-btn--primary" disabled={busy || pending} onClick={run}>
              {busy || pending ? 'Starting…' : `Run (up to ${usd(plan.estimateUsd)})`}
            </button>
          ) : null}
        </div>
      </dialog>
    </>
  );
}
