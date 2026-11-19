'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Gamepad2, X } from 'lucide-react';

import { HubLoadingSpinner } from '@/app/hub/hub-loading';
import { GameDaysPanel } from '@/components/resource-tracker/GameDaysPanel';
import { shortDate, TrackerChart } from '@/components/resource-tracker/TrackerChart';
import type { CalendarStats, GameStats, TrackerRange } from '@/lib/resource-tracker/types';

type Resource = 'calendar' | 'game';

const RESOURCES: Array<{ id: Resource; label: string; Icon: typeof CalendarDays }> = [
  { id: 'calendar', label: 'Networking calendar', Icon: CalendarDays },
  { id: 'game', label: 'Are you smarter than AI?', Icon: Gamepad2 },
];
const RANGES: Array<[TrackerRange, string]> = [['14d', '14 days'], ['30d', '30 days'], ['90d', '90 days'], ['all', 'All time']];

/** Series colors (validated with the dataviz skill's checker: CVD and normal-vision separation pass on white). */
const C = { players: 'var(--chart-1)', ai: 'var(--chart-2)', fresh: 'var(--chart-6)', clicks: 'var(--chart-1)', visitors: 'var(--chart-2)' };

const METRO_LABEL: Record<string, string> = { miami: 'Miami', boston: 'Boston', nyc: 'New York', sf: 'San Francisco', unknown: 'Unknown' };
const pct = (v: number | null, digits = 0) => (v === null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`);
const one = (v: number | null) => (v === null ? '—' : v.toFixed(1));
const int = (v: number | null) => (v === null ? '—' : Math.round(v).toLocaleString('en-US'));

function useJson<T>(url: string): { data: T | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetch(url, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!live) return;
        if (!res.ok) setState({ data: null, error: body.error ?? `HTTP ${res.status}`, loading: false });
        else setState({ data: body as T, error: null, loading: false });
      })
      .catch((err: unknown) => live && setState({ data: null, error: err instanceof Error ? err.message : String(err), loading: false }));
    return () => {
      live = false;
    };
  }, [url]);
  return state;
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat-tile rt-tile">
      <span className="stat-tile__label">{label}</span>
      <span className="stat-tile__value">{value}</span>
      {sub ? <span className="stat-tile__sub">{sub}</span> : null}
    </div>
  );
}

function BarList({ title, rows, unit }: { title: string; rows: Array<{ key: string; label: string; sub?: string; value: number }>; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <section className="rt-panel">
      <header className="rt-panel__head"><h3 className="rt-chart__title">{title}</h3><span className="rt-muted rt-small">{unit}</span></header>
      {!rows.length ? <p className="rt-muted">No clicks in this range yet.</p> : (
        <ul className="rt-bars">
          {rows.map((r) => (
            <li key={r.key} className="rt-bar">
              <span className="rt-bar__fill" style={{ width: `${(r.value / max) * 100}%` }} aria-hidden="true" />
              <span className="rt-bar__label" title={r.label}>{r.label}{r.sub ? <small>{r.sub}</small> : null}</span>
              <span className="rt-bar__value">{r.value.toLocaleString('en-US')}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ── Networking calendar ─────────────────────────────────────────────── */

function CalendarView({ range }: { range: TrackerRange }) {
  const { data, error, loading } = useJson<CalendarStats>(`/api/resource-tracker/calendar?range=${range}`);
  if (loading && !data) return <HubLoadingSpinner />;
  if (error) return <p className="field__error">{error}</p>;
  if (!data) return null;
  const dates = data.days.map((d) => d.date);
  const rate = data.totals.visitors ? data.totals.clicks / data.totals.visitors : null;
  return (
    <div className="rt-view">
      <p className="rt-note">
        {data.trackingSince
          ? `Counting RSVP clicks since ${shortDate(data.trackingSince)}. Crawlers and link previews are left out${data.totals.botHits ? ` (${data.totals.botHits} in this range)` : ''}.`
          : 'No RSVP clicks counted yet. Counting starts with the first calendar publish after this deploy.'}
        {data.viewsNote ? ` ${data.viewsNote}` : ''}
      </p>
      <div className="rt-tiles">
        <Tile label="RSVP clicks" value={int(data.totals.clicks)} sub="People sent to an event page" />
        <Tile label="Calendar visitors" value={int(data.totals.visitors)} sub="Vercel Web Analytics" />
        <Tile label="Click-through" value={pct(rate, 1)} sub="RSVP clicks per visitor" />
        <Tile label="Events clicked" value={int(data.totals.eventsClicked)} sub="Distinct events" />
      </div>
      <TrackerChart
        title="RSVP clicks per day"
        subtitle="New York days"
        dates={dates}
        kind="bars"
        series={[{ key: 'clicks', label: 'RSVP clicks', color: C.clicks, values: data.days.map((d) => d.clicks) }]}
        extra={(i) => [['Calendar visitors', int(data.days[i]!.visitors)], ['Click-through', pct(data.days[i]!.visitors ? data.days[i]!.clicks / data.days[i]!.visitors! : null, 1)]]}
        emptyText="No RSVP clicks in this range yet."
      />
      {data.totals.visitors !== null ? (
        <TrackerChart
          title="Calendar visitors per day"
          subtitle="Vercel Web Analytics (UTC days, at most the last 62)"
          dates={dates}
          kind="lines"
          height={180}
          series={[{ key: 'visitors', label: 'Visitors', color: C.visitors, values: data.days.map((d) => d.visitors) }]}
        />
      ) : null}
      <div className="rt-split">
        <BarList title="Top events" unit="RSVP clicks" rows={data.topEvents.map((e) => ({ key: e.id, label: e.title, sub: [METRO_LABEL[e.metro] ?? e.metro, e.start ? shortDate(e.start.slice(0, 10)) : null].filter(Boolean).join(' · '), value: e.clicks }))} />
        <BarList title="By city" unit="RSVP clicks" rows={data.metros.map((m) => ({ key: m.metro, label: METRO_LABEL[m.metro] ?? m.metro, value: m.clicks }))} />
      </div>
    </div>
  );
}

/* ── Are you smarter than AI? ────────────────────────────────────────── */

function ScoreCell({ cell }: { cell: { score: number; beatAi: boolean } | undefined }) {
  if (!cell) return <td className="rt-heat rt-heat--none" aria-label="Did not play">·</td>;
  return (
    <td className="rt-heat" style={{ ['--heat' as string]: `${12 + cell.score * 17}%` }} title={`${cell.score} of 5${cell.beatAi ? ', beat the AI' : ''}`}>
      {cell.score}{cell.beatAi ? <sup aria-label="beat the AI">★</sup> : null}
    </td>
  );
}

function QuestionsForDay({ data }: { data: GameStats }) {
  const days = data.days.filter((d) => data.questions[d.dayNumber]?.length);
  const [idx, setIdx] = useState<number | null>(null);
  const at = idx ?? days.length - 1;
  const day = days[at];
  if (!day) return null;
  const qs = data.questions[day.dayNumber] ?? [];
  return (
    <section className="rt-panel">
      <header className="rt-panel__head">
        <div>
          <h3 className="rt-chart__title">Questions · Day {day.dayNumber}</h3>
          <p className="rt-chart__sub">{shortDate(day.date)} · {day.players} players · AI right on {day.aiScore ?? '—'} of 5</p>
        </div>
        <div className="rt-stepper">
          <button type="button" className="btn btn--quiet" aria-label="Earlier day" disabled={at <= 0} onClick={() => setIdx(at - 1)}><ChevronLeft size={16} /></button>
          <button type="button" className="btn btn--quiet" aria-label="Later day" disabled={at >= days.length - 1} onClick={() => setIdx(at + 1)}><ChevronRight size={16} /></button>
        </div>
      </header>
      <ol className="rt-questions">
        {qs.map((q) => {
          const rightShare = q.answers ? q.right / q.answers : null;
          return (
            <li key={q.position} className="rt-question">
              <div className="rt-question__text">{q.question}</div>
              <div className="rt-question__opts">
                {q.options.map((o) => (
                  <span key={o.letter} className={`rt-opt${o.letter === q.correct ? ' rt-opt--correct' : ''}`}>
                    {o.letter}. {o.text}{o.letter === q.correct ? <Check size={12} aria-label="correct" /> : null}
                  </span>
                ))}
              </div>
              <div className="rt-question__stats">
                <span className={`rt-pill ${q.aiRight ? 'rt-pill--ai' : 'rt-pill--miss'}`}>
                  {q.aiRight ? <Check size={12} aria-hidden="true" /> : <X size={12} aria-hidden="true" />} AI picked {q.aiPicked}
                </span>
                <span className="rt-meter" aria-label={`Players right: ${pct(rightShare)}`}>
                  <span className="rt-meter__track"><span className="rt-meter__fill" style={{ width: `${(rightShare ?? 0) * 100}%` }} /></span>
                  <span>{pct(rightShare)} of players right</span>
                </span>
                <span className="rt-muted rt-small">{q.medianSeconds === null ? 'no answers yet' : `median ${q.medianSeconds.toFixed(1)} s`}{q.timeouts ? ` · ${q.timeouts} timed out` : ''}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function GameView({ range }: { range: TrackerRange }) {
  const { data, error, loading } = useJson<GameStats>(`/api/resource-tracker/game?range=${range}`);
  const recent = useMemo(() => (data ? data.days.slice(-14) : []), [data]);
  if (loading && !data) return <HubLoadingSpinner />;
  if (error) return <p className="field__error">{error}</p>;
  if (!data) return null;
  if (!data.configured) {
    return (
      <div className="rt-view">
        <p className="rt-note">
          Game stats live in the website&apos;s Supabase. Create the read-only login with <code>db/site_game_reader_role.sql</code>, then set <code>GAME_STATS_DATABASE_URL</code> in the hub.
        </p>
        <GameDaysPanel />
      </div>
    );
  }
  const dates = data.days.map((d) => d.date);
  return (
    <div className="rt-view">
      {data.error ? <p className="field__error">Could not read the game database: {data.error}</p> : null}
      {data.viewsNote ? <p className="rt-note">{data.viewsNote}</p> : null}
      <div className="rt-tiles">
        <Tile label="Players" value={int(data.totals.players)} sub={`${int(data.totals.plays)} finished games`} />
        <Tile label="Beat the AI" value={pct(data.totals.beatAiShare)} sub="Share of finished games" />
        <Tile label="Returning" value={pct(data.totals.returningShare)} sub="Games by players who played before" />
        <Tile label="Finish rate" value={pct(data.totals.finishRate)} sub="Finished of started" />
      </div>
      <TrackerChart
        title="Players per day"
        subtitle="Finished daily games, by first-time and returning players"
        dates={dates}
        kind="stacked"
        series={[
          { key: 'returning', label: 'Returning', color: C.players, values: data.days.map((d) => d.returningPlayers) },
          { key: 'new', label: 'New', color: C.fresh, values: data.days.map((d) => d.newPlayers) },
        ]}
        extra={(i) => [['Players', int(data.days[i]!.players)], ['Started', int(data.days[i]!.started)], ['Game page visitors', int(data.days[i]!.visitors)]]}
        emptyText="No games played in this range yet."
      />
      <TrackerChart
        title="Players vs the AI"
        subtitle="Correct answers out of 5: the players' average and the AI's score"
        dates={dates}
        kind="lines"
        yMax={5}
        series={[
          { key: 'players', label: 'Players (avg)', color: C.players, values: data.days.map((d) => d.avgScore) },
          { key: 'ai', label: 'AI', color: C.ai, values: data.days.map((d) => d.aiScore) },
        ]}
        extra={(i) => {
          const d = data.days[i]!;
          return [['Players avg points', int(d.avgPoints)], ['AI points', int(d.aiPoints)], ['Beat the AI', d.players ? `${d.beatAi} of ${d.players}` : '—']];
        }}
      />
      <section className="rt-panel">
        <header className="rt-panel__head">
          <div>
            <h3 className="rt-chart__title">Most games played</h3>
            <p className="rt-chart__sub">Correct answers each day (darker is higher); ★ beat the AI. Players who saved progress show their email.</p>
          </div>
        </header>
        {!data.topPlayers.length ? <p className="rt-muted">No finished games yet.</p> : (
          <div className="rt-tablewrap">
            <table className="rt-table rt-players">
              <thead>
                <tr>
                  <th scope="col">Player</th><th scope="col">Games</th><th scope="col">Avg</th><th scope="col">Wins</th>
                  {recent.map((d) => <th key={d.dayNumber} scope="col" className="rt-heat__head" title={`Day ${d.dayNumber}`}>{shortDate(d.date).replace(/^[A-Za-z]+ /, '')}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.topPlayers.map((p) => (
                  <tr key={p.key}>
                    <th scope="row" className="rt-players__name" title={p.name}>{p.name}</th>
                    <td>{p.games}</td><td>{p.avgScore.toFixed(1)}</td><td>{p.wins}</td>
                    {recent.map((d) => <ScoreCell key={d.dayNumber} cell={p.byDay[d.dayNumber]} />)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <QuestionsForDay data={data} />
      <GameDaysPanel />
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────── */

export function ResourceTracker() {
  const router = useRouter();
  const path = usePathname() ?? '/resource-tracker';
  const params = useSearchParams();
  const resource: Resource = params?.get('view') === 'game' ? 'game' : 'calendar';
  const range = (RANGES.find(([r]) => r === params?.get('range'))?.[0] ?? '30d') as TrackerRange;

  const set = useCallback((patch: Record<string, string>) => {
    const next = new URLSearchParams(params?.toString() ?? '');
    for (const [k, v] of Object.entries(patch)) next.set(k, v);
    router.replace(`${path}?${next.toString()}`, { scroll: false });
  }, [params, path, router]);

  return (
    <main className="app-shell">
      <section className="card">
        <div className="card__header">
          <div>
            <div className="card__title">Resource Tracker</div>
            <div className="card__subtitle">How people use the free tools on heliosgroup.ai</div>
          </div>
        </div>
        <div className="card__body rt">
          <div className="rt-toolbar">
            <div className="segmented rt-resources" role="tablist" aria-label="Resource">
              {RESOURCES.map(({ id, label, Icon }) => (
                <button key={id} type="button" role="tab" aria-selected={resource === id}
                  className={`segmented__item${resource === id ? ' segmented__item--active' : ''}`} onClick={() => set({ view: id })}>
                  <Icon size={14} aria-hidden="true" /> {label}
                </button>
              ))}
            </div>
            <div className="segmented" aria-label="Date range">
              {RANGES.map(([id, label]) => (
                <button key={id} type="button" className={`segmented__item${range === id ? ' segmented__item--active' : ''}`} onClick={() => set({ range: id })}>{label}</button>
              ))}
            </div>
          </div>
          <div role="tabpanel">{resource === 'game' ? <GameView key={range} range={range} /> : <CalendarView key={range} range={range} />}</div>
        </div>
      </section>
    </main>
  );
}
