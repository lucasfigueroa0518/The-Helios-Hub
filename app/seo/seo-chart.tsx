'use client';

import { useMemo } from 'react';

import { formatCompactNumber, formatCtr, formatPosition } from '@/lib/seo/format';
import type { SeoDailyPoint } from '@/lib/seo/types';

export type ChartMetric = 'clicks' | 'impressions' | 'ctr' | 'position';

const SERIES: Record<ChartMetric, { label: string; colorVar: string }> = {
  clicks: { label: 'Clicks', colorVar: 'var(--color-primary)' },
  impressions: { label: 'Impressions', colorVar: 'var(--chart-4, #7c3aed)' },
  ctr: { label: 'Avg. CTR', colorVar: 'var(--color-positive)' },
  position: { label: 'Avg. position', colorVar: 'var(--color-warning)' },
};

function scale(value: number, min: number, max: number): number {
  if (max <= min) return 0.5;
  return (value - min) / (max - min);
}

export function SeoChart({
  series,
  enabled,
}: {
  series: SeoDailyPoint[];
  enabled: Record<ChartMetric, boolean>;
}) {
  const width = 720;
  const height = 220;
  const pad = { top: 16, right: 48, bottom: 28, left: 48 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const paths = useMemo(() => {
    if (series.length === 0) return [];
    const xs = series.map((_, index) => (
      series.length === 1 ? innerW / 2 : (index / (series.length - 1)) * innerW
    ));
    return (Object.keys(SERIES) as ChartMetric[])
      .filter((key) => enabled[key])
      .map((key) => {
        const values = series.map((point) => Number(point[key] ?? 0));
        const min = key === 'position' ? Math.min(...values, 1) : 0;
        const max = Math.max(...values, key === 'ctr' ? 0.05 : 1);
        const points = values.map((value, index) => {
          const x = pad.left + xs[index];
          const y = pad.top + innerH - scale(value, min, max) * innerH;
          return `${x},${y}`;
        });
        return { key, d: `M ${points.join(' L ')}`, color: SERIES[key].colorVar };
      });
  }, [enabled, innerH, innerW, series]);

  const clicksMax = Math.max(...series.map((point) => point.clicks), 1);
  const impressionsMax = Math.max(...series.map((point) => point.impressions), 1);
  const last = series[series.length - 1];
  const first = series[0];

  if (series.length === 0) {
    return <div className="seo-chart seo-chart--empty">No daily totals in this range yet.</div>;
  }

  return (
    <div className="seo-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Search performance over time">
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={height - pad.bottom}
          y2={height - pad.bottom}
          className="seo-chart__axis"
        />
        {[0.25, 0.5, 0.75].map((frac) => (
          <line
            key={frac}
            x1={pad.left}
            x2={width - pad.right}
            y1={pad.top + innerH * (1 - frac)}
            y2={pad.top + innerH * (1 - frac)}
            className="seo-chart__grid"
          />
        ))}
        {paths.map((path) => (
          <path key={path.key} d={path.d} fill="none" stroke={path.color} strokeWidth="2" />
        ))}
        <text x={pad.left} y={12} className="seo-chart__axis-label">
          {formatCompactNumber(clicksMax)}
        </text>
        <text x={width - pad.right} y={12} className="seo-chart__axis-label seo-chart__axis-label--right">
          {formatCompactNumber(impressionsMax)}
        </text>
        {first && (
          <text x={pad.left} y={height - 6} className="seo-chart__axis-label">
            {first.date.slice(5)}
          </text>
        )}
        {last && (
          <text x={width - pad.right} y={height - 6} className="seo-chart__axis-label seo-chart__axis-label--right">
            {last.date.slice(5)}
          </text>
        )}
      </svg>
      <div className="seo-chart__legend">
        {(Object.keys(SERIES) as ChartMetric[]).filter((key) => enabled[key]).map((key) => (
          <span key={key} className="seo-chart__legend-item">
            <i style={{ background: SERIES[key].colorVar }} />
            {SERIES[key].label}
            {last ? (
              <em>
                {key === 'ctr'
                  ? formatCtr(last.ctr)
                  : key === 'position'
                    ? formatPosition(last.position)
                    : formatCompactNumber(last[key])}
              </em>
            ) : null}
          </span>
        ))}
      </div>
    </div>
  );
}
