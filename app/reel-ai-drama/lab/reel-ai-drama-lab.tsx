'use client';

import { useCallback, useEffect, useState } from 'react';

import type { LabData, LabPitch } from '@/lib/reel-ai-drama/lab';

type Tab = 'pool' | 'development' | 'jobs' | 'calibration' | 'settings';
const TABS: [Tab, string][] = [
  ['pool', 'Pool'],
  ['development', 'Development'],
  ['jobs', 'Jobs'],
  ['calibration', 'Calibration'],
  ['settings', 'Settings'],
];

const usd = (n: number) => `$${n.toFixed(2)}`;
const score = (n: number | null) => (n === null ? '—' : n.toFixed(2));
const when = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

async function post(url: string, body: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, data } : { ok: false, error: String((data as { error?: string }).error ?? `HTTP ${res.status}`) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
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

function PitchCard({ p, rank, onMake, busy }: { p: LabPitch; rank: number | null; onMake?: (p: LabPitch) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
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
          <span className={`rad-chip ${p.status === 'made' ? 'ok' : p.status === 'picked' ? 'live' : p.status === 'killed' ? 'bad' : ''}`}>{p.status}</span>
        </span>
      </button>
      {open && (
        <div className="rad-story-body">
          <p>
            <b>{p.logline}</b>
          </p>
          {p.pitch && <p>{p.pitch}</p>}
          {p.whyNow && <p className="rad-note">Why now: {p.whyNow}</p>}
          <p className="rad-note">Engine: {p.engine || '—'} · origin {p.origin}</p>
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
          {onMake && p.status === 'pooled' && (
            <div className="rad-actions">
              <button type="button" className="rad-primary" disabled={busy} onClick={() => onMake(p)}>
                Make this reel
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function SettingRow({ name, value, onSave }: { name: string; value: unknown; onSave: (key: string, value: unknown) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  if (typeof value === 'boolean') {
    return (
      <div className="rad-setting">
        <span>{name}</span>
        <label className="rad-toggle">
          <input type="checkbox" checked={value} onChange={(e) => onSave(name, e.target.checked)} /> {value ? 'on' : 'off'}
        </label>
      </div>
    );
  }
  const commit = () => {
    if (draft === String(value)) return;
    onSave(name, typeof value === 'number' ? Number(draft) : draft);
  };
  return (
    <div className="rad-setting">
      <span>{name}</span>
      {name === 'mode' ? (
        <select value={draft} onChange={(e) => onSave(name, e.target.value)}>
          <option value="development">development</option>
          <option value="production">production</option>
        </select>
      ) : (
        <input value={draft} inputMode={typeof value === 'number' ? 'decimal' : 'text'} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
      )}
    </div>
  );
}

export function ReelAiDramaLab() {
  const [tab, setTab] = useState<Tab>('pool');
  const [data, setData] = useState<LabData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/reel-ai-drama/lab', { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body as LabData);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (url: string, body: unknown, ok: (data: unknown) => string) => {
    setBusy(true);
    setNotice(null);
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
  const develop = () => {
    if (!data) return;
    const left = data.costs.devCapUsd - data.costs.devWeekUsd;
    if (!window.confirm(`Run one development session now? About $1–3; ${usd(Math.max(0, left))} left of this week's ${usd(data.costs.devCapUsd)}.`)) return;
    void act('/api/reel-ai-drama/develop', {}, () => 'Development session finished.');
  };
  const calibrate = () => {
    if (!window.confirm('Run calibration now? Jev scores on the calibration set, under $0.01.')) return;
    void act('/api/reel-ai-drama/calibrate', {}, () => 'Calibration finished.');
  };
  const saveSetting = (key: string, value: unknown) => void act('/api/reel-ai-drama/settings', { key, value }, () => `Saved ${key}.`);

  const pooled = data?.pool.filter((p) => p.status === 'pooled') ?? [];
  const rankOf = new Map(pooled.map((p, i) => [p.id, i + 1]));

  return (
    <main className="rad">
      <header className="rad-head">
        <h1>Reel AI Drama</h1>
        <p className="rad-sub">The ranked pool, development and production. The lab ranks; the top stories are made automatically when auto is on.</p>
        {data && (
          <div className="rad-bar">
            <span>
              Auto: <b>{data.settings.auto ? 'on' : 'off'}</b> · {data.settings.per_week} a week · mode {data.settings.mode}
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
              <PitchCard key={p.id} p={p} rank={rankOf.get(p.id) ?? null} onMake={make} busy={busy} />
            ))}
          </ul>
          {data.others.length > 0 && (
            <>
              <h4>Dropped, killed and duplicates</h4>
              <ul className="rad-list">
                {data.others.map((p) => (
                  <PitchCard key={p.id} p={p} rank={null} busy={busy} />
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
              <button type="button" className="rad-primary" disabled={busy || data.costs.devWeekUsd >= data.costs.devCapUsd} onClick={develop}>
                Run a development session (~$1–3)
              </button>
            </div>
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
                      </span>
                    </span>
                    <span className={`rad-chip ${j.status === 'ok' ? 'ok' : j.status === 'running' || j.status === 'queued' ? 'live' : 'bad'}`}>{j.status}</span>
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
            <button type="button" className="rad-primary" disabled={busy} onClick={calibrate}>
              Run calibration (under $0.01)
            </button>
          </div>
          {data.calibration ? (
            <>
              <h4>Latest report · {when(data.calibration.at)}</h4>
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
          {Object.entries(data.settings).map(([k, v]) => (
            <SettingRow key={k} name={k} value={v} onSave={saveSetting} />
          ))}
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
