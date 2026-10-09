'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Play, Settings, X } from 'lucide-react';

/**
 * The Content page's two controls: Run now (complete today's runs across
 * every type) and Settings (each type's Live and nightly-run switches).
 * Writes go only to /api/content-type/* (tests/social-hub-scope.test.ts):
 * the posting switches every type page already uses, and Run now.
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
const POSTING = '/api/content-type/posting';
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
  const router = useRouter();
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
      router.refresh();
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
            <button type="button" className="sh-btn sh-btn--primary" disabled={busy} onClick={run}>
              {busy ? 'Starting…' : `Run (up to ${usd(plan.estimateUsd)})`}
            </button>
          ) : null}
        </div>
      </dialog>
    </>
  );
}

// ── Settings ────────────────────────────────────────────────────────────────

type Series = { id: string; label: string; enabled: boolean; generate: boolean; days: number[] };
type Posting = { type: string; live: boolean; generate: boolean | null; autoPublish: boolean; perDay: number | null; maxPerDay: number | null; series: Series[] | null };

const TYPES: Array<{ id: string; label: string; min: number }> = [
  { id: 'reels', label: 'Text on Screen', min: 0 },
  { id: 'carousels', label: 'Carousels', min: 0 },
  { id: 'explainers', label: 'Explainer Reels', min: 1 },
  { id: 'stories', label: 'IG Stories', min: 0 },
];

function Switch({ on, label, hint, onChange, disabled }: { on: boolean; label: string; hint: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`sh-switch${on ? ' is-on' : ''}`} disabled={disabled} onClick={() => onChange(!on)} title={hint}>
      <span className="sh-switch__track" aria-hidden="true"><span className="sh-switch__knob" /></span>
      <span className="sh-switch__text">
        <span>{label}</span>
        <span className="sh-muted">{hint}</span>
      </span>
    </button>
  );
}

export function HubSettingsButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<Record<string, Posting>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const ref = useDialog(open);

  async function load() {
    setError(null);
    try {
      const all = await Promise.all(TYPES.map((t) => getJson<Posting>(`${POSTING}?type=${t.id}`)));
      setState(Object.fromEntries(all.map((p) => [p.type, p])));
    } catch (e) {
      setError(msg(e));
    }
  }

  async function save(type: string, patch: Record<string, unknown>) {
    setSaving(type);
    setError(null);
    try {
      const next = await postJson<Posting>(POSTING, { type, ...patch });
      setState((s) => ({ ...s, [type]: next }));
      router.refresh();
    } catch (e) {
      setError(msg(e));
    } finally {
      setSaving(null);
    }
  }

  function setLive(type: string, label: string, on: boolean) {
    if (on && !window.confirm(`Turn Live on for ${label}? Its content is scheduled into its posting windows and posted to Instagram. Anything that needs approval still waits for it.`)) return;
    void save(type, { live: on });
  }

  function setNightly(type: string, label: string, on: boolean) {
    if (on && !window.confirm(`Run ${label} automatically every night? Each night’s run makes live model calls to fill the day’s quota.`)) return;
    void save(type, { generate: on });
  }

  return (
    <>
      <button type="button" className="sh-btn" onClick={() => { setOpen(true); void load(); }}>
        <Settings size={14} aria-hidden="true" /> Settings
      </button>
      <dialog ref={ref} className="sh-drawer sh-drawer--narrow" aria-labelledby="sh-settings-title" onClose={() => setOpen(false)}>
        <div className="sh-drawer__panel">
          <div className="sh-drawer__bar">
            <h2 id="sh-settings-title" className="sh-title">Content settings</h2>
            <button type="button" className="sh-btn sh-btn--quiet sh-btn--icon" aria-label="Close" onClick={() => setOpen(false)}><X size={16} /></button>
          </div>
          <div className="sh-drawer__body">
            <p className="sh-muted">Live posts a type’s content to Instagram in its windows. The nightly run fills each day’s quota on its own. Posts that need approval always wait for it.</p>
            {error ? <p className="sh-run__error" role="alert">{error}</p> : null}
            {TYPES.map((t) => {
              const p = state[t.id];
              return (
                <section key={t.id} className="sh-setting">
                  <h3 className="sh-setting__title">{t.label}{saving === t.id ? <span className="sh-muted"> · saving…</span> : null}</h3>
                  {!p ? (
                    <p className="sh-muted">{error ? 'Not loaded.' : 'Loading…'}</p>
                  ) : (
                    <>
                      <Switch on={p.live} label="Live" hint={p.live ? 'Scheduling and posting to Instagram.' : 'Off: nothing is scheduled or posted.'} disabled={saving === t.id} onChange={(v) => setLive(t.id, t.label, v)} />
                      {p.generate != null ? (
                        <Switch on={p.generate} label="Nightly run" hint={p.generate ? 'Fills the day’s quota every night.' : 'Off: runs only when you click Run now.'} disabled={saving === t.id} onChange={(v) => setNightly(t.id, t.label, v)} />
                      ) : null}
                      {p.series?.map((s) => (
                        <Switch key={s.id} on={s.generate} label={`${s.label}: nightly`} hint={s.enabled ? `Made at 4:00 AM on its days.` : 'This series is turned off.'} disabled={saving === t.id || !s.enabled}
                          onChange={(v) => { if (!v || window.confirm(`Make ${s.label} automatically at 4:00 AM on its days? Each set makes live model calls.`)) void save(t.id, { series: { id: s.id, generate: v } }); }} />
                      ))}
                      {p.perDay != null && p.maxPerDay != null ? (
                        <div className="sh-setting__quota">
                          <span>Posts per day</span>
                          <div className="segmented" role="group" aria-label={`${t.label} posts per day`}>
                            {Array.from({ length: p.maxPerDay - t.min + 1 }, (_, i) => t.min + i).map((n) => (
                              <button key={n} type="button" className={`segmented__item${p.perDay === n ? ' segmented__item--active' : ''}`} aria-pressed={p.perDay === n} disabled={saving === t.id} onClick={() => void save(t.id, { perDay: n })}>{n}</button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      </dialog>
    </>
  );
}
