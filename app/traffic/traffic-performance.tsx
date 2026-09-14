'use client';

import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';

import { HeliosMenu } from '@/app/components/helios-menu';
import { HubLoadingSpinner } from '@/app/hub/hub-loading';
import { requestJson } from '@/lib/client-request';
import {
  formatCompactNumber,
  formatDeltaPercent,
  formatPagesPerVisitor,
} from '@/lib/traffic/format';
import type {
  TrafficDimension,
  TrafficDimensionRow,
  TrafficEnvironment,
  TrafficFilter,
  TrafficPeriod,
  TrafficSummaryResponse,
} from '@/lib/traffic/types';

import { CHART_METRICS, TrafficChart, type ChartMetric } from './traffic-chart';

const PERIODS: Array<[TrafficPeriod, string]> = [
  ['24h', '24 hours'],
  ['7d', '7 days'],
  ['28d', '28 days'],
  ['3m', '3 months'],
  ['custom', 'More'],
];

const ENV_OPTIONS = [
  { value: 'production', label: 'Production' },
  { value: 'preview', label: 'Preview' },
  { value: 'all', label: 'All environments' },
];

const UTM_OPTIONS: Array<[TrafficDimension, string]> = [
  ['utmSource', 'Source'],
  ['utmMedium', 'Medium'],
  ['utmCampaign', 'Campaign'],
];

const FILTER_LABEL: Record<TrafficDimension, string> = {
  requestPath: 'Page',
  route: 'Route',
  referrerHostname: 'Referrer',
  utmSource: 'UTM source',
  utmMedium: 'UTM medium',
  utmCampaign: 'UTM campaign',
  country: 'Country',
  deviceType: 'Device',
  browserName: 'Browser',
  osName: 'OS',
};

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

function Delta({ value }: { value: number | null }) {
  const label = formatDeltaPercent(value);
  if (!label) return <span className="stat-tile__delta">—</span>;
  const direction = (value ?? 0) > 0 ? 'up' : (value ?? 0) < 0 ? 'down' : 'flat';
  return (
    <span className={`stat-tile__delta${direction === 'flat' ? '' : ` stat-tile__delta--${direction}`}`}>
      {label}
    </span>
  );
}

