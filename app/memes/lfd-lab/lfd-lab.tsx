'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ReviewSlider } from '../lab/meme-lab';

type Sim = {
  id: string; asOf: string; replay: boolean; status: string; stage: string | null; costUsd: number; error: string | null;
  requestedAt: string; stories: number; memesPlaced: number; graded: boolean;
};
type SimMeme = {
  id: string; rank: number; templateName: string; hasImage: boolean; rating: number | null; note: string | null;
  faults: { count: number; flagged: Array<{ id: string; label: string }> } | null;
};
type SimStory = {
  key: string; origIndex: number; headline: string; gated: boolean;
  tags: { irony?: boolean; launch?: boolean; numberStory?: boolean; conflict?: boolean; shortHeadline?: boolean; headlineChars?: number } | null;
  odds: { p: number; why: string; passes: boolean } | null;
  picker: { memeId: string | null; rank: number | null; reason: string } | null;
  requestId: string | null; requestStatus: string | null; memes: SimMeme[];
};
type PostSide = { slides: string[]; caption: string; problems?: string[]; renderProblems?: string[]; fitProblems?: string[] } | null;
type Placed = { key: string; memeId: string; rank: number; origIndex: number; role: 'cover' | 'slide'; position: number };
type SimDetail = {
  id: string; asOf: string; replay: boolean; status: string; stage: string | null; costUsd: number; error: string | null;
  record: { gate?: { threshold: number; evidence: number } } & Record<string, unknown>;
  original: PostSide; final: PostSide; placement: { placed: Placed[]; cover: { kind: string }; order?: string[] } | null;
  stories: SimStory[]; grade: { rating: number | null; note: string | null } | null;
  report: { startedAt: string | null; finishedAt: string | null; serverNow: string; events: SimEvent[] };
};
type SimEvent = { id: string; at: string; stage: string; message: string; count: number; usd: number | null };
type Tally = { good: number; n: number };
type Stats = {
  regime: string; taggerVersion: string; stories: number; base: Tally;
  factors: Array<{ factor: string; with: Tally; without: Tally }>;
  cells: Array<{ tension: boolean; numberStory: boolean; shortHeadline: boolean; good: number; n: number; p: number; passes: boolean; needs: number; pending: number }>;
  settings: { gateThreshold: number };
  minCellN: number;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

const pct = (x: number) => `${Math.round(100 * x)}%`;
const rate = (t: Tally) => (t.n ? `${t.good}/${t.n} (${pct(t.good / t.n)})` : '–');
const money = (x: number) => `$${x.toFixed(2)}`;
const STAGES: Record<string, string> = { lfd: 'Running Last Few Days', tags: 'Tagging stories', gate: 'Checking the gate', briefs: 'Writing briefs', memes: 'Making memes', faults: 'Scoring faults', render: 'Rendering the post' };
const FACTOR_LABELS: Record<string, string> = { irony: 'Built-in irony', launch: 'Product launch', tension: 'Irony or a launch', numberStory: 'The point is a number', shortHeadline: 'Headline ≤ 70 characters', conflict: 'Two parties in conflict' };
const live = (s: { status: string }) => s.status === 'requested' || s.status === 'running';

export function LfdLab() {
  const [tab, setTab] = useState<'sims' | 'stats'>('sims');
  const [sims, setSims] = useState<Sim[]>([]);
  const [estimate, setEstimate] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SimDetail | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadSims = useCallback(async () => {
    const r = await api<{ sims: Sim[]; estimateUsd: number }>('/api/memes/lfd-sims');
    setSims(r.sims);
    setEstimate(r.estimateUsd);
    setOpenId((cur) => cur ?? r.sims[0]?.id ?? null);
  }, []);
  const loadDetail = useCallback(async (id: string) => setDetail(await api<SimDetail>(`/api/memes/lfd-sims/${id}`)), []);

  useEffect(() => {
    loadSims().catch((e) => setErr(String(e)));
  }, [loadSims]);
  useEffect(() => {
    if (openId) loadDetail(openId).catch((e) => setErr(String(e)));
  }, [openId, loadDetail]);
  useEffect(() => {
    if (!detail || !live(detail)) return;
    const t = setInterval(() => {
      loadDetail(detail.id).catch(() => undefined);
      loadSims().catch(() => undefined);
    }, 2000);
    return () => clearInterval(t);
  }, [detail, loadDetail, loadSims]);

  const anyLive = sims.some(live);
  return (
    <main className="ml lfd">
      <header className="lfd-top">
        <div className="lfd-top-title">
          <h1>Last Few Days lab</h1>
          <a href="/memes/lab">Meme lab</a>
        </div>
        <div className="ml-tabs lfd-top-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'sims'} className={tab === 'sims' ? 'on' : ''} onClick={() => setTab('sims')}>Simulations</button>
          <button type="button" role="tab" aria-selected={tab === 'stats'} className={tab === 'stats' ? 'on' : ''} onClick={() => setTab('stats')}>Gate statistics</button>
        </div>
        <div className="lfd-top-new">
          <button type="button" className="ml-primary" aria-expanded={newOpen} onClick={() => setNewOpen((v) => !v)}>
            {anyLive ? 'New simulation (queues)' : 'New simulation'}
          </button>
          {newOpen && (
            <NewSimPanel
              estimate={estimate}
              onClose={() => setNewOpen(false)}
              onStarted={async (id) => {
                setNewOpen(false);
                setTab('sims');
                await loadSims();
                setOpenId(id);
              }}
            />
          )}
        </div>
      </header>
      {err && <p className="ml-error">{err}</p>}
      {tab === 'stats' && <StatsPanel />}
      {tab === 'sims' && (
        <div className="lfd-shell">
          <nav className="lfd-rail" aria-label="Simulations">
            {sims.length === 0 && <p className="ml-note">None yet. Start one with New simulation.</p>}
            <ul>
              {sims.map((s) => (
                <li key={s.id}>
                  <button type="button" className={`lfd-rail-item ${openId === s.id ? 'on' : ''}`} aria-current={openId === s.id} onClick={() => setOpenId(s.id)}>
                    <span className={`ml-dot ${s.status}`} aria-hidden />
                    <span className="lfd-rail-title">{simTitle(s)}</span>
                    <span className="lfd-rail-meta">
                      {live(s) ? STAGES[s.stage ?? ''] ?? 'Queued' : s.status === 'failed' ? 'Failed' : `${s.memesPlaced} meme${s.memesPlaced === 1 ? '' : 's'} · ${s.stories} stories`} · {money(s.costUsd)}
                    </span>
                    {s.status === 'ok' && <span className={`lfd-rail-grade ${s.graded ? 'done' : ''}`}>{s.graded ? 'Post graded' : 'Not graded'}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <section className="lfd-main">
            {detail ? <SimView key={detail.id} sim={detail} onChanged={() => loadDetail(detail.id).then(loadSims)} /> : <p className="ml-note">Open a simulation on the left.</p>}
          </section>
        </div>
      )}
    </main>
  );
}

const simTitle = (s: { replay: boolean; asOf: string }) => (s.replay ? `Replay of ${longDay(s.asOf.slice(0, 10))}` : `As of ${new Date(s.asOf.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`);

/** "New simulation": as of now or a replayed day from the calendar, then an on-page confirm (the app's browser blocks pop-ups). */
function NewSimPanel({ estimate, onClose, onStarted }: { estimate: number; onClose: () => void; onStarted: (id: string) => void }) {
  const [mode, setMode] = useState<'now' | 'replay'>('now');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const { id } = await api<{ id: string }>('/api/memes/lfd-sims', { method: 'POST', body: JSON.stringify(mode === 'replay' && date ? { asOf: date } : {}) });
      onStarted(id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="lfd-pop" role="dialog" aria-label="New simulation">
      <div className="lfd-seg" role="radiogroup" aria-label="When">
        <button type="button" role="radio" aria-checked={mode === 'now'} className={mode === 'now' ? 'on' : ''} onClick={() => setMode('now')}>As of now</button>
        <button type="button" role="radio" aria-checked={mode === 'replay'} className={mode === 'replay' ? 'on' : ''} onClick={() => setMode('replay')}>Replay a past day</button>
      </div>
      {mode === 'replay' && <ReplayCalendar value={date} onPick={setDate} />}
      <p className="lfd-pop-sum">
        {mode === 'replay' ? (date ? `Replays ${longDay(date)}: that day's stories and the posts before it, without the fresh-article lane.` : 'Pick a day.') : 'Runs the real engine on today\'s window.'}{' '}
        About {money(estimate)} of Claude and Jev. Nothing is published.
      </p>
      {err && <p className="ml-error">{err}</p>}
      <div className="lfd-pop-actions">
        <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="button" className="ml-primary" disabled={busy || (mode === 'replay' && !date)} onClick={run}>{busy ? 'Starting…' : 'Confirm and run'}</button>
      </div>
    </div>
  );
}

const longDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

type ReplayDay = { day: string; reelsScored: number; carouselRuns: number; realPost: boolean };

/** A month grid: only days with a big enough nightly story batch can be picked; a dot marks days the real post ran. */
function ReplayCalendar({ value, onPick }: { value: string; onPick: (day: string) => void }) {
  const [days, setDays] = useState<ReplayDay[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  useEffect(() => {
    api<{ days: ReplayDay[] }>('/api/memes/lfd-sims/days')
      .then((r) => {
        setDays(r.days);
        setMonth((value || r.days.at(-1)?.day || new Date().toISOString()).slice(0, 7));
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [value]);
  if (err) return <p className="ml-error">{err}</p>;
  if (!days || !month) return <p className="ml-note">Loading the days…</p>;
  if (!days.length) return <p className="ml-note">No day in the last 60 has a story batch to replay.</p>;
  const byDay = new Map(days.map((d) => [d.day, d]));
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: Array<string | null> = [...Array(first.getUTCDay()).fill(null), ...Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  const minMonth = days[0]!.day.slice(0, 7);
  const maxMonth = days.at(-1)!.day.slice(0, 7);
  return (
    <div className="lfd-cal">
      <div className="lfd-cal-head">
        <button type="button" aria-label="Previous month" disabled={month <= minMonth} onClick={() => shift(-1)}>‹</button>
        <strong>{first.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</strong>
        <button type="button" aria-label="Next month" disabled={month >= maxMonth} onClick={() => shift(1)}>›</button>
      </div>
      <div className="lfd-cal-grid" role="grid">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i} className="lfd-cal-dow">{d}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={i} />;
          const info = byDay.get(d);
          return (
            <button
              key={d}
              type="button"
              className={`lfd-cal-day ${d === value ? 'on' : ''} ${info?.realPost ? 'post' : ''}`}
              disabled={!info}
              title={info ? `${info.reelsScored} stories scored, ${info.carouselRuns} carousel run${info.carouselRuns === 1 ? '' : 's'}${info.realPost ? '; the real post ran this day' : ''}` : 'No story batch this day'}
              onClick={() => info && onPick(d)}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
      <p className="ml-note">Days you can pick had a nightly story batch. A dot marks days the real Last Few Days post ran.</p>
    </div>
  );
}

const STAGE_ORDER = ['lfd', 'tags', 'gate', 'briefs', 'memes', 'faults', 'render'] as const;
const STAGE_SHORT: Record<string, string> = { lfd: 'Last Few Days', tags: 'Tags', gate: 'Gate', briefs: 'Briefs', memes: 'Memes', faults: 'Pick', render: 'Render' };
const parseTs = (s: string | null) => (s ? new Date(s.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')).getTime() : NaN);
const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The live run report: stage steps, elapsed time, spend so far, and every step as it happens. */
function RunReport({ sim }: { sim: SimDetail }) {
  const { report } = sim;
  const running = live(sim);
  // Elapsed time ticks every second while the run is live (measured against the server's clock).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  const [loadedAt] = useState(() => Date.now());
  const skew = parseTs(report.serverNow) - loadedAt;
  const start = parseTs(report.startedAt);
  const end = running ? Date.now() + skew + tick * 0 : parseTs(report.finishedAt);
  const elapsed = Number.isFinite(start) && Number.isFinite(end) ? clock(end - start) : '–';
  const events = report.events;
  const current = sim.stage ?? (sim.status === 'requested' ? null : 'done');
  const reached = new Set(events.map((e) => e.stage));
  const [open, setOpen] = useState(true);
  if (!events.length && !running) return null;
  return (
    <div className={`lfd-report ${running ? 'live' : ''}`}>
      <div className="lfd-report-head">
        <strong>{running ? 'Live run report' : 'Run report'}</strong>
        <span>{elapsed} elapsed</span>
        <span>{money(sim.costUsd)} spent</span>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? 'Hide steps' : 'Show steps'}</button>
      </div>
      <ol className="lfd-stages">
        {STAGE_ORDER.map((st) => {
          const state = current === st && running ? 'now' : reached.has(st) || (!running && sim.status === 'ok') ? 'done' : 'todo';
          return <li key={st} className={state}>{STAGE_SHORT[st]}</li>;
        })}
      </ol>
      {open && (
        <ol className="lfd-events" aria-live="polite">
          {events.length === 0 && <li className="ml-note">Waiting for the first step…</li>}
          {events.map((e, i) => {
            const t = parseTs(e.at) - start;
            const last = i === events.length - 1;
            return (
              <li key={e.id} className={`${e.stage} ${last && running ? 'now' : ''}`}>
                <span className="lfd-ev-t">{Number.isFinite(t) ? clock(t) : ''}</span>
                <span className="lfd-ev-m">{e.message}{e.count > 1 ? ` (${e.count} calls)` : ''}</span>
                {e.usd != null && <span className="lfd-ev-usd">{money(e.usd)}</span>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

const slideUrl = (simId: string, f: string) => `/api/memes/lfd-sims/${simId}/image?f=${encodeURIComponent(f)}`;

/** What each slide of a post is: the cover, a story (with its meme if it carries one), or the Follow slide. */
function slideLabels(sim: SimDetail, side: 'original' | 'final'): string[] {
  const post = side === 'final' ? sim.final : sim.original;
  if (!post) return [];
  const byKey = new Map(sim.stories.map((s) => [s.key, s]));
  const order = side === 'final' && sim.placement?.order ? sim.placement.order : sim.stories.map((s) => s.key);
  const placed = new Map((sim.placement?.placed ?? []).map((p) => [p.key, p]));
  return post.slides.map((_, i) => {
    if (i === 0) return side === 'final' && sim.placement?.cover.kind === 'meme' ? 'Cover: meme #1' : 'Cover';
    const key = order[i - 1];
    if (!key) return 'Follow';
    const st = byKey.get(key);
    const p = placed.get(key);
    const tag = side === 'final' && p ? (p.role === 'cover' ? ' · its meme is the cover' : ` · meme #${p.rank}`) : '';
    return `${st?.headline ?? 'Story'}${tag}`;
  });
}

type View = 'final' | 'original' | 'both';

/** The post, one big slide at a time: arrows or ← → to move, thumbnails to jump, With memes / Original / Side by side. */
function PostViewer({ sim }: { sim: SimDetail }) {
  const hasFinal = Boolean(sim.final);
  const [view, setView] = useState<View>(hasFinal ? 'final' : 'original');
  const [i, setI] = useState(0);
  const main = view === 'original' ? sim.original : sim.final ?? sim.original;
  const n = main?.slides.length ?? 0;
  const go = useCallback((d: number) => setI((x) => Math.max(0, Math.min(n - 1, x + d))), [n]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return;
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);
  if (!main) return <p className="ml-note">{live(sim) ? 'The post appears here once the Last Few Days stage finishes.' : 'No post.'}</p>;
  const labels = slideLabels(sim, view === 'original' ? 'original' : 'final');
  const origLabels = slideLabels(sim, 'original');
  const placed = sim.placement?.placed ?? [];
  const notes = [...(main.problems ?? []), ...(main.renderProblems ?? [])];
  return (
    <div className="lfd-post-tab">
      <div className="lfd-viewer">
        <div className="lfd-viewer-bar">
          <div className="lfd-seg" role="radiogroup" aria-label="Which post">
            {hasFinal && <button type="button" role="radio" aria-checked={view === 'final'} className={view === 'final' ? 'on' : ''} onClick={() => setView('final')}>With memes</button>}
            <button type="button" role="radio" aria-checked={view === 'original'} className={view === 'original' ? 'on' : ''} onClick={() => setView('original')}>Original</button>
            {hasFinal && <button type="button" role="radio" aria-checked={view === 'both'} className={view === 'both' ? 'on' : ''} onClick={() => setView('both')}>Side by side</button>}
          </div>
          <span className="lfd-viewer-count">Slide {i + 1} of {n}</span>
        </div>
        <div className={`lfd-stage ${view === 'both' ? 'both' : ''}`}>
          <button type="button" className="lfd-arrow" aria-label="Previous slide" disabled={i === 0} onClick={() => go(-1)}>‹</button>
          {view === 'both' && sim.original && (
            <figure>
              <img src={slideUrl(sim.id, sim.original.slides[i] ?? '')} alt={`Original, slide ${i + 1}`} />
              <figcaption>Original · {origLabels[i]}</figcaption>
            </figure>
          )}
          <figure>
            <img src={slideUrl(sim.id, main.slides[i] ?? '')} alt={`Slide ${i + 1}`} />
            <figcaption>{view === 'both' ? 'With memes · ' : ''}{labels[i]}</figcaption>
          </figure>
          <button type="button" className="lfd-arrow" aria-label="Next slide" disabled={i >= n - 1} onClick={() => go(1)}>›</button>
        </div>
        <div className="lfd-thumbs" role="tablist" aria-label="Slides">
          {main.slides.map((f, k) => (
            <button key={f} type="button" role="tab" aria-selected={k === i} className={k === i ? 'on' : ''} title={labels[k]} onClick={() => setI(k)}>
              <img src={slideUrl(sim.id, f)} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      </div>
      <aside className="lfd-post-side">
        <h3>Memes in this post</h3>
        {placed.length ? (
          <ol className="lfd-placed">
            {placed.map((p) => {
              const st = sim.stories.find((x) => x.key === p.key);
              return <li key={p.key}><strong>#{p.rank}</strong> {st?.headline} <span className="ml-note">(story {p.origIndex + 1} → {p.role === 'cover' ? `cover; story to slide ${p.position}` : `slide ${p.position}`})</span></li>;
            })}
          </ol>
        ) : (
          <p className="ml-note">{sim.status === 'ok' ? (sim.stories.some((x) => x.gated) ? 'None: the gated stories\' meme runs made no meme.' : 'None: no story cleared the gate.') : 'Not yet.'}</p>
        )}
        <details className="lfd-caption">
          <summary>Caption</summary>
          <pre>{main.caption}</pre>
        </details>
        {notes.length > 0 && <p className="ml-note">Render notes: {notes.join('; ')}</p>}
      </aside>
    </div>
  );
}

type SimTab = 'post' | 'grade' | 'stories' | 'report';

function SimView({ sim, onChanged }: { sim: SimDetail; onChanged: () => void }) {
  const memes = sim.stories.flatMap((s) => s.memes);
  const graded = memes.filter((m) => m.rating != null).length;
  const [tab, setTab] = useState<SimTab>(() => (live(sim) ? 'report' : memes.length > graded ? 'grade' : 'post'));
  // A run that finishes while open moves from its report to the post.
  const wasLive = useRef(live(sim));
  useEffect(() => {
    if (wasLive.current && !live(sim)) setTab(memes.length > graded ? 'grade' : 'post');
    wasLive.current = live(sim);
  }, [sim, memes.length, graded]);
  const tabs: Array<[SimTab, string]> = [
    ['post', 'Post'],
    ['grade', memes.length ? `Grade memes (${graded}/${memes.length})` : 'Grade memes'],
    ['stories', `Stories & gate (${sim.stories.filter((x) => x.gated).length}/${sim.stories.length} gated)`],
    ['report', live(sim) ? 'Run report · live' : 'Run report'],
  ];
  return (
    <div className="lfd-sim">
      <SimHeader sim={sim} graded={graded} total={memes.length} onChanged={onChanged} />
      <div className="ml-tabs lfd-subtabs" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      <div className="lfd-tabbody">
        {tab === 'post' && <PostViewer sim={sim} />}
        {tab === 'grade' && <GradeView sim={sim} onChanged={onChanged} />}
        {tab === 'stories' && <StoriesTable sim={sim} />}
        {tab === 'report' && (sim.report.events.length || live(sim) ? <RunReport sim={sim} /> : <p className="ml-note">This run started before the live report existed.</p>)}
      </div>
    </div>
  );
}

/** The selected run's sticky header: what it is, where it stands, and the post's grade. */
function SimHeader({ sim, graded, total, onChanged }: { sim: SimDetail; graded: number; total: number; onChanged: () => void }) {
  const [note, setNote] = useState(sim.grade?.note ?? '');
  useEffect(() => setNote(sim.grade?.note ?? ''), [sim.grade?.note]);
  const [noteOpen, setNoteOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const grade = sim.grade?.rating ?? null;
  async function saveGrade(body: Record<string, unknown>) {
    setErr(null);
    try {
      await api(`/api/memes/lfd-sims/${sim.id}/grade`, { method: 'POST', body: JSON.stringify(body) });
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <div className="lfd-simhead">
      <div className="lfd-simhead-row">
        <h2>{simTitle(sim)}</h2>
        <span className={`lfd-pill ${sim.status}`}>{live(sim) ? STAGES[sim.stage ?? ''] ?? 'Queued' : sim.status === 'failed' ? 'Failed' : 'Done'}</span>
        <span className="lfd-simhead-meta">{money(sim.costUsd)}</span>
        {sim.record.gate && <span className="lfd-simhead-meta">gate {pct(sim.record.gate.threshold)} · {sim.record.gate.evidence} graded stories</span>}
        {total > 0 && <span className={`lfd-simhead-meta ${graded === total ? 'ok' : ''}`}>memes graded {graded}/{total}</span>}
        {sim.status === 'ok' && (
          <div className="lfd-postgrade" role="radiogroup" aria-label="Grade this post">
            <span>Post</span>
            {RATING_NAMES.map((name, k) => (
              <button key={name} type="button" role="radio" aria-checked={grade === k + 1} title={name} className={`r${k + 1} ${grade === k + 1 ? 'on' : ''}`} onClick={() => saveGrade({ rating: k + 1 })}>
                {k + 1}
              </button>
            ))}
            <button type="button" className="lfd-notebtn" aria-expanded={noteOpen} onClick={() => setNoteOpen((v) => !v)}>{sim.grade?.note ? 'Note ✓' : 'Note'}</button>
          </div>
        )}
      </div>
      {sim.status === 'failed' && <p className="ml-error">{sim.error}</p>}
      {noteOpen && (
        <textarea className="ml-note-in" aria-label="Notes on this post" placeholder="Placement, cover, overall feel" value={note} maxLength={2000} autoFocus onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (sim.grade?.note ?? '') && saveGrade({ note })} />
      )}
      {err && <p className="ml-error">{err}</p>}
    </div>
  );
}

const RATING_NAMES = ['Horrible', 'No', 'Yes', 'Awesome'] as const;

/**
 * Every slate meme of the gated stories in one place. Click a meme (or Tab to it) and press 1–4 to grade; focus
 * then moves to the next ungraded meme.
 */
function GradeView({ sim, onChanged }: { sim: SimDetail; onChanged: () => void }) {
  const gated = sim.stories.filter((s) => s.gated);
  const cards = useRef(new Map<string, HTMLElement>());
  const order = gated.flatMap((s) => s.memes.map((m) => m.id));
  const focusNext = (fromId: string) => {
    const rest = [...order.slice(order.indexOf(fromId) + 1), ...order.slice(0, order.indexOf(fromId))];
    const next = rest.find((id) => sim.stories.flatMap((s) => s.memes).find((m) => m.id === id)?.rating == null);
    if (next) cards.current.get(next)?.focus();
  };
  if (!gated.length) return <p className="ml-note">{live(sim) ? 'Memes appear here once the gate has run.' : 'No story cleared the gate, so there are no memes to grade.'}</p>;
  return (
    <div className="lfd-grade">
      <p className="ml-note">Click a meme, then press 1 (Horrible), 2 (No), 3 (Yes) or 4 (Awesome). The next ungraded meme is selected for you.</p>
      {gated.map((s) => (
        <section key={s.key} className="lfd-grade-story">
          <header>
            <span className="lfd-pos">{s.origIndex + 1}</span>
            <strong>{s.headline}</strong>
            {s.odds && <span className="lfd-odds pass">{pct(s.odds.p)}</span>}
            {s.picker && !s.picker.memeId && <span className="ml-note">No meme: {s.picker.reason}</span>}
            {s.requestStatus && s.requestStatus !== 'ok' && <span className="ml-note">Meme run: {s.requestStatus}</span>}
          </header>
          <div className="lfd-grade-row">
            {s.memes.map((m) => (
              <SimMemeCard key={m.id} meme={m} picked={s.picker?.memeId === m.id} onChanged={onChanged} onRated={() => focusNext(m.id)} cardRef={(el) => (el ? cards.current.set(m.id, el) : cards.current.delete(m.id))} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function StoriesTable({ sim }: { sim: SimDetail }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!sim.stories.length) return <p className="ml-note">{live(sim) ? 'Stories appear here once the gate has run.' : 'No stories.'}</p>;
  return (
    <table className="lfd-table lfd-stories-table">
      <thead><tr><th>#</th><th>Story</th><th>Tags</th><th>Odds</th><th>Gate</th><th>Meme</th></tr></thead>
      <tbody>
        {sim.stories.map((s) => {
          const t = s.tags;
          const chips = t ? [t.irony && 'irony', t.launch && 'launch', t.numberStory && 'number', t.conflict && 'conflict', t.shortHeadline ? 'short' : 'long'].filter(Boolean) as string[] : [];
          const p = sim.placement?.placed.find((x) => x.key === s.key);
          return (
            <tr key={s.key} className={s.gated ? 'gated' : ''} onClick={() => setOpen(open === s.key ? null : s.key)}>
              <td>{s.origIndex + 1}</td>
              <td>{s.headline}{open === s.key && s.odds && <div className="ml-note">{s.odds.why}</div>}</td>
              <td>{chips.map((c) => <span key={c} className="lfd-chip">{c}</span>)}</td>
              <td>{s.odds ? pct(s.odds.p) : '–'}</td>
              <td>{s.gated ? 'Gets memes' : s.odds?.passes ? 'Passes, not top 3' : '–'}</td>
              <td>{p ? (p.role === 'cover' ? `#${p.rank}, cover` : `#${p.rank}, slide ${p.position}`) : s.gated ? (s.picker?.memeId ? '' : 'none') : ''}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SimMemeCard({ meme, picked, onChanged, onRated, cardRef }: { meme: SimMeme; picked: boolean; onChanged: () => void; onRated?: () => void; cardRef?: (el: HTMLElement | null) => void }) {
  const [note, setNote] = useState(meme.note ?? '');
  useEffect(() => setNote(meme.note ?? ''), [meme.note]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showFaults, setShowFaults] = useState(false);
  const rating = meme.rating === 1 || meme.rating === 2 || meme.rating === 3 || meme.rating === 4 ? meme.rating : null;
  async function save(body: Record<string, unknown>, advance = false) {
    setSaving(true);
    setErr(null);
    try {
      await api('/api/memes/picks', { method: 'POST', body: JSON.stringify({ memeId: meme.id, ...body }) });
      onChanged();
      if (advance) onRated?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <article
      ref={cardRef}
      tabIndex={0}
      aria-label={`${meme.templateName} meme, #${meme.rank}${rating ? `, rated ${rating}` : ', not graded'}`}
      className={`ml-meme lfd-meme ${rating != null && rating >= 3 ? 'picked' : ''} ${rating != null && rating <= 2 ? 'rejected' : ''}`}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
        if (['1', '2', '3', '4'].includes(e.key)) {
          e.preventDefault();
          void save({ rating: Number(e.key) }, true);
        }
      }}
    >
      <div className="ml-meme-img">{meme.hasImage ? <img src={`/api/memes/image/${meme.id}`} alt={`${meme.templateName} meme`} /> : <div className="ml-noimg">No image</div>}</div>
      <div className="ml-meme-body">
        <div className="ml-meme-top">
          <span className="ml-rank">#{meme.rank}</span> <strong>{meme.templateName}</strong>
          {picked && <span className="lfd-chosen">In the post</span>}
        </div>
        <ReviewSlider value={rating} disabled={saving} onChange={(n) => save({ rating: n }, true)} />
        {rating != null && (
          <textarea className="ml-note-in" aria-label={rating >= 3 ? 'What worked' : 'What went wrong'} placeholder={rating >= 3 ? 'What worked? (optional)' : 'What went wrong? (optional)'} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (meme.note ?? '') && save({ rating, note })} />
        )}
        {meme.faults && (
          <button type="button" className="lfd-faultbtn" aria-expanded={showFaults} onClick={() => setShowFaults((v) => !v)}>
            Jev faults (reference): {meme.faults.count}
          </button>
        )}
        {showFaults && meme.faults && <p className="ml-note">{meme.faults.flagged.map((f) => f.label).join('; ') || 'None flagged.'}</p>}
        {err && <p className="ml-error">{err}</p>}
      </div>
    </article>
  );
}

function StatsPanel() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<{ threshold: string } | null>(null);
  const load = useCallback(async () => {
    const s = await api<Stats>('/api/memes/lfd-sims/stats');
    setStats(s);
    setForm({ threshold: String(Math.round(s.settings.gateThreshold * 100)) });
  }, []);
  useEffect(() => {
    load().catch((e) => setErr(String(e)));
  }, [load]);
  async function save() {
    if (!form) return;
    setErr(null);
    try {
      await api('/api/memes/lfd-sims/settings', { method: 'POST', body: JSON.stringify({ gateThreshold: Number(form.threshold) / 100 }) });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }
  if (!stats || !form) return <p className="ml-note">{err ?? 'Loading…'}</p>;
  return (
    <>
      <section className="ml-card">
        <h2>What the gate knows</h2>
        <p className="ml-note">
          {stats.stories} graded stories (generation {stats.regime}, tags {stats.taggerVersion}); {rate(stats.base)} had a good meme in their slate.
          Recounted from your grades every time this page loads. Only stories that pass the gate get memes, so new evidence comes from passing kinds of stories.
        </p>
        <table className="lfd-table">
          <thead><tr><th>Factor</th><th>With it</th><th>Without it</th></tr></thead>
          <tbody>
            {stats.factors.map((f) => <tr key={f.factor}><td>{FACTOR_LABELS[f.factor] ?? f.factor}</td><td>{rate(f.with)}</td><td>{rate(f.without)}</td></tr>)}
          </tbody>
        </table>
        <h3>Cells (the odds a story gets)</h3>
        <p className="ml-note">A story passes when its cell's odds reach the threshold and the cell has at least {stats.minCellN} graded stories of its own. A cell short of that shows how many more graded stories it needs.</p>
        <table className="lfd-table">
          <thead><tr><th>Irony or launch</th><th>Number story</th><th>Short headline</th><th>Graded</th><th>Odds</th><th>Gate</th></tr></thead>
          <tbody>
            {stats.cells.map((c, i) => (
              <tr key={i}>
                <td>{c.tension ? 'Yes' : 'No'}</td><td>{c.numberStory ? 'Yes' : 'No'}</td><td>{c.shortHeadline ? 'Yes' : 'No'}</td>
                <td>{c.n ? `${c.good}/${c.n}` : '–'}{c.pending > 0 && <span className="ml-note"> (+{c.pending} waiting for grades)</span>}</td><td>{pct(c.p)}</td><td>{c.passes ? 'Passes' : c.needs > 0 ? `Needs ${c.needs} more graded` : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="ml-card">
        <h2>Settings</h2>
        <div className="lfd-settings">
          <label>Gate threshold (%) <input type="number" min={1} max={100} value={form.threshold} onChange={(e) => setForm({ ...form, threshold: e.target.value })} /></label>
          <button type="button" className="ml-primary" onClick={save}>Save settings</button>
        </div>
        <p className="ml-note">Each story's meme is its slate's #1. Choosing by Jev's fault count did worse on the graded v5 slates (planning/Memes/FAULTS.md).</p>
        {err && <p className="ml-error">{err}</p>}
      </section>
    </>
  );
}
