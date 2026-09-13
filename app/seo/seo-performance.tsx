'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';

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
  SeoPeriod,
  SeoRowsResponse,
  SeoSearchType,
  SeoSummaryResponse,
} from '@/lib/seo/types';
import { SEO_SEARCH_TYPES } from '@/lib/seo/types';

import { SeoChart, type ChartMetric } from './seo-chart';

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

const FILTER_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'query', label: 'Query' },
  { value: 'page', label: 'Page' },
  { value: 'country', label: 'Country' },
  { value: 'device', label: 'Device' },
];

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

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'Never synced';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Never synced';
  const hours = Math.max(0, Math.round((Date.now() - then) / 36e5));
  if (hours < 1) return 'Last update: just now';
  if (hours === 1) return 'Last update: 1 hour ago';
  return `Last update: ${hours} hours ago`;
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
  const [filterDimension, setFilterDimension] = useState<'query' | 'page' | 'country' | 'device' | ''>('');
  const [filterValue, setFilterValue] = useState('');
  const [sort, setSort] = useState<'clicks' | 'impressions' | 'ctr' | 'position' | 'key'>('clicks');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [summary, setSummary] = useState<SeoSummaryResponse | null>(null);
  const [rows, setRows] = useState<SeoRowsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    if (filterDimension && filterValue.trim()) {
      params.set('filterDimension', filterDimension);
      params.set('filter', filterValue.trim());
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
  }, [dir, filterDimension, filterValue, page, pageSize, query, rangeReady, sort, tab]);

  useEffect(() => {
    setPage(0);
    if (tab === 'date') {
      setSort('key');
      setDir('desc');
    } else {
      setSort('clicks');
      setDir('desc');
    }
  }, [tab, period, searchType, property, filterDimension, filterValue]);

  async function syncNow() {
    setSyncing(true);
    setError(null);
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
          setError(`Pulling history… ${status.progress.daysStored} days stored${status.progress.newestDate ? ` through ${status.progress.newestDate}` : ''}`);
        }
        if (status.job?.status === 'failed') {
          throw new Error(status.job.last_error_message || status.sync?.error || 'Search Console sync failed');
        }
        if (status.job?.status === 'done' || (!jobId && status.sync?.status === 'succeeded')) {
          setError(null);
          return;
        }
      }
      throw new Error('Sync is still running on the worker. Refresh in a minute.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sync Search Console');
    } finally {
      setSyncing(false);
    }
  }

  function toggleMetric(metric: ChartMetric) {
    setEnabled((current) => {
      const next = { ...current, [metric]: !current[metric] };
      if (!next.clicks && !next.impressions && !next.ctr && !next.position) {
        return current;
      }
      return next;
    });
  }

  function toggleSort(column: 'clicks' | 'impressions' | 'ctr' | 'position' | 'key') {
    if (sort === column) setDir((current) => (current === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(column);
      setDir(column === 'key' ? 'asc' : 'desc');
    }
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

  if (loading && !summary) {
    return <HubLoadingSpinner label="Loading SEO Performance" />;
  }

  const totals = summary?.totals ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  const pageCount = Math.max(1, Math.ceil((rows?.total ?? 0) / pageSize));

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
            <span className="seo-hub__sync">{relativeTime(summary?.lastSyncedAt ?? summary?.sync?.finished_at)}</span>
            <button type="button" className="btn btn--quiet" onClick={() => void syncNow()} disabled={syncing}>
              <RefreshCw size={14} />
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
            <button type="button" className="btn btn--quiet" onClick={exportCsv} disabled={!rows?.rows.length}>
              <Download size={14} />
              Export
            </button>
          </div>
        </div>

        <div className="card__body seo-hub">
          {error && <p className="field__error">{error}</p>}
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
                <div className="analytics-hub__dates">
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

            <div className="seo-hub__filter">
              <HeliosMenu
                label="Filter"
                value={filterDimension}
                options={FILTER_OPTIONS}
                onChange={(next) => setFilterDimension(next as typeof filterDimension)}
              />
              <label className="seo-hub__field seo-hub__field--grow">
                <span>Contains</span>
                <input
                  className="helios-field-input"
                  type="text"
                  placeholder="Contains…"
                  value={filterValue}
                  disabled={!filterDimension}
                  onChange={(event) => setFilterValue(event.target.value)}
                />
              </label>
            </div>
          </div>

          <div className="seo-hub__kpis">
            <button
              type="button"
              className={`stat-tile${enabled.clicks ? ' stat-tile--active' : ' stat-tile--off'}`}
              aria-pressed={enabled.clicks}
              onClick={() => toggleMetric('clicks')}
            >
              <span className="stat-tile__label">Total clicks</span>
              <span className="stat-tile__value">{formatCompactNumber(totals.clicks)}</span>
            </button>
            <button
              type="button"
              className={`stat-tile stat-tile--warning${enabled.impressions ? ' stat-tile--active' : ' stat-tile--off'}`}
              aria-pressed={enabled.impressions}
              onClick={() => toggleMetric('impressions')}
            >
              <span className="stat-tile__label">Total impressions</span>
              <span className="stat-tile__value">{formatCompactNumber(totals.impressions)}</span>
            </button>
            <button
              type="button"
              className={`stat-tile stat-tile--positive${enabled.ctr ? ' stat-tile--active' : ' stat-tile--off'}`}
              aria-pressed={enabled.ctr}
              onClick={() => toggleMetric('ctr')}
            >
              <span className="stat-tile__label">Average CTR</span>
              <span className="stat-tile__value">{formatCtr(totals.ctr)}</span>
            </button>
            <button
              type="button"
              className={`stat-tile${enabled.position ? ' stat-tile--active' : ' stat-tile--off'}`}
              aria-pressed={enabled.position}
              onClick={() => toggleMetric('position')}
            >
              <span className="stat-tile__label">Average position</span>
              <span className="stat-tile__value">{formatPosition(totals.position)}</span>
            </button>
          </div>

          <SeoChart series={summary?.series ?? []} enabled={enabled} />

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

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>
                    <button type="button" className="btn btn--quiet" onClick={() => toggleSort('key')}>
                      {TAB_LABEL[tab]}
                    </button>
                  </th>
                  <th className="data-table__num">
                    <button type="button" className="btn btn--quiet" onClick={() => toggleSort('clicks')}>
                      Clicks
                    </button>
                  </th>
                  <th className="data-table__num">
                    <button type="button" className="btn btn--quiet" onClick={() => toggleSort('impressions')}>
                      Impressions
                    </button>
                  </th>
                  {(enabled.ctr || enabled.position) && (
                    <th className="data-table__num">
                      <button type="button" className="btn btn--quiet" onClick={() => toggleSort('ctr')}>
                        CTR
                      </button>
                    </th>
                  )}
                  {(enabled.ctr || enabled.position) && (
                    <th className="data-table__num">
                      <button type="button" className="btn btn--quiet" onClick={() => toggleSort('position')}>
                        Position
                      </button>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {(rows?.rows ?? []).map((row) => (
                  <tr key={row.key} className="data-table__row">
                    <td>{row.label}</td>
                    <td className="data-table__num">{Math.round(row.clicks)}</td>
                    <td className="data-table__num">{Math.round(row.impressions)}</td>
                    {(enabled.ctr || enabled.position) && (
                      <td className="data-table__num">{formatCtr(row.ctr)}</td>
                    )}
                    {(enabled.ctr || enabled.position) && (
                      <td className="data-table__num">{formatPosition(row.position)}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows?.rows.length && (
              <p className="seo-empty">
                {tab === 'search_appearance'
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
            <span>
              {rows?.total ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, rows.total)} of ${rows.total}` : '0'}
            </span>
            <button type="button" className="btn btn--quiet" disabled={page <= 0} onClick={() => setPage((current) => current - 1)}>
              Prev
            </button>
            <button type="button" className="btn btn--quiet" disabled={page + 1 >= pageCount} onClick={() => setPage((current) => current + 1)}>
              Next
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
