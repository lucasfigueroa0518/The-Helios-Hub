'use client';

import { useCallback, useEffect, useState } from 'react';

import type { LabData, LabPitch } from '@/lib/reel-ai-drama/lab';

import { CALIBRATION_ESTIMATE, draftOf, settingsPayload, type FieldDraft } from './form';

type Tab = 'pool' | 'development' | 'jobs' | 'calibration' | 'settings';
const TABS: [Tab, string][] = [
  ['pool', 'Pool'],
  ['development', 'Development'],
  ['jobs', 'Jobs'],
  ['calibration', 'Calibration'],
  ['settings', 'Settings'],
];

/** §4.8 additions, typed here as the contract pins them so the lab reads them whether or not LabData already has them. */
type LabRequest = {
  id: string;
  kind: 'develop' | 'calibrate';
  status: string;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  requestedBy: string | null;
};
type SettingProblem = { key: string; stored: unknown; error: string };
type LabJob = LabData['jobs'][number] & { cancelRequestedAt?: string | null; verdict?: 'approved' | 'rejected' | null };
type LabView = Omit<LabData, 'jobs' | 'calibration'> & {
  jobs: LabJob[];
  requests?: LabRequest[];
  settingsProblems?: SettingProblem[];
  calibration: { at: string; report: unknown; usd?: number } | null;
};

const POLL_MS = 10_000;
const LIVE_REQUEST = new Set(['requested', 'running']);
const LIVE_JOB = new Set(['queued', 'running']);
const REJECTABLE = new Set(['new', 'pooled', 'picked']);
const REVIVABLE = new Set(['rejected', 'retired', 'killed']);

const usd = (n: number) => `$${n.toFixed(2)}`;
const score = (n: number | null) => (n === null ? '—' : n.toFixed(2));
const when = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

type PostResult = { ok: true; data: unknown } | { ok: false; error: string; fields?: Record<string, string> };

async function post(url: string, body: unknown): Promise<PostResult> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> };
    return res.ok ? { ok: true, data } : { ok: false, error: String(data.error ?? `HTTP ${res.status}`), fields: data.fields };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** The newest request of a kind (requests come newest first). */
const latestOf = (requests: readonly LabRequest[], kind: LabRequest['kind']) => requests.find((r) => r.kind === kind) ?? null;

function RequestChip({ r }: { r: LabRequest | null }) {
  if (!r) return null;
  const label = r.status === 'requested' ? 'queued' : r.status;
  return <span className={`rad-chip ${r.status === 'ok' ? 'ok' : LIVE_REQUEST.has(r.status) ? 'live' : 'bad'}`}>{label}</span>;
}

/**
 * What went wrong, read from the database (so it is still there after a reload): the newest develop and
 * calibrate request when it failed, stored settings that did not parse, and failed or killed jobs.
 */
