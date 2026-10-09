'use client';

import { useEffect, useState } from 'react';

import { Drawer, ReelVideo } from '@/app/reels/ui';
import { HeliosMenu } from '@/app/components/helios-menu';
import { requestJson } from '@/lib/client-request';
import {
  FACTOR_OPTIONS,
  creationFacts,
  gridNote,
  performanceHref,
  type FactorId,
  type PerformancePage,
  type PerformanceReel,
  type PerformanceSnapshot,
  type PerformanceStat,
  type ReelSort,
} from '@/lib/reels/analytics/performance';
import { useRouter } from 'next/navigation';

const PERIODS: Array<{ id: PerformancePage['period']; label: string }> = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'all', label: 'All' },
];

const ROW_METRICS: Array<{ field: keyof PerformanceSnapshot; label: string; display: 'count' | 'duration' | 'rate' }> = [
  { field: 'views', label: 'Views', display: 'count' },
  { field: 'reach', label: 'Reach', display: 'count' },
  { field: 'avgWatchTimeMs', label: 'Watch', display: 'duration' },
  { field: 'skipRate', label: 'Skip', display: 'rate' },
  { field: 'shares', label: 'Shares', display: 'count' },
  { field: 'saved', label: 'Saves', display: 'count' },
  { field: 'likes', label: 'Likes', display: 'count' },
];

const DRAWER_METRICS: Array<{ field: keyof PerformanceSnapshot; label: string; display: 'count' | 'duration' | 'rate' }> = [
  ...ROW_METRICS,
  { field: 'comments', label: 'Comments', display: 'count' },
  { field: 'reposts', label: 'Reposts', display: 'count' },
  { field: 'totalInteractions', label: 'Interactions', display: 'count' },
  { field: 'totalWatchTimeMs', label: 'Total watch time', display: 'duration' },
];

function count(value: number | null): string {
  if (value == null) return '—';
  return Math.round(value).toLocaleString('en-US');
}

function rate(value: number | null): string {
  if (value == null) return '—';
  return `${Math.round(value * 100)}%`;
}

