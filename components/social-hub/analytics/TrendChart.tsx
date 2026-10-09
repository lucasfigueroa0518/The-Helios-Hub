'use client';

import { useState, type PointerEvent as ReactPointerEvent } from 'react';

type Series = { vertical: string; label: string; values: Array<number | null> };

function show(v: number, display: 'count' | 'duration' | 'rate'): string {
  if (display === 'rate') return `${(v * 100).toFixed(1)}%`;
  if (display === 'duration') return `${(v / 1000).toFixed(1)}s`;
  if (Math.abs(v) >= 999_950) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 10_000) return `${(v / 1000).toFixed(1)}K`;
  return Math.round(v).toLocaleString('en-US');
}

const W = 960;
const H = 240;
const PAD = { top: 16, right: 120, bottom: 28, left: 8 };

function dayLabel(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * One line per content type (dataviz: fixed type order and hues, 2px lines,
 * direct labels at the line ends, a crosshair with every value on hover).
 */
export function TrendChart({ days, series, display, metricLabel }: { days: string[]; series: Series[]; display: 'count' | 'duration' | 'rate'; metricLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  if (values.length === 0 || days.length < 2) return <p className="sh-muted">Not enough days in this range to draw a trend.</p>;
  const max = Math.max(...values) || 1;
  const x = (i: number) => PAD.left + (i / (days.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom);
  const path = (vals: Array<number | null>) => {
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  // Direct labels at each line's last point, nudged apart so they don't collide.
  const ends = series
    .map((s) => {
      const i = s.values.map((v, k) => (v == null ? -1 : k)).filter((k) => k >= 0).at(-1);
      return i == null ? null : { s, y: y(s.values[i]!), i };
    })
    .filter((e): e is { s: Series; y: number; i: number } => e != null)
    .sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) if (ends[k]!.y - ends[k - 1]!.y < 14) ends[k]!.y = ends[k - 1]!.y + 14;
  const ticks = [0, Math.floor((days.length - 1) / 2), days.length - 1];
  const dayAt = (e: ReactPointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const rel = ((e.clientX - box.left) / box.width) * W;
    return Math.max(0, Math.min(days.length - 1, Math.round(((rel - PAD.left) / (W - PAD.left - PAD.right)) * (days.length - 1))));
  };

  return (
    <div
      className="sh-trend"
      tabIndex={0}
      role="group"
      aria-label={`${metricLabel} by day, one line per content type. Use the left and right arrow keys to step through days.`}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Escape') return;
        e.preventDefault();
        if (e.key === 'Escape') return setHover(null);
        const step = e.key === 'ArrowLeft' ? -1 : 1;
        setHover((h) => Math.max(0, Math.min(days.length - 1, h == null ? (step > 0 ? 0 : days.length - 1) : h + step)));
      }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="sh-trend__svg"
        role="img"
        aria-hidden="true"
        // Pointer events, so a tap on a phone pins a day the way a hover does on desktop.
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') setHover(null);
        }}
        onPointerMove={(e) => setHover(dayAt(e))}
        onPointerDown={(e) => setHover(dayAt(e))}
      >
        <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} className="sh-chart__axis" />
        <line x1={PAD.left} x2={W - PAD.right} y1={y(max)} y2={y(max)} className="sh-chart__grid" />
        <text x={PAD.left} y={y(max) - 4} className="sh-chart__tick">{show(max, display)}</text>
        {ticks.map((t) => <text key={t} x={x(t)} y={H - 8} className="sh-chart__tick" textAnchor={t === 0 ? 'start' : t === days.length - 1 ? 'end' : 'middle'}>{dayLabel(days[t]!)}</text>)}
        {series.map((s) => <path key={s.vertical} d={path(s.values)} fill="none" stroke={`var(--sh-v-${s.vertical})`} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />)}
        {ends.map((e) => (
          <g key={e.s.vertical}>
            <circle cx={x(e.i)} cy={y(e.s.values[e.i]!)} r="3" fill={`var(--sh-v-${e.s.vertical})`} />
            {/* A leader from the line's end to its label, so nudged labels still point at their line. */}
            <polyline
              points={`${x(e.i) + 4},${y(e.s.values[e.i]!)} ${W - PAD.right + 4},${y(e.s.values[e.i]!)} ${W - PAD.right + 8},${e.y}`}
              fill="none"
              stroke={`var(--sh-v-${e.s.vertical})`}
              strokeWidth="1"
              opacity="0.6"
            />
            <text x={W - PAD.right + 10} y={e.y + 4} className="sh-trend__label">{e.s.label}</text>
          </g>
        ))}
        {hover != null ? (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} className="sh-chart__cross" />
            {series.map((s) => (s.values[hover] != null ? <circle key={s.vertical} cx={x(hover)} cy={y(s.values[hover]!)} r="4" fill="var(--color-surface)" stroke={`var(--sh-v-${s.vertical})`} strokeWidth="2" /> : null))}
          </g>
        ) : null}
      </svg>
      {/* On a phone the chart's own labels are too small to read, so the key and the span move out here. */}
      <ul className="sh-trend__key" aria-hidden="true">
        {series.map((s) => (
          <li key={s.vertical}><span className="sh-type__dot" style={{ background: `var(--sh-v-${s.vertical})` }} />{s.label}</li>
        ))}
        <li className="sh-trend__span">{dayLabel(days[0]!)} – {dayLabel(days[days.length - 1]!)}</li>
      </ul>
      <div className="sh-trend__foot" aria-live="polite">
        {hover != null ? (
          <>
            <strong>{dayLabel(days[hover]!)}</strong>
            {series.map((s) => (
              <span key={s.vertical} className="sh-trend__val">
                <span className="sh-type__dot" style={{ background: `var(--sh-v-${s.vertical})` }} aria-hidden="true" />
                {s.label} {s.values[hover] != null ? show(s.values[hover]!, display) : '—'}
              </span>
            ))}
          </>
        ) : (
          <span>{metricLabel} by the day each post went out. Hover or tap for a day’s numbers.</span>
        )}
      </div>
    </div>
  );
}