function Problems({ data }: { data: LabView }) {
  const requests = data.requests ?? [];
  const failedRequests = (['develop', 'calibrate'] as const)
    .map((k) => latestOf(requests, k))
    .filter((r): r is LabRequest => r !== null && r.status === 'failed');
  const problems = data.settingsProblems ?? [];
  // A job a person cancelled is not a problem; every other kill (a story the run gave up on) and every failure is.
  const failedJobs = data.jobs.filter((j) => j.status === 'failed' || (j.status === 'killed' && j.killReason !== 'cancelled by a person')).slice(0, 3);
  if (!failedRequests.length && !problems.length && !failedJobs.length) return null;
  return (
    <section className="rad-card">
      <h2>Problems</h2>
      <ul className="rad-notes">
        {failedRequests.map((r) => (
          <li key={r.id} className="rad-error">
            {r.kind === 'develop' ? 'Development session' : 'Calibration'} failed {when(r.finishedAt ?? r.requestedAt)}: {r.error ?? 'no error text'}
          </li>
        ))}
        {problems.map((p) => (
          <li key={p.key} className="rad-error">
            Setting {p.key}: {p.error} (stored {JSON.stringify(p.stored)}; the default is used)
          </li>
        ))}
        {failedJobs.map((j) => (
          <li key={j.id} className="rad-error">
            {j.title}: {j.killReason ? `killed, ${j.killReason.replace(/_/g, ' ')}` : 'failed'}
            {j.error ? `: ${j.error}` : ''}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Notes({ notes }: { notes: Record<string, string> }) {
  const entries = Object.entries(notes);
  if (!entries.length) return null;
  return (
    <ul className="rad-notes">
      {entries.map(([k, v]) => (
        <li key={k}>
          <b>{k.replace(/_/g, ' ')}:</b> {v}
        </li>
      ))}
    </ul>
  );
}

type PitchActions = { onMake?: (p: LabPitch) => void; onReject?: (p: LabPitch) => void; onRevive?: (p: LabPitch) => void };

function PitchCard({ p, rank, actions, busy }: { p: LabPitch; rank: number | null; actions: PitchActions; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const { onMake, onReject, onRevive } = actions;
  const canMake = onMake && p.status === 'pooled';
  const canReject = onReject && REJECTABLE.has(p.status);
  const canRevive = onRevive && REVIVABLE.has(p.status);
  return (
    <li className="rad-story">
      <button type="button" className="rad-story-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="rad-score">{rank ?? '—'}</span>
        <span className="rad-story-title">
          {p.title}
          <span className="rad-meta">
            {p.centralFigure || 'no central figure'} · {p.storyTypeLabel} · {p.eraLabel} · {p.eventDate ?? 'undated'} · rank {score(p.rankScore)}
          </span>
        </span>
        <span style={{ display: 'flex', gap: 6 }}>
          {p.visuals && <span className={`rad-chip ${p.visuals.grade ?? ''}`}>{p.visuals.grade ?? 'no card'}</span>}
          <span className={`rad-chip ${p.status === 'made' ? 'ok' : p.status === 'picked' ? 'live' : p.status === 'killed' || p.status === 'rejected' ? 'bad' : ''}`}>{p.status}</span>
        </span>
      </button>
      {open && (
        <div className="rad-story-body">
          {p.brief && <p>{p.brief}</p>}
          {p.whyNow && <p className="rad-note">Why now: {p.whyNow}</p>}
          <p className="rad-note">Origin {p.origin}</p>
          <dl className="rad-scores">
            <div>
              <dt>Drama</dt>
              <dd>{score(p.drama.score)}</dd>
            </div>
            <div>
              <dt>Material</dt>
              <dd>{score(p.material.score)}</dd>
            </div>
            <div>
              <dt>Visuals</dt>
              <dd>{p.visuals?.grade ?? '—'}</dd>
            </div>
          </dl>
          <h4>Drama notes</h4>
          <Notes notes={p.drama.notes} />
          <h4>Material notes</h4>
          <Notes notes={p.material.notes} />
          {p.visuals && (
            <>
              <h4>Visuals card</h4>
              <p className="rad-note">
                {p.visuals.specific ?? '—'} story-specific · kinds: {p.visuals.kinds.join(', ') || '—'} · faces:{' '}
                {p.visuals.faces.map((f) => `${f.name} ${f.found ? `✓${f.count}` : '✗'}`).join(', ') || '—'}
              </p>
              {p.visuals.gaps.length > 0 && (
                <ul className="rad-notes">
                  {p.visuals.gaps.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              )}
            </>
          )}
          {p.rejectReason && <p className="rad-error">{p.rejectReason}</p>}
          {p.reviveWhen && <p className="rad-note">Revive when: {p.reviveWhen}</p>}
          {p.sources.length > 0 && (
            <>
              <h4>Sources</h4>
              <ul className="rad-notes">
                {p.sources.map((s, i) => (
                  <li key={i}>
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.title || s.url}
                    </a>{' '}
                    · {s.publisher}
                  </li>
                ))}
              </ul>
            </>
          )}
          {(canMake || canReject || canRevive) && (
            <div className="rad-actions">
              {canMake && (
                <button type="button" className="rad-primary" disabled={busy} onClick={() => onMake(p)}>
                  Make this reel
                </button>
              )}
              {canReject && (
                <button type="button" disabled={busy} onClick={() => onReject(p)}>
                  Reject
                </button>
              )}
              {canRevive && (
                <button type="button" disabled={busy} onClick={() => onRevive(p)}>
                  Revive
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

type SettingsView = { settings: Record<string, unknown>; editable: string[]; problems: SettingProblem[] };

/** Editable keys only, one batch save; each server or local error shows beside its input. */
function SettingsPanel({ onSaved }: { onSaved: (note: string) => void }) {
  const [view, setView] = useState<SettingsView | null>(null);
  const [drafts, setDrafts] = useState<Record<string, FieldDraft>>({});
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/reel-ai-drama/settings', { cache: 'no-store' });
      const body = (await res.json()) as SettingsView & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setView(body);
      setDrafts(Object.fromEntries(body.editable.map((k) => [k, draftOf(body.settings[k])])));
      setFields({});
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!view) return <p className={error ? 'rad-error' : 'rad-note'}>{error ?? 'Loading…'}</p>;

  const set = (key: string, value: FieldDraft) => {
    setDrafts((d) => ({ ...d, [key]: value }));
    setFields((f) => {
      const { [key]: _drop, ...rest } = f;
      return rest;
    });
  };

  const save = async () => {
    const payload = settingsPayload(view.settings, drafts, view.editable);
    if (!payload.ok) {
      setFields(payload.fields);
      setError('Fix the fields marked below. Nothing was saved.');
      return;
    }
    const keys = Object.keys(payload.values);
    if (!keys.length) {
      setError(null);
      onSaved('Nothing changed.');
      return;
    }
    setSaving(true);
    const res = await post('/api/reel-ai-drama/settings', { values: payload.values });
    setSaving(false);
    if (!res.ok) {
      setFields(res.fields ?? {});
      setError(`${res.error} Nothing was saved.`);
      return;
    }
    await load();
    onSaved(`Saved ${keys.join(', ')}.`);
  };

  const problemOf = new Map(view.problems.map((p) => [p.key, p]));
  return (
    <>
      {error && <p className="rad-error">{error}</p>}
      {view.editable.map((key) => {
        const saved = view.settings[key];
        const draft = drafts[key];
        const problem = problemOf.get(key);
        return (
          <div key={key} className="rad-setting">
            <span>{key}</span>
            {typeof saved === 'boolean' ? (
              <label className="rad-toggle">
                <input type="checkbox" checked={draft === true} onChange={(e) => set(key, e.target.checked)} /> {draft === true ? 'on' : 'off'}
              </label>
            ) : key === 'mode' ? (
              <select value={String(draft)} onChange={(e) => set(key, e.target.value)}>
                <option value="development">development</option>
                <option value="production">production</option>
              </select>
            ) : (
              <input
                value={String(draft ?? '')}
                inputMode={typeof saved === 'number' ? 'decimal' : 'text'}
                aria-invalid={fields[key] ? true : undefined}
                onChange={(e) => set(key, e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void save()}
              />
            )}
            {fields[key] && <span className="rad-error">{fields[key]}</span>}
            {problem && <span className="rad-error">Stored value rejected ({problem.error}); using the default.</span>}
          </div>
        );
      })}
      <div className="rad-actions">
        <button type="button" className="rad-primary" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        <button type="button" disabled={saving} onClick={() => void load()}>
          Discard changes
        </button>
      </div>
    </>
  );
}

export function ReelAiDramaLab() {
  const [tab, setTab] = useState<Tab>('pool');
  const [data, setData] = useState<LabView | null>(null);
  /** Only the lab's own load failing, or a click the server refused; run failures come from the data. */
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/reel-ai-drama/lab', { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body as LabView);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const requests = data?.requests ?? [];
  const live = requests.some((r) => LIVE_REQUEST.has(r.status)) || (data?.jobs.some((j) => LIVE_JOB.has(j.status)) ?? false);
  // While a develop/calibrate request (or a job) is live, re-read the lab every 10 s.
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [live, load]);

  const act = async (url: string, body: unknown, ok: (data: unknown) => string) => {
    setBusy(true);
    setNotice(null);
    setError(null);
    const res = await post(url, body);
    setBusy(false);
    if (res.ok) setNotice(ok(res.data));
    else setError(res.error);
    await load();
  };

  const make = (p: LabPitch) => {
    if (!data) return;
    if (!window.confirm(`Make "${p.title}"? The worker runs it, up to ${usd(data.settings.per_reel_cap_usd)}.`)) return;
    void act('/api/reel-ai-drama/make', { pitchId: p.id }, () => 'Queued. The worker picks it up next.');
  };
  const reject = (p: LabPitch) => {
    const note = window.prompt(`Reject "${p.title}"? Optional note:`, '');
    if (note === null) return;
    void act(`/api/reel-ai-drama/pitches/${encodeURIComponent(p.id)}/reject`, note.trim() ? { note: note.trim() } : {}, () => `Rejected "${p.title}".`);
  };
  const revive = (p: LabPitch) => {
    if (!window.confirm(`Revive "${p.title}" back into the pool?`)) return;
    void act(`/api/reel-ai-drama/pitches/${encodeURIComponent(p.id)}/revive`, {}, () => `"${p.title}" is back in the pool.`);
  };
  const cancel = (j: LabJob) => {
    if (!window.confirm(`Cancel "${j.title}"?${j.status === 'running' ? ' It stops at its next stage.' : ''}`)) return;
    void act(`/api/reel-ai-drama/jobs/${encodeURIComponent(j.id)}/cancel`, {}, (d) =>
      (d as { status?: string }).status === 'cancel_requested' ? 'Cancel requested. The job stops at its next stage.' : 'Cancelled.',
    );
  };
  const retry = (j: LabJob) => {
    if (!data) return;
    if (!window.confirm(`Retry "${j.title}"? The worker runs it again, up to ${usd(data.settings.per_reel_cap_usd)}.`)) return;
    void act(`/api/reel-ai-drama/jobs/${encodeURIComponent(j.id)}/retry`, {}, () => 'Queued again. The worker picks it up next.');
  };
  const develop = () => {
    if (!data) return;
    const left = data.costs.devCapUsd - data.costs.devWeekUsd;
    if (!window.confirm(`Run one development session? About $1–3; ${usd(Math.max(0, left))} left of this week's ${usd(data.costs.devCapUsd)}. The worker runs it.`)) return;
    void act('/api/reel-ai-drama/develop', {}, () => 'Queued. The worker runs the development session on its next poll.');
  };
  const calibrate = () => {
    if (!window.confirm(`Run calibration? Jev scores the calibration set, ${CALIBRATION_ESTIMATE}. The worker runs it.`)) return;
    void act('/api/reel-ai-drama/calibrate', {}, () => 'Queued. The worker runs calibration on its next poll.');
  };

  const pooled = data?.pool.filter((p) => p.status === 'pooled') ?? [];
  const rankOf = new Map(pooled.map((p, i) => [p.id, i + 1]));
  const developReq = latestOf(requests, 'develop');
  const calibrateReq = latestOf(requests, 'calibrate');
  const developLive = developReq !== null && LIVE_REQUEST.has(developReq.status);
  const calibrateLive = calibrateReq !== null && LIVE_REQUEST.has(calibrateReq.status);
  const pitchActions: PitchActions = { onMake: make, onReject: reject, onRevive: revive };

  return (
    <main className="rad">
      <header className="rad-head">
        <h1>Reel AI Drama</h1>
        <p className="rad-sub">The ranked pool, development and production. While Generate is on, the night makes the top stories for the day&apos;s slots.</p>
        {data && (
          <div className="rad-bar">
            <span>
              Generate: <b>{data.settings.auto ? 'on' : 'off'}</b> · {data.settings.posts_per_day} a day · up to {data.settings.daily_render_cap} renders a day · mode {data.settings.mode}
            </span>
            <span>
              Development this week: <b>{usd(data.costs.devWeekUsd)}</b> of {usd(data.costs.devCapUsd)}
            </span>
            <span>
              Production this week: <b>{usd(data.costs.productionWeekUsd)}</b> (cap {usd(data.costs.perReelCapUsd)} a reel)
            </span>
          </div>
        )}
      </header>
      {error && <p className="rad-error">{error}</p>}
      {notice && <p className="rad-notice">{notice}</p>}
      {data && <Problems data={data} />}
      <nav className="rad-tabs">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
        <button type="button" onClick={() => void load()} disabled={busy}>
          Refresh
        </button>
      </nav>
      {!data ? (
        <p className="rad-note">Loading…</p>
      ) : tab === 'pool' ? (
        <section className="rad-card">
          <h2>Pool ({pooled.length} ranked)</h2>
          <ul className="rad-list">
            {data.pool.map((p) => (
              <PitchCard key={p.id} p={p} rank={rankOf.get(p.id) ?? null} actions={pitchActions} busy={busy} />
            ))}
          </ul>
          {data.others.length > 0 && (
            <>
              <h4>Dropped, killed and duplicates</h4>
              <ul className="rad-list">
                {data.others.map((p) => (
                  <PitchCard key={p.id} p={p} rank={null} actions={{ onReject: reject, onRevive: revive }} busy={busy} />
                ))}
              </ul>
            </>
          )}
        </section>
      ) : tab === 'development' ? (
        <>
          <section className="rad-card">
            <h2>Development</h2>
            <p className="rad-note">
              {data.ledger.total} cells · {data.ledger.searched} searched · {data.ledger.due} due · {data.ledger.reopened} reopened by news · {data.ledger.pitches} pitches made
            </p>
            <div className="rad-actions">
              <button type="button" className="rad-primary" disabled={busy || developLive || data.costs.devWeekUsd >= data.costs.devCapUsd} onClick={develop}>
                Run a development session (~$1–3)
              </button>
              <RequestChip r={developReq} />
            </div>
            {requests.length > 0 && (
              <>
                <h4>Requests</h4>
                <ul className="rad-list">
                  {requests.map((r) => (
                    <li key={r.id} className="rad-row">
                      <span>
                        {r.kind} · {when(r.requestedAt)}
                        <span className="rad-meta">
                          {r.requestedBy ?? 'unknown'}
                          {r.startedAt ? ` · started ${when(r.startedAt)}` : ''}
                          {r.finishedAt ? ` · finished ${when(r.finishedAt)}` : ''}
                          {r.error ? ` · ${r.error}` : ''}
                        </span>
                      </span>
                      <RequestChip r={r} />
                    </li>
                  ))}
                </ul>
              </>
            )}
            <h4>Sessions</h4>
            <ul className="rad-list">
              {data.sessions.map((s) => (
                <li key={s.id} className="rad-row">
                  <span>
                    {when(s.startedAt)} · {s.trigger}
                    <span className="rad-meta">
                      {s.cellsSearched} cells · {s.pitchesMade} pitches · {s.pitchesPooled} pooled · {usd(s.usd)}
                      {s.error ? ` · ${s.error}` : ''}
                    </span>
                  </span>
                  <span className={`rad-chip ${s.status === 'ok' ? 'ok' : s.status === 'running' ? 'live' : 'bad'}`}>{s.status}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="rad-card">
            <h2>Ledger</h2>
            <div className="rad-scroll">
              <table className="rad-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Type</th>
                    <th>Era</th>
                    <th>Searches</th>
                    <th>Pitches</th>
                    <th>Last searched</th>
                    <th>Due</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ledger.cells.map((c) => (
                    <tr key={c.id}>
                      <td>{c.playerId}</td>
                      <td>{c.storyType}</td>
                      <td>{c.era}</td>
                      <td>{c.searches}</td>
                      <td>{c.pitchesMade}</td>
                      <td>{when(c.lastSearchedAt)}</td>
                      <td>
                        {when(c.dueAt)}
                        {c.reopenReason ? <span className="rad-meta">reopened: {c.reopenReason}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : tab === 'jobs' ? (
        <>
          <section className="rad-card">
            <h2>Jobs</h2>
            <ul className="rad-list">
              {data.jobs.map((j) => (
                <li key={j.id} className="rad-job">
                  <div className="rad-row">
                    <span>
                      {j.title}
                      <span className="rad-meta">
                        {j.trigger} · {when(j.requestedAt)} · stage {j.stage ?? '—'} · {usd(j.spendUsd)} of {usd(j.capUsd)}
                        {j.capped ? ' · capped' : ''}
                        {j.verdict ? ` · ${j.verdict}` : ''}
                      </span>
                    </span>
                    <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {LIVE_JOB.has(j.status) &&
                        (j.cancelRequestedAt ? (
                          <span className="rad-chip live">cancel requested</span>
                        ) : (
                          <button type="button" disabled={busy} onClick={() => cancel(j)}>
                            Cancel
                          </button>
                        ))}
                      {j.status === 'failed' && (
                        <button type="button" disabled={busy} onClick={() => retry(j)}>
                          Retry
                        </button>
                      )}
                      <span className={`rad-chip ${j.status === 'ok' ? 'ok' : LIVE_JOB.has(j.status) ? 'live' : 'bad'}`}>{j.status}</span>
                    </span>
                  </div>
                  {j.killReason && <p className="rad-error">Killed: {j.killReason.replace(/_/g, ' ')}{j.error ? ` — ${j.error}` : ''}</p>}
                  {!j.killReason && j.error && <p className="rad-error">{j.error}</p>}
                  {j.flags.length > 0 && (
                    <ul className="rad-flags">
                      {j.flags.map((f, i) => (
                        <li key={i}>
                          <b>{f.check}</b>: {f.detail}
                        </li>
                      ))}
                    </ul>
                  )}
                  {j.videoId && <video className="rad-video" src={`/api/reel-ai-drama/artifacts/${j.videoId}`} controls preload="metadata" />}
                </li>
              ))}
            </ul>
          </section>
          <section className="rad-card">
            <h2>Deliveries</h2>
            <ul className="rad-list">
              {data.deliveries.map((d) => (
                <li key={d.jobId} className="rad-job">
                  <div className="rad-row">
                    <span>
                      {d.title}
                      <span className="rad-meta">
                        {when(d.finishedAt)} · {usd(d.usd)}
                        {d.seconds ? ` · ${Math.round(d.seconds)}s` : ''}
                        {d.unknownCosts.length ? ` · unpriced: ${d.unknownCosts.join(', ')}` : ''}
                      </span>
                    </span>
                    <span>
                      {d.videoId && <a href={`/api/reel-ai-drama/artifacts/${d.videoId}`}>video</a>}
                      {d.contactSheetId && <> · <a href={`/api/reel-ai-drama/artifacts/${d.contactSheetId}`}>contact sheet</a></>}
                      {d.reportId && <> · <a href={`/api/reel-ai-drama/artifacts/${d.reportId}`}>report</a></>}
                    </span>
                  </div>
                  {d.post && (
                    <div className="rad-pre">
                      {d.post.caption}
                      {'\n\n'}
                      {d.post.question}
                      {'\n\n'}
                      {d.post.credits.join('\n')}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <section className="rad-card">
            <h2>Costs this week</h2>
            <div className="rad-scroll">
              <table className="rad-table">
                <thead>
                  <tr>
                    <th>Mode</th>
                    <th>Vendor</th>
                    <th>Component</th>
                    <th>Calls</th>
                    <th>USD</th>
                  </tr>
                </thead>
                <tbody>
                  {data.costs.byComponent.map((c, i) => (
                    <tr key={i}>
                      <td>{c.mode}</td>
                      <td>{c.vendor}</td>
                      <td>{c.component}</td>
                      <td>{c.calls}</td>
                      <td>{c.known ? usd(c.usd) : `${usd(c.usd)} + unpriced`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : tab === 'calibration' ? (
        <section className="rad-card">
          <h2>Calibration</h2>
          <p className="rad-note">Jev drama and material scores on Lucas&apos;s stories and the near misses; the stories should rank above the near misses.</p>
          <div className="rad-actions">
            <button type="button" className="rad-primary" disabled={busy || calibrateLive} onClick={calibrate}>
              Run calibration ({CALIBRATION_ESTIMATE})
            </button>
            <RequestChip r={calibrateReq} />
          </div>
          {data.calibration ? (
            <>
              <h4>
                Latest report · {when(data.calibration.at)}
                {typeof data.calibration.usd === 'number' ? ` · cost ${usd(data.calibration.usd)}` : ''}
              </h4>
              <CalibrationTable report={data.calibration.report} />
              <details>
                <summary className="rad-note">Raw report</summary>
                <pre className="rad-pre">{JSON.stringify(data.calibration.report, null, 2)}</pre>
              </details>
            </>
          ) : (
            <p className="rad-note">No calibration report yet.</p>
          )}
        </section>
      ) : (
        <section className="rad-card">
          <h2>Settings</h2>
          <SettingsPanel
            onSaved={(note) => {
              setNotice(note);
              void load();
            }}
          />
        </section>
      )}
    </main>
  );
}

type CalibrationRow = {
  id: string;
  title: string;
  verdict: 'make' | 'skip';
  rank: number;
  drama: { score: number; notes: Record<string, string> };
  material: { score: number; notes: Record<string, string> };
};

/** Lucas's calibration set ranked by the drama score; a row is red when it lands on the wrong side of the bar. */
function CalibrationTable({ report }: { report: unknown }) {
  const r = report as { pass?: boolean; dramaBar?: number; items?: CalibrationRow[] } | null;
  if (!r?.items?.length) return <p className="rad-note">The report has no items.</p>;
  const bar = r.dramaBar ?? 0.7;
  const rows = [...r.items].sort((a, b) => a.rank - b.rank);
  const wrong = (row: CalibrationRow) => (row.verdict === 'make' ? row.drama.score < bar : row.drama.score >= bar);
  const misses = rows.filter(wrong).length;
  return (
    <>
      <p className="rad-note">
        {r.pass ? 'Pass' : 'Fail'}: {misses} of {rows.length} on the wrong side of the drama bar ({bar.toFixed(2)}). Your makes
        should sit above it and your skips below.
      </p>
      <div className="rad-scroll">
        <table className="rad-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Your call</th>
              <th>Story</th>
              <th>Drama</th>
              <th>Material</th>
              <th>What the score saw</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const n = row.drama.notes;
              const why = n.cap
                ? `Capped: ${n.cap.replace(/\s*\(MD-\d+\)/, '')}`
                : `want ${n.central_want ?? '?'} · scene ${n.scene ?? '?'} · turn ${n.turn ?? '?'} · implication ${n.implication ?? '?'}`;
              return (
                <tr key={row.id} className={wrong(row) ? 'rad-bad' : undefined}>
                  <td>{row.rank}</td>
                  <td>
                    <span className={`rad-chip ${row.verdict === 'make' ? 'ok' : ''}`}>{row.verdict}</span>
                  </td>
                  <td>{row.title}</td>
                  <td>{row.drama.score.toFixed(2)}</td>
                  <td>{row.material.score.toFixed(2)}</td>
                  <td className="rad-meta">{why}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