function duration(ms: number | null): string {
  if (ms == null) return '—';
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

function shownMetric(value: number | null, display: 'count' | 'duration' | 'rate'): string {
  if (display === 'duration') return duration(value);
  if (display === 'rate') return rate(value);
  return count(value);
}

function shownStat(stat: PerformanceStat): string {
  return shownMetric(stat.value, stat.display);
}

function rangeLabel(data: PerformancePage): string {
  if (data.total === 0) return data.query ? 'No matches.' : 'No reels in this window.';
  const start = (data.page - 1) * data.pageSize + 1;
  const end = Math.min(data.total, start + data.reels.length - 1);
  if (data.total <= data.pageSize) return `${data.total} ${data.total === 1 ? 'reel' : 'reels'}.`;
  return `${start}–${end} of ${data.total}.`;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function dayLabel(nyDate: string): string {
  const [year, month, day] = nyDate.split('-').map(Number);
  if (!year || !month || !day) return nyDate;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function songLine(reel: PerformanceReel): string | null {
  const parts = [reel.songTitle, reel.songArtist, reel.genre].map((part) => part?.trim()).filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export function PerformanceView({
  data,
  pollPending = false,
  pollStartedAt = null,
}: {
  data: PerformancePage;
  pollPending?: boolean;
  pollStartedAt?: string | null;
}) {
  const router = useRouter();
  const [factor, setFactor] = useState<FactorId>('psychology');
  const [openStat, setOpenStat] = useState<string | null>(null);
  const [openReel, setOpenReel] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [draft, setDraft] = useState(data.query);
  const reels = data.reels;
  const selectedStat = data.headlines.find((stat) => stat.id === openStat) ?? null;
  const selectedReel = data.reels.find((reel) => reel.attemptId === openReel) ?? null;
  const groups = data.factors[factor];
  const sort = data.sort;

  useEffect(() => {
    setDraft(data.query);
  }, [data.query]);

  useEffect(() => {
    if (!pollPending || !pollStartedAt) return undefined;
    const started = new Date(pollStartedAt).getTime();
    if (!Number.isFinite(started) || Date.now() - started > 45_000) return undefined;
    const timer = setInterval(() => {
      if (Date.now() - started > 45_000) {
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, 4_000);
    return () => clearInterval(timer);
  }, [pollPending, pollStartedAt, router]);

  function openList(patch: { sort?: ReelSort; query?: string; page?: number; period?: PerformancePage['period'] }) {
    router.push(performanceHref(patch.period ?? data.period, {
      sort: patch.sort ?? data.sort,
      query: patch.query !== undefined ? patch.query : data.query,
      page: patch.page ?? 1,
    }));
  }

  useEffect(() => {
    if (!openStat && !openReel) return undefined;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpenStat(null);
        setOpenReel(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openStat, openReel]);

  async function refresh() {
    setRefreshing(true);
    setRefreshError(null);
    try {
      await requestJson('/api/reels/insights', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      router.refresh();
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <>
      <div className="rh-controls">
        <div className="segmented" role="tablist" aria-label="Period">
          {PERIODS.map((period) => (
            <a
              key={period.id}
              href={performanceHref(period.id, { sort: data.sort, query: data.query })}
              role="tab"
              aria-selected={data.period === period.id}
              className={`segmented__item${data.period === period.id ? ' segmented__item--active' : ''}`}
            >
              {period.label}
            </a>
          ))}
        </div>
        <form
          className="rh-perf-search"
          onSubmit={(event) => {
            event.preventDefault();
            openList({ query: draft.trim(), page: 1 });
          }}
        >
          <input
            className="helios-field-input"
            type="text"
            name="q"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Search reels"
            aria-label="Search reels"
            maxLength={80}
          />
          <button type="submit" className="rh-btn rh-btn--xs">Search</button>
        </form>
        <button type="button" className="rh-btn rh-btn--xs" onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? 'Refreshing' : 'Refresh'}
        </button>
        {refreshError ? <p className="rh-muted">{refreshError}</p> : null}
      </div>

      {data.poll?.blocked && data.poll.message ? <p className="rh-note">{data.poll.message}</p> : null}
      {!data.poll?.blocked && data.poll?.message && data.reels.length > 0 && !data.hasNumbers ? (
        <p className="rh-note">{data.poll.message}</p>
      ) : null}

      <div className="rh-headlines rh-headlines--metrics">
        {data.headlines.map((stat) => (
          <button
            key={stat.id}
            type="button"
            className={`rh-stat${openStat === stat.id ? ' is-active' : ''}`}
            onClick={() => {
              setOpenReel(null);
              setOpenStat(stat.id);
            }}
          >
            <span className="rh-stat__label">{stat.label}</span>
            <span className="rh-stat__value">{shownStat(stat)}</span>
          </button>
        ))}
      </div>

      {data.total > 0 && !data.hasNumbers ? (
        <p className="rh-muted rh-perf-wait">
          No performance numbers yet. Instagram can take up to 48 hours to return them. Opening Text on Screen asks for reels whose numbers can still change, at most every 30 minutes.
        </p>
      ) : null}

      <section className="rh-card rh-perf-card">
        <div className="rh-chart__head">
          <div>
            <h2 className="rh-card__title">Published reels</h2>
            <p className="rh-muted">
              {rangeLabel(data)}
              {sort === 'graduate'
                ? ' Sorted by shares, then saves, then views.'
                : ' Sorted by skip rate, then average watch time.'}
            </p>
          </div>
          <div className="segmented" role="tablist" aria-label="Reel sort">
            <button
              type="button"
              role="tab"
              aria-selected={sort === 'graduate'}
              className={`segmented__item${sort === 'graduate' ? ' segmented__item--active' : ''}`}
              onClick={() => openList({ sort: 'graduate', page: 1 })}
            >
              Graduate
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sort === 'hook'}
              className={`segmented__item${sort === 'hook' ? ' segmented__item--active' : ''}`}
              onClick={() => openList({ sort: 'hook', page: 1 })}
            >
              Hook
            </button>
          </div>
        </div>
        {reels.length === 0 ? (
          <p className="rh-muted">{data.query ? 'No reels match that search.' : 'No Text on Screen reels published in this window.'}</p>
        ) : (
          <ul className="rh-perf-list">
            {reels.map((reel) => (
              <li key={reel.attemptId}>
                <button
                  type="button"
                  className="rh-perf-row"
                  onClick={() => {
                    setOpenStat(null);
                    setOpenReel(reel.attemptId);
                  }}
                >
                  <span className="rh-perf-row__top">
                    <span className="rh-perf-row__title">{reel.title}</span>
                    {reel.metrics?.sharedToFeed ? <span className="rh-grid-pill">On the grid</span> : null}
                  </span>
                  <span className="rh-muted">
                    {reel.slotLabel} · {when(reel.finishedAt)}
                  </span>
                  <span className="rh-perf-metrics">
                    {ROW_METRICS.map((item) => (
                      <span key={item.field}>
                        <small>{item.label}</small>
                        <b>{shownMetric(reel.metrics ? (reel.metrics[item.field] as number | null) : null, item.display)}</b>
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {data.pageCount > 1 ? (
          <div className="rh-perf-pager">
            <button
              type="button"
              className="rh-btn rh-btn--xs"
              disabled={data.page <= 1}
              onClick={() => openList({ page: data.page - 1 })}
            >
              Previous
            </button>
            <span className="rh-muted">Page {data.page} of {data.pageCount}</span>
            <button
              type="button"
              className="rh-btn rh-btn--xs"
              disabled={data.page >= data.pageCount}
              onClick={() => openList({ page: data.page + 1 })}
            >
              Next
            </button>
          </div>
        ) : null}
      </section>

      <section className="rh-card rh-perf-card">
        <div className="rh-chart__head">
          <div>
            <h2 className="rh-card__title">Average engagement</h2>
            <p className="rh-muted">Sorted by average shares. A group under 3 reels is marked thin.</p>
          </div>
          <HeliosMenu
            label="Factor"
            value={factor}
            options={FACTOR_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
            onChange={(value) => setFactor(value as FactorId)}
          />
        </div>
        {groups.length === 0 ? (
          <p className="rh-muted">{data.query ? 'No reels match that search.' : 'No Text on Screen reels published in this window.'}</p>
        ) : (
          <div className="rh-factor-scroll">
            <div className="rh-factor" role="table" aria-label="Average engagement by factor">
              <div className="rh-factor__row rh-factor__head" role="row">
                <span role="columnheader">Group</span>
                <span role="columnheader">Reels</span>
                <span role="columnheader">Views</span>
                <span role="columnheader">Skip</span>
                <span role="columnheader">Watch</span>
                <span role="columnheader" aria-sort="descending">Shares</span>
                <span role="columnheader">Saves</span>
              </div>
              {groups.map((group) => (
                <div key={group.key} className={`rh-factor__row${group.thin ? ' is-thin' : ''}`} role="row">
                  <span role="cell">
                    {group.label}
                    {group.thin ? <span className="rh-thin">Thin</span> : null}
                  </span>
                  <span role="cell">{group.count}</span>
                  <span role="cell">{count(group.views)}</span>
                  <span role="cell">{rate(group.skipRate)}</span>
                  <span role="cell">{duration(group.watchMs)}</span>
                  <span role="cell">{count(group.shares)}</span>
                  <span role="cell">{count(group.saves)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {selectedStat ? (
        <Drawer label={selectedStat.label} wide onClose={() => setOpenStat(null)}>
          <StatDrill stat={selectedStat} />
        </Drawer>
      ) : null}
      {selectedReel ? (
        <Drawer label={selectedReel.title} wide onClose={() => setOpenReel(null)}>
          <ReelDrill reel={selectedReel} />
        </Drawer>
      ) : null}
    </>
  );
}

function StatDrill({ stat }: { stat: PerformanceStat }) {
  const how = stat.aggregate === 'sum'
    ? 'Latest total from each reel that reported it.'
    : 'Average of the reels that reported it.';
  return (
    <div className="rh-drill">
      <p className="rh-cap__kicker">How this number is built</p>
      <h2 className="rh-drill__title">{stat.label}</h2>
      <p className="rh-drill__result">{shownStat(stat)}</p>
      <p className="rh-muted">{stat.definition}</p>
      <p className="rh-muted">{how} {stat.reported} of {stat.total} reels reported it.</p>
      {stat.lines.length < stat.reported ? (
        <p className="rh-muted">Showing the highest {stat.lines.length}.</p>
      ) : null}
      <h3 className="rh-card__sub">Reels</h3>
      {stat.lines.length === 0 ? (
        <p className="rh-muted">No reels in this window.</p>
      ) : (
        <ul className="rh-drill__list rh-drill__list--metrics">
          {stat.lines.map((line) => (
            <li key={line.id}>
              <span className="rh-drill__name">{line.title}</span>
              <span className="rh-drill__usd">{shownMetric(line.value, stat.display)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReelDrill({ reel }: { reel: PerformanceReel }) {
  const peak = Math.max(1, ...reel.history.map((point) => point.views ?? 0));
  const song = songLine(reel);
  return (
    <div className="rh-drill">
      <h2 className="rh-drill__title">{reel.title}</h2>
      {reel.subtitle ? <p className="rh-muted">{reel.subtitle}</p> : null}
      <p className="rh-muted">{reel.slotLabel} · {when(reel.finishedAt)}</p>
      {reel.metrics?.sharedToFeed ? <p className="rh-grid-pill">On the grid</p> : null}
      <p>{gridNote(reel.metrics?.sharedToFeed ?? null)}</p>
      {reel.permalink ? (
        <p>
          <a className="rh-btn rh-btn--xs" href={reel.permalink} target="_blank" rel="noreferrer">
            Open on Instagram
          </a>
        </p>
      ) : null}
      {reel.videoJobId ? (
        <div className="rh-perf-player">
          <ReelVideo src={`/api/reels/video/${reel.videoJobId}`} controls sound />
        </div>
      ) : null}
      <dl className="rh-facts">
        {DRAWER_METRICS.map((item) => (
          <div key={item.field}>
            <dt>{item.label}</dt>
            <dd>{shownMetric(reel.metrics ? (reel.metrics[item.field] as number | null) : null, item.display)}</dd>
          </div>
        ))}
      </dl>
      <h3 className="rh-card__sub">Checks</h3>
      {reel.history.length === 0 ? (
        <p className="rh-muted">No checks yet.</p>
      ) : (
        <ul className="rh-spark">
          {reel.history.map((point) => (
            <li key={point.nyDate}>
              <span>{dayLabel(point.nyDate)}</span>
              <span className="rh-spark__track">
                <span style={{ width: `${Math.max(((point.views ?? 0) / peak) * 100, point.views ? 4 : 0)}%` }} />
              </span>
              <span>{count(point.views)}</span>
              <span>{rate(point.skipRate)}</span>
            </li>
          ))}
        </ul>
      )}
      {reel.onScreenCopy ? (
        <>
          <h3 className="rh-card__sub">On-screen copy</h3>
          <p className="rh-perf-copy">{reel.onScreenCopy}</p>
        </>
      ) : null}
      {reel.caption ? (
        <>
          <h3 className="rh-card__sub">Caption</h3>
          <p className="rh-perf-copy">{reel.caption}</p>
        </>
      ) : null}
      {song ? <p className="rh-muted">{song}</p> : null}
      <h3 className="rh-card__sub">How it was made</h3>
      <dl className="rh-facts">
        {creationFacts(reel).map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
