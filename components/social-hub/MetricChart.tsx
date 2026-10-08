'use client';

import { useMemo, useState } from 'react';

import type { MetricSnapshot } from '@/lib/social-hub/types';

type Option = { key: string; label: string; display: 'count' | 'duration' | 'rate' };

function show(value: number, display: Option['display']): string {
  if (display === 'rate') return `${(value * 100).toFixed(1)}%`;
  if (display === 'duration') return `${(value / 1000).toFixed(1)}s`;
  if (value >= 10_000) return `${(value / 1000).toFixed(1)}K`;
  return Math.round(value).toLocaleString('en-US');
}

const W = 600;
const H = 180;
const PAD = { top: 12, right: 12, bottom: 12, left: 12 };

/** Metrics over time (spec §6.4): one line from the daily snapshots; the metric is selectable. */
export function MetricChart({ history, options, initial }: { history: MetricSnapshot[]; options: Option[]; initial: string }) {
  const usable = options.filter((o) => history.some((h) => typeof h.metrics[o.key as keyof typeof h.metrics] === 'number'));
  const [key, setKey] = useState(usable.some((o) => o.key === initial) ? initial : usable[0]?.key ?? initial);
  const option = usable.find((o) => o.key === key) ?? usable[0];
  const points = useMemo(
    () => history
      .map((h) => ({ day: h.nyDate, value: h.metrics[key as keyof typeof h.metrics] }))
      .filter((p): p is { day: string; value: number } => typeof p.value === 'number' && Number.isFinite(p.value)),
    [history, key],
  );

  if (!option || points.length === 0) {
    return <p className="sh-muted">No numbers yet. Meta can take up to 48 hours to report a post.</p>;
  }
  const max = Math.max(...points.map((p) => p.value));
  const min = Math.min(0, ...points.map((p) => p.value));
  const span = max - min || 1;
  const x = (i: number) => PAD.left + (points.length === 1 ? (W - PAD.left - PAD.right) / 2 : (i * (W - PAD.left - PAD.right)) / (points.length - 1));
  const y = (v: number) => PAD.top + (1 - (v - min) / span) * (H - PAD.top - PAD.bottom);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const last = points[points.length - 1]!;

  return (
    <div className="sh-chart">
      <div className="sh-seg" role="group" aria-label="Metric shown">
        {usable.map((o) => (
          <button key={o.key} type="button" aria-pressed={o.key === key} onClick={() => setKey(o.key)}>{o.label}</button>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="sh-chart__svg" role="img"
        aria-label={`${option.label} by day: ${points.map((p) => `${p.day} ${show(p.value, option.display)}`).join(', ')}`}>
        <line x1={PAD.left} x2={W - PAD.right} y1={y(min)} y2={y(min)} className="sh-chart__axis" />
        <line x1={PAD.left} x2={W - PAD.right} y1={y(max)} y2={y(max)} className="sh-chart__grid" />
        <path d={path} className="sh-chart__line" />
        {points.map((p, i) => (
          <circle key={p.day} cx={x(i)} cy={y(p.value)} r={3.5} className="sh-chart__dot">
            <title>{`${p.day}: ${show(p.value, option.display)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="sh-chart__axisrow" aria-hidden="true">
        <span>{points[0]!.day}</span>
        <span>High {show(max, option.display)} · latest {show(last.value, option.display)}</span>
        <span>{last.day}</span>
      </div>
      <p className="sh-subtle">{points.length === 1 ? 'One daily snapshot so far.' : `${points.length} daily snapshots, lifetime totals as Meta reported them.`}</p>
    </div>
  );
}
