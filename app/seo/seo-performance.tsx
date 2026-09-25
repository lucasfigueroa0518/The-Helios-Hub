'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowUp, ChevronLeft, ChevronRight, Download, ExternalLink, RefreshCw, Search, X } from 'lucide-react';

import { HeliosMenu } from '@/app/components/helios-menu';
import { HubLoadingSpinner } from '@/app/hub/hub-loading';
import { requestJson } from '@/lib/client-request';
import {
  csvEscape,
  formatCompactNumber,
  formatCtr,
  formatPosition,
  propertyLabel,
} from '@/lib/seo/format';
import type {
  SeoBreakdownTab,
  SeoMetrics,
  SeoPeriod,
  SeoRowsResponse,
  SeoSearchType,
  SeoSummaryResponse,
} from '@/lib/seo/types';
import { SEO_SEARCH_TYPES } from '@/lib/seo/types';

import { CHART_METRICS, SeoChart, type ChartMetric } from './seo-chart';

const PERIODS: Array<[SeoPeriod, string]> = [
  ['24h', '24 hours'],
  ['7d', '7 days'],
  ['28d', '28 days'],
  ['3m', '3 months'],
  ['custom', 'More'],
];

const TABS: Array<[SeoBreakdownTab, string]> = [
  ['query', 'Queries'],
  ['page', 'Pages'],
  ['country', 'Countries'],
  ['device', 'Devices'],
  ['search_appearance', 'Search appearance'],
  ['date', 'Days'],
];

const SEARCH_TYPE_OPTIONS = SEO_SEARCH_TYPES.map((type) => ({
  value: type,
  label: type === 'googleNews' ? 'Google News' : type[0].toUpperCase() + type.slice(1),
}));

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100].map((size) => ({
  value: String(size),
  label: String(size),
}));

const TAB_LABEL: Record<SeoBreakdownTab, string> = {
  query: 'Top queries',
  page: 'Top pages',
  country: 'Country',
  device: 'Device',
  search_appearance: 'Search appearance',
  date: 'Day',
};

const FILTER_PLACEHOLDER: Record<SeoBreakdownTab, string> = {
  query: 'Filter queries…',
  page: 'Filter pages…',
  country: 'Filter countries…',
  device: 'Filter devices…',
  search_appearance: 'Filter appearance types…',
  date: 'Days cannot be filtered',
};

const METRIC_TILES: Array<{ metric: ChartMetric; label: string }> = [
  { metric: 'clicks', label: 'Total clicks' },
  { metric: 'impressions', label: 'Total impressions' },
  { metric: 'ctr', label: 'Average CTR' },
  { metric: 'position', label: 'Average position' },
];

type SortColumn = 'clicks' | 'impressions' | 'ctr' | 'position' | 'key';

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'Never synced';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Never synced';
  const hours = Math.max(0, Math.round((Date.now() - then) / 36e5));
  if (hours < 1) return 'Updated just now';
  if (hours === 1) return 'Updated 1 hour ago';
  if (hours < 48) return `Updated ${hours} hours ago`;
  return `Updated ${Math.round(hours / 24)} days ago`;
}

