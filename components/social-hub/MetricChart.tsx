'use client';

import { useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { Menu } from '@/components/social-hub/ui/Menu';
import type { MetricSnapshot } from '@/lib/social-hub/types';

type Option = { key: string; label: string; display: 'count' | 'duration' | 'rate'; typical?: Array<number | null> };

function show(value: number, display: Option['display']): string {
  if (display === 'rate') return `${(value * 100).toFixed(1)}%`;
  if (display === 'duration') return `${(value / 1000).toFixed(1)}s`;
  if (Math.abs(value) >= 999_950) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 10_000) return `${(value / 1000).toFixed(1)}K`;
  return Math.round(value).toLocaleString('en-US');
}

const W = 640;
const H = 200;
const PAD = { top: 16, right: 56, bottom: 24, left: 8 };

/**
 * A post's numbers over time (BRIEFS.md §4): its own line, the type's typical
 * path at the same age as a dashed reference, a crosshair with the values on
 * hover or focus. One metric at a time, chosen from a menu.
 */
export function MetricChart({ history, options, initial, accent }: { history: MetricSnapshot[]; options: Option[]; initial: string; accent: string }) {
  const usable = options.filter((o) => history.some((h) => typeof h.metrics[o.key as keyof typeof h.metrics] === 'number'));
  const [key, setKey] = useState(usable.some((o) => o.key === initial) ? initial : usable[0]?.key ?? initial);
  const [hover, setHover] = useState<number | null>(null);
  const option = usable.find((o) => o.key === key) ?? usable[0];
  const points = useMemo(
    () => history.map((h, i) => ({ i, day: h.nyDate, value: h.metrics[key as keyof typeof h.metrics] as number | null | undefined, typical: option?.typical?.[i] ?? null })),
    [history, key, option],
  );

  if (!option || !points.some((p) => typeof p.value === 'number')) {
    return <p className="sh-muted">No numbers yet. Instagram can take up to 48 hours to report a post.</p>;
  }
  const values = points.flatMap((p) => [p.value, p.typical]).filter((v): v is number => typeof v === 'number');
  const max = Math.max(...values) || 1;
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const x = (i: number) => PAD.left + (points.length === 1 ? (W - PAD.left - PAD.right) / 2 : (i * (W - PAD.left - PAD.right)) / (points.length - 1));
  const y = (v: number) => PAD.top + (1 - (v - min) / span) * (H - PAD.top - PAD.bottom);
  const path = (get: (p: (typeof points)[number]) => number | null | undefined) => {
    let d = '';
    let pen = false;
    for (const p of points) {
      const v = get(p);
      if (typeof v !== 'number') {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const own = points.filter((p) => typeof p.value === 'number');
  const last = own[own.length - 1]!;
  const lastTypical = [...points].reverse().find((p) => typeof p.typical === 'number');
  const at = hover != null ? points[hover] : null;
  const label = (i: number) => (i === 0 ? 'Posting day' : `Day ${i + 1}`);
  const dayAt = (e: ReactPointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const rel = ((e.clientX - box.left) / box.width) * W;
    const step = points.length > 1 ? (W - PAD.left - PAD.right) / (points.length - 1) : 1;
    return Math.max(0, Math.min(points.length - 1, Math.round((rel - PAD.left) / step)));
  };

  return (
    <div className="sh-chart">
      <div className="sh-chart__bar">
        <span className="sh-chart__legend">
          <span className="sh-chart__key" style={{ background: accent }} aria-hidden="true" />This post
          {lastTypical ? <><span className="sh-chart__key sh-chart__key--typical" aria-hidden="true" />Typical for its type</> : null}
        </span>
        {usable.length > 1 ? <Menu label="Metric" value={key} options={usable.map((o) => ({ value: o.key, label: o.label }))} onSelect={setKey} /> : null}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="sh-chart__svg"
        role="img"
        aria-label={`${option.label} by day since posting: ${own.map((p) => `${label(p.i)} ${show(p.value as number, option.display)}`).join(', ')}`}
        // Pointer events, so a tap on a phone pins a day the way a hover does on desktop.
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') setHover(null);
        }}
        onPointerMove={(e) => setHover(dayAt(e))}
        onPointerDown={(e) => setHover(dayAt(e))}
      >
        <line x1={PAD.left} x2={W - PAD.right} y1={y(min)} y2={y(min)} className="sh-chart__axis" />
        <line x1={PAD.left} x2={W - PAD.right} y1={y(max)} y2={y(max)} className="sh-chart__grid" />
        <text x={W - PAD.right + 6} y={y(max) + 4} className="sh-chart__tick">{show(max, option.display)}</text>
        {lastTypical ? <path d={path((p) => p.typical)} className="sh-chart__typical" /> : null}
        <path d={path((p) => p.value)} className="sh-chart__line" style={{ stroke: accent }} />
        {own.length === 1 ? <circle cx={x(last.i)} cy={y(last.value as number)} r={4} style={{ fill: accent }} /> : null}
        <text x={x(last.i) + 6} y={y(last.value as number) - 6} className="sh-chart__end">{show(last.value as number, option.display)}</text>
        {at ? (
          <g>
            <line x1={x(at.i)} x2={x(at.i)} y1={PAD.top} y2={H - PAD.bottom} className="sh-chart__cross" />
            {typeof at.value === 'number' ? <circle cx={x(at.i)} cy={y(at.value)} r={4} className="sh-chart__dot" style={{ stroke: accent }} /> : null}
          </g>
        ) : null}
      </svg>
      <div className="sh-chart__foot" aria-live="polite">
        {at ? (
          <span>
            <strong>{label(at.i)}</strong> · {typeof at.value === 'number' ? show(at.value, option.display) : 'not reported'}
            {typeof at.typical === 'number' ? ` · typical ${show(at.typical, option.display)}` : ''}
          </span>
        ) : (
          <span>{own.length === 1 ? 'One daily reading so far.' : `${own.length} daily readings, lifetime totals as Instagram reported them.`}</span>
        )}
      </div>
    </div>
  );
}