function TrafficBarList({
  rows,
  totalVisitors,
  display,
  onSelect,
}: {
  rows: TrafficDimensionRow[];
  totalVisitors: number;
  display: 'count' | 'share';
  onSelect: (row: TrafficDimensionRow) => void;
}) {
  const max = Math.max(0, ...rows.map((row) => row.visitors));
  if (!rows.length) {
    return <p className="traffic-empty">No rows in this range.</p>;
  }
  return (
    <ul className="traffic-bars">
      {rows.map((row) => {
        const width = max > 0 ? (row.visitors / max) * 100 : 0;
        const share = totalVisitors > 0 ? (row.visitors / totalVisitors) * 100 : 0;
        const clickable = Boolean(row.key) && row.key !== 'Others';
        return (
          <li key={row.key || row.label}>
            <button
              type="button"
              className="traffic-bar list-row"
              disabled={!clickable}
              onClick={() => { if (clickable) onSelect(row); }}
            >
              <span className="traffic-bar__fill" style={{ width: `${width}%` }} aria-hidden="true" />
              <span className="traffic-bar__label" title={row.key || row.label}>{row.label}</span>
              <span className="traffic-bar__value">
                {display === 'share' ? `${Math.round(share)}%` : formatCompactNumber(row.visitors)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function PanelTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<[string, string]>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="segmented traffic-panel__tabs" role="tablist">
      {tabs.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          className={value === id ? 'segmented__item segmented__item--active' : 'segmented__item'}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function TrafficPerformance() {
  const [period, setPeriod] = useState<TrafficPeriod>('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [environment, setEnvironment] = useState<TrafficEnvironment>('production');
  const [filters, setFilters] = useState<TrafficFilter[]>([]);
  const [enabled, setEnabled] = useState<Record<ChartMetric, boolean>>({
    visitors: true,
    pageviews: true,
  });
  const [pathTab, setPathTab] = useState<'requestPath' | 'route'>('requestPath');
  const [sourceTab, setSourceTab] = useState<'referrerHostname' | 'utm'>('referrerHostname');
  const [utmDimension, setUtmDimension] = useState<TrafficDimension>('utmSource');
  const [deviceTab, setDeviceTab] = useState<'deviceType' | 'browserName'>('deviceType');
  const [summary, setSummary] = useState<TrafficSummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const rangeReady = period !== 'custom' || (Boolean(customFrom) && Boolean(customTo));

  const query = useMemo(() => {
    const params = new URLSearchParams({ period, environment });
    if (period === 'custom') {
      params.set('from', customFrom);
      params.set('to', customTo);
    }
    if (filters.length) params.set('filters', JSON.stringify(filters));
    return params;
  }, [customFrom, customTo, environment, filters, period]);

  useEffect(() => {
    if (!rangeReady) return;
    let cancelled = false;
    setLoading(true);
    void requestJson<TrafficSummaryResponse>(`/api/traffic/summary?${query.toString()}`)
      .then((data) => {
        if (cancelled) return;
        setSummary(data);
        setError(data.configured ? data.error : null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load Traffic');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, rangeReady]);

  function toggleMetric(metric: ChartMetric) {
    setEnabled((current) => {
      const next = { ...current, [metric]: !current[metric] };
      if (!CHART_METRICS.some((key) => next[key])) return current;
      return next;
    });
  }

  function setFilter(dimension: TrafficDimension, row: TrafficDimensionRow) {
    if (!row.key || row.key === 'Others') return;
    setFilters((current) => {
      const without = current.filter((item) => item.dimension !== dimension);
      return [...without, { dimension, value: row.key }];
    });
  }

  function removeFilter(dimension: TrafficDimension) {
    setFilters((current) => current.filter((item) => item.dimension !== dimension));
  }

  if (loading && !summary) {
    return <HubLoadingSpinner label="Loading Traffic" />;
  }

  const totals = summary?.totals ?? { visitors: 0, pageviews: 0, pagesPerVisitor: 0 };
  const deltas = summary?.deltas ?? { visitors: null, pageviews: null, pagesPerVisitor: null };
  const rangeLabel = formatRange(summary?.range);
  const breakdowns = summary?.breakdowns;
  const sourceRows = sourceTab === 'utm'
    ? (breakdowns?.[utmDimension as 'utmSource' | 'utmMedium' | 'utmCampaign'] ?? [])
    : (breakdowns?.referrerHostname ?? []);
  const sourceDimension: TrafficDimension = sourceTab === 'utm' ? utmDimension : 'referrerHostname';

  return (
    <main className="app-shell">
      <section className="card">
        <div className="card__header">
          <div>
            <div className="card__title">Traffic</div>
            <div className="card__subtitle">heliosgroup.ai · Vercel Web Analytics</div>
          </div>
          <div className="traffic-hub__meta">
            <span className="traffic-hub__sync">
              <i className="traffic-hub__sync-dot traffic-hub__sync-dot--live" aria-hidden="true" />
              Live from Vercel
            </span>
          </div>
        </div>

        <div className="card__body traffic-hub">
          {error && <p className="field__error">{error}</p>}
          {summary && !summary.configured && (
            <p className="traffic-empty">
              Add a Vercel team token in VERCEL_TOKEN, VERCEL_ORG_ID, and VERCEL_PROJECT_ID to load
              marketing-site traffic.
            </p>
          )}

          <div className="traffic-hub__toolbar">
            <div className="traffic-hub__field">
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
              <div className="traffic-hub__field">
                <span>Custom bounds</span>
                <div className="traffic-hub__dates">
                  <input className="helios-field-input" type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
                  <span>to</span>
                  <input className="helios-field-input" type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
                </div>
              </div>
            )}

            <HeliosMenu
              label="Environment"
              value={environment}
              options={ENV_OPTIONS}
              onChange={(next) => setEnvironment(next as TrafficEnvironment)}
            />

            {rangeLabel && <span className="traffic-hub__range">{rangeLabel}</span>}
          </div>

          {filters.length > 0 && (
            <div className="traffic-hub__chips">
              {filters.map((filter) => (
                <button
                  key={`${filter.dimension}:${filter.value}`}
                  type="button"
                  className="traffic-chip"
                  onClick={() => removeFilter(filter.dimension)}
                >
                  <span>{FILTER_LABEL[filter.dimension]}: {filter.value}</span>
                  <X size={12} aria-hidden="true" />
                </button>
              ))}
              <button type="button" className="traffic-chip traffic-chip--clear" onClick={() => setFilters([])}>
                Clear filters
              </button>
            </div>
          )}

          <div className="traffic-hub__kpis">
            <button
              type="button"
              className={`stat-tile traffic-metric-tile traffic-metric-tile--visitors${enabled.visitors ? '' : ' traffic-metric-tile--off'}`}
              aria-pressed={enabled.visitors}
              onClick={() => toggleMetric('visitors')}
            >
              <span className="traffic-metric-tile__head">
                <i className="traffic-metric-tile__dot" aria-hidden="true" />
                <span className="stat-tile__label">Visitors</span>
              </span>
              <span className="traffic-metric-tile__value-row">
                <span className="stat-tile__value">{formatCompactNumber(totals.visitors)}</span>
                <Delta value={deltas.visitors} />
              </span>
            </button>
            <button
              type="button"
              className={`stat-tile traffic-metric-tile traffic-metric-tile--pageviews${enabled.pageviews ? '' : ' traffic-metric-tile--off'}`}
              aria-pressed={enabled.pageviews}
              onClick={() => toggleMetric('pageviews')}
            >
              <span className="traffic-metric-tile__head">
                <i className="traffic-metric-tile__dot" aria-hidden="true" />
                <span className="stat-tile__label">Page views</span>
              </span>
              <span className="traffic-metric-tile__value-row">
                <span className="stat-tile__value">{formatCompactNumber(totals.pageviews)}</span>
                <Delta value={deltas.pageviews} />
              </span>
            </button>
            <div className="stat-tile traffic-metric-tile traffic-metric-tile--engagement">
              <span className="traffic-metric-tile__head">
                <i className="traffic-metric-tile__dot" aria-hidden="true" />
                <span className="stat-tile__label">Pages / visitor</span>
              </span>
              <span className="traffic-metric-tile__value-row">
                <span className="stat-tile__value">{formatPagesPerVisitor(totals.pagesPerVisitor)}</span>
                <Delta value={deltas.pagesPerVisitor} />
              </span>
            </div>
          </div>

          <TrafficChart series={summary?.series ?? []} enabled={enabled} />

          <div className="traffic-hub__panels">
            <section className="traffic-panel">
              <header className="traffic-panel__head">
                <PanelTabs
                  tabs={[['requestPath', 'Pages'], ['route', 'Routes']]}
                  value={pathTab}
                  onChange={(next) => setPathTab(next as 'requestPath' | 'route')}
                />
                <span className="traffic-panel__metric">Visitors</span>
              </header>
              <TrafficBarList
                rows={breakdowns?.[pathTab] ?? []}
                totalVisitors={totals.visitors}
                display="count"
                onSelect={(row) => setFilter(pathTab, row)}
              />
            </section>

            <section className="traffic-panel">
              <header className="traffic-panel__head">
                <PanelTabs
                  tabs={[['referrerHostname', 'Referrers'], ['utm', 'UTM']]}
                  value={sourceTab}
                  onChange={(next) => setSourceTab(next as 'referrerHostname' | 'utm')}
                />
                <span className="traffic-panel__metric">Visitors</span>
              </header>
              {sourceTab === 'utm' && (
                <div className="traffic-panel__sub">
                  <PanelTabs
                    tabs={UTM_OPTIONS}
                    value={utmDimension}
                    onChange={(next) => setUtmDimension(next as TrafficDimension)}
                  />
                </div>
              )}
              <TrafficBarList
                rows={sourceRows}
                totalVisitors={totals.visitors}
                display="count"
                onSelect={(row) => setFilter(sourceDimension, row)}
              />
            </section>
          </div>

          <div className="traffic-hub__panels traffic-hub__panels--trio">
            <section className="traffic-panel">
              <header className="traffic-panel__head">
                <span className="traffic-panel__title">Countries</span>
                <span className="traffic-panel__metric">Visitors</span>
              </header>
              <TrafficBarList
                rows={breakdowns?.country ?? []}
                totalVisitors={totals.visitors}
                display="share"
                onSelect={(row) => setFilter('country', row)}
              />
            </section>

            <section className="traffic-panel">
              <header className="traffic-panel__head">
                <PanelTabs
                  tabs={[['deviceType', 'Devices'], ['browserName', 'Browsers']]}
                  value={deviceTab}
                  onChange={(next) => setDeviceTab(next as 'deviceType' | 'browserName')}
                />
                <span className="traffic-panel__metric">Visitors</span>
              </header>
              <TrafficBarList
                rows={breakdowns?.[deviceTab] ?? []}
                totalVisitors={totals.visitors}
                display="share"
                onSelect={(row) => setFilter(deviceTab, row)}
              />
            </section>

            <section className="traffic-panel">
              <header className="traffic-panel__head">
                <span className="traffic-panel__title">Operating Systems</span>
                <span className="traffic-panel__metric">Visitors</span>
              </header>
              <TrafficBarList
                rows={breakdowns?.osName ?? []}
                totalVisitors={totals.visitors}
                display="share"
                onSelect={(row) => setFilter('osName', row)}
              />
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