function formatRange(range: { from: string; to: string } | undefined): string | null {
  if (!range) return null;
  const from = new Date(`${range.from}T00:00:00.000Z`);
  const to = new Date(`${range.to}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  const base = { month: 'short', day: 'numeric', timeZone: 'UTC' } as const;
  const sameYear = from.getUTCFullYear() === to.getUTCFullYear();
  const left = from.toLocaleDateString('en-US', sameYear ? base : { ...base, year: 'numeric' });
  const right = to.toLocaleDateString('en-US', { ...base, year: 'numeric' });
  const days = Math.round((to.getTime() - from.getTime()) / 864e5) + 1;
  if (days === 1) return right;
  return `${left} – ${right} · ${days} days`;
}

function formatTotal(metric: ChartMetric, totals: SeoMetrics): string {
  if (metric === 'ctr') return formatCtr(totals.ctr);
  if (metric === 'position') return formatPosition(totals.position);
  return formatCompactNumber(totals[metric]);
}

function prettyPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || '/';
  } catch {
    return url;
  }
}

export function SeoPerformance() {
  const [period, setPeriod] = useState<SeoPeriod>('3m');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [searchType, setSearchType] = useState<SeoSearchType>('web');
  const [property, setProperty] = useState('');
  const [tab, setTab] = useState<SeoBreakdownTab>('query');
  const [enabled, setEnabled] = useState<Record<ChartMetric, boolean>>({
    clicks: true,
    impressions: true,
    ctr: false,
    position: false,
  });
  const [filterInput, setFilterInput] = useState('');
  const [filterValue, setFilterValue] = useState('');
  const [sort, setSort] = useState<SortColumn>('clicks');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [summary, setSummary] = useState<SeoSummaryResponse | null>(null);
  const [rows, setRows] = useState<SeoRowsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const rangeReady = period !== 'custom' || (Boolean(customFrom) && Boolean(customTo));

  const query = useMemo(() => {
    const params = new URLSearchParams({ period, type: searchType });
    if (property) params.set('property', property);
    if (period === 'custom') {
      params.set('from', customFrom);
      params.set('to', customTo);
    }
    return params;
  }, [customFrom, customTo, period, property, searchType]);

  useEffect(() => {
    const timer = setTimeout(() => setFilterValue(filterInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [filterInput]);

  useEffect(() => {
    if (!rangeReady) return;
    let cancelled = false;
    setLoading(true);
    void requestJson<SeoSummaryResponse>(`/api/seo/summary?${query.toString()}`)
      .then((data) => {
        if (cancelled) return;
        setSummary(data);
        if (!property && data.property) setProperty(data.property.site_url);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load SEO Performance');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [property, query, rangeReady]);

  useEffect(() => {
    if (!rangeReady) return;
    const params = new URLSearchParams(query);
    params.set('dimension', tab);
    params.set('sort', tab === 'date' && sort === 'clicks' ? 'key' : sort);
    params.set('dir', tab === 'date' && sort === 'clicks' ? 'desc' : dir);
    params.set('limit', String(pageSize));
    params.set('offset', String(page * pageSize));
    if (tab !== 'date' && filterValue) {
      params.set('filterDimension', tab);
      params.set('filter', filterValue);
    }
    let cancelled = false;
    void requestJson<SeoRowsResponse>(`/api/seo/rows?${params.toString()}`)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load breakdown');
      });
    return () => {
      cancelled = true;
    };
  }, [dir, filterValue, page, pageSize, query, rangeReady, sort, tab]);

  useEffect(() => {
    setPage(0);
    if (tab === 'date') {
      setSort('key');
      setDir('desc');
    } else {
      setSort('clicks');
      setDir('desc');
    }
  }, [tab, period, searchType, property, filterValue]);

  async function syncNow() {
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const queued = await requestJson<{ jobId?: string }>('/api/seo/sync', { method: 'POST' });
      const jobId = queued.jobId;
      const deadline = Date.now() + 90 * 60_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const status = await requestJson<{
          job?: { status: string; last_error_message: string | null } | null;
          sync: SeoSummaryResponse['sync'];
          progress?: { daysStored: number; newestDate: string | null };
        }>(jobId ? `/api/seo/sync?jobId=${encodeURIComponent(jobId)}` : '/api/seo/sync');
        const summaryData = await requestJson<SeoSummaryResponse>(`/api/seo/summary?${query.toString()}`);
        setSummary(summaryData);
        if (!property && summaryData.property) setProperty(summaryData.property.site_url);
        if (status.progress?.daysStored) {
          setNotice(`Pulling history… ${status.progress.daysStored} days stored${status.progress.newestDate ? ` through ${status.progress.newestDate}` : ''}`);
        }
        if (status.job?.status === 'failed') {
          throw new Error(status.job.last_error_message || status.sync?.error || 'Search Console sync failed');
        }
        if (status.job?.status === 'done' || (!jobId && status.sync?.status === 'succeeded')) {
          setNotice(null);
          return;
        }
      }
      throw new Error('Sync is still running on the worker. Refresh in a minute.');
    } catch (err) {
      setNotice(null);
      setError(err instanceof Error ? err.message : 'Unable to sync Search Console');
    } finally {
      setSyncing(false);
    }
  }

  function toggleMetric(metric: ChartMetric) {
    setEnabled((current) => {
      const next = { ...current, [metric]: !current[metric] };
      if (!CHART_METRICS.some((key) => next[key])) return current;
      return next;
    });
  }

  function toggleSort(column: SortColumn) {
    if (sort === column) setDir((current) => (current === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(column);
      setDir(column === 'key' ? 'asc' : 'desc');
    }
    setPage(0);
  }

  function exportCsv() {
    const header = [TAB_LABEL[tab], 'Clicks', 'Impressions', 'CTR', 'Position'];
    const lines = [
      header.map(csvEscape).join(','),
      ...(rows?.rows ?? []).map((row) => [
        csvEscape(row.label),
        row.clicks,
        row.impressions,
        row.ctr,
        row.position,
      ].join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `seo-${tab}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function sortHeader(column: SortColumn, label: string) {
    const active = sort === column;
    return (
      <button
        type="button"
        className={`seo-sort${active ? ' seo-sort--active' : ''}`}
        aria-label={`Sort by ${label}`}
        onClick={() => toggleSort(column)}
      >
        {label}
        <ArrowUp
          size={11}
          aria-hidden="true"
          className={`seo-sort__caret${active && dir === 'desc' ? ' seo-sort__caret--down' : ''}`}
        />
      </button>
    );
  }

  if (loading && !summary) {
    return <HubLoadingSpinner label="Loading SEO Performance" />;
  }

  const totals = summary?.totals ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  const pageCount = Math.max(1, Math.ceil((rows?.total ?? 0) / pageSize));
  const rangeLabel = formatRange(summary?.range);
  const visibleRows = rows?.rows ?? [];

  return (
    <main className="app-shell">
      <section className="card">
        <div className="card__header">
          <div>
            <div className="card__title">SEO Performance</div>
            <div className="card__subtitle">
              {(summary?.properties.length ?? 0) > 1 ? (
                <HeliosMenu
                  value={property}
                  options={(summary?.properties ?? []).map((item) => ({
                    value: item.site_url,
                    label: propertyLabel(item.site_url),
                  }))}
                  onChange={setProperty}
                />
              ) : (
                propertyLabel(property || summary?.property?.site_url || 'heliosgroup.ai')
              )}
            </div>
          </div>
          <div className="seo-hub__meta">
            <span className="seo-hub__sync">
              <i className={`seo-hub__sync-dot${syncing ? ' seo-hub__sync-dot--live' : ''}`} aria-hidden="true" />
              {syncing ? 'Syncing…' : relativeTime(summary?.lastSyncedAt ?? summary?.sync?.finished_at)}
            </span>
            <button type="button" className="seo-hub__action" onClick={() => void syncNow()} disabled={syncing}>
              <RefreshCw size={13} className={syncing ? 'seo-hub__action-spin' : undefined} />
              Sync now
            </button>
            <button type="button" className="seo-hub__action" onClick={exportCsv} disabled={!visibleRows.length}>
              <Download size={13} />
              Export
            </button>
          </div>
        </div>

        <div className="card__body seo-hub">
          {error && <p className="field__error">{error}</p>}
          {notice && <p className="field__notice">{notice}</p>}
          {summary?.sync?.status === 'failed' && summary.sync.error && (
            <p className="field__error">Last sync failed: {summary.sync.error}</p>
          )}
          {summary && !summary.property && (
            <p className="seo-empty">
              No Search Console properties in the warehouse yet. Click Sync now to pull
              heliosgroup.ai.
            </p>
          )}

          <div className="seo-hub__toolbar">
            <div className="seo-hub__field">
              <span>Date range</span>
              <div className="segmented">
                {PERIODS.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={period === value ? 'segmented__item segmented__item--active' : 'segmented__item'}
                    onClick={() => setPeriod(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {period === 'custom' && (
              <div className="seo-hub__field">
                <span>Custom bounds</span>
                <div className="seo-hub__dates">
                  <input className="helios-field-input" type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
                  <span>to</span>
                  <input className="helios-field-input" type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
                </div>
              </div>
            )}

            <HeliosMenu
              label="Search type"
              value={searchType}
              options={SEARCH_TYPE_OPTIONS}
              onChange={(next) => setSearchType(next as SeoSearchType)}
            />

            {rangeLabel && <span className="seo-hub__range">{rangeLabel}</span>}
          </div>

          <div className="seo-hub__kpis">
            {METRIC_TILES.map(({ metric, label }) => (
              <button
                key={metric}
                type="button"
                className={`stat-tile seo-metric-tile seo-metric-tile--${metric}${enabled[metric] ? '' : ' seo-metric-tile--off'}`}
                aria-pressed={enabled[metric]}
                onClick={() => toggleMetric(metric)}
              >
                <span className="seo-metric-tile__head">
                  <i className="seo-metric-tile__dot" aria-hidden="true" />
                  <span className="stat-tile__label">{label}</span>
                </span>
                <span className="stat-tile__value">{formatTotal(metric, totals)}</span>
              </button>
            ))}
          </div>

          <SeoChart series={summary?.series ?? []} enabled={enabled} />

          <div className="seo-hub__breakdown">
            <div className="seo-tabs" role="tablist">
              {TABS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  className={tab === value ? 'is-active' : undefined}
                  onClick={() => setTab(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className={`seo-search${filterInput ? ' seo-search--filled' : ''}`}>
              <Search size={13} aria-hidden="true" />
              <input
                type="text"
                aria-label={`Filter ${TAB_LABEL[tab].toLowerCase()}`}
                placeholder={FILTER_PLACEHOLDER[tab]}
                value={filterInput}
                disabled={tab === 'date'}
                onChange={(event) => setFilterInput(event.target.value)}
              />
              {filterInput && (
                <button type="button" aria-label="Clear filter" onClick={() => setFilterInput('')}>
                  <X size={13} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          <div className="seo-hub__table-wrap">
            <table className="data-table seo-table">
              <thead>
                <tr>
                  <th>{sortHeader('key', TAB_LABEL[tab])}</th>
                  <th className="data-table__num">{sortHeader('clicks', 'Clicks')}</th>
                  <th className="data-table__num">{sortHeader('impressions', 'Impressions')}</th>
                  <th className="data-table__num">{sortHeader('ctr', 'CTR')}</th>
                  <th className="data-table__num">{sortHeader('position', 'Position')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.key} className="data-table__row">
                    <td>
                      {tab === 'page' ? (
                        <a className="seo-table__link" href={row.key} target="_blank" rel="noreferrer" title={row.key}>
                          {prettyPath(row.key)}
                          <ExternalLink size={11} aria-hidden="true" />
                        </a>
                      ) : (
                        row.label
                      )}
                    </td>
                    <td className="data-table__num">{Math.round(row.clicks)}</td>
                    <td className="data-table__num">{Math.round(row.impressions)}</td>
                    <td className="data-table__num">{formatCtr(row.ctr)}</td>
                    <td className="data-table__num">{formatPosition(row.position)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visibleRows.length && (
              <p className="seo-empty">
                {filterValue
                  ? `No ${TAB_LABEL[tab].toLowerCase()} match “${filterValue}”.`
                  : tab === 'search_appearance'
                    ? 'No search appearance types in this range.'
                    : 'No rows for this breakdown yet.'}
              </p>
            )}
          </div>

          <div className="seo-pager">
            <HeliosMenu
              label="Rows per page"
              value={String(pageSize)}
              options={PAGE_SIZE_OPTIONS}
              onChange={(next) => { setPageSize(Number(next)); setPage(0); }}
            />
            <span className="seo-pager__count">
              {rows?.total
                ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, rows.total)} of ${rows.total}`
                : 'No rows'}
            </span>
            <button type="button" className="seo-pager__step" aria-label="Previous page" disabled={page <= 0} onClick={() => setPage((current) => current - 1)}>
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
            <button type="button" className="seo-pager__step" aria-label="Next page" disabled={page + 1 >= pageCount} onClick={() => setPage((current) => current + 1)}>
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
