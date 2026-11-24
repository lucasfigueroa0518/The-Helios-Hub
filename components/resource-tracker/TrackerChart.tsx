'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * The Resource Tracker's one chart (dataviz skill): bars, stacked bars or lines over days, one y axis, recessive
 * grid, 4px rounded bar ends on the baseline, 2px lines, a 2px surface gap between stacked segments, a legend for
 * two or more series plus direct end labels on lines, a crosshair tooltip on hover, and a table view (the series
 * colors sit under 3:1 contrast on white, so values are always one click away as text).
 */
export type ChartSeries = { key: string; label: string; color: string; values: (number | null)[] };

type Props = {
  title: string;
  subtitle?: string;
  dates: string[];
  series: ChartSeries[];
  kind: 'bars' | 'stacked' | 'lines';
  /** A fixed top for the y axis (e.g. 5 for scores); otherwise a nice max from the data. */
  yMax?: number;
  format?: (n: number) => string;
  /** More rows for the tooltip and table, per day index. */
  extra?: (i: number) => Array<[string, string]>;
  emptyText?: string;
  height?: number;
};

const PAD = { top: 12, right: 12, bottom: 26, left: 40 };
const fmtDefault = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(1));

export function shortDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  if (v <= 5) return Math.ceil(v);
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** A bar with 4px rounded data end and a square base on the baseline. */
function barPath(x: number, y: number, w: number, h: number, round: boolean): string {
  if (h <= 0) return '';
  const r = round ? Math.min(4, w / 2, h) : 0;
  return `M${x},${y + h}V${y + r}${r ? `Q${x},${y} ${x + r},${y}` : ''}H${x + w - r}${r ? `Q${x + w},${y} ${x + w},${y + r}` : ''}V${y + h}Z`;
}

export function TrackerChart({ title, subtitle, dates, series, kind, yMax, format = fmtDefault, extra, emptyText = 'Nothing in this range yet.', height = 220 }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const lines = kind === 'lines';
  const right = lines && series.length > 1 ? 84 : PAD.right;
  const n = dates.length;
  const plotW = Math.max(40, width - PAD.left - right);
  const plotH = height - PAD.top - PAD.bottom;
  const band = n ? plotW / n : plotW;

  const { top, ticks } = useMemo(() => {
    const totals = dates.map((_, i) => (kind === 'stacked' ? series.reduce((s, x) => s + (x.values[i] ?? 0), 0) : Math.max(0, ...series.map((x) => x.values[i] ?? 0))));
    const t = yMax ?? niceMax(Math.max(0, ...totals));
    const step = t <= 5 ? 1 : t / 4;
    return { top: t, ticks: Array.from({ length: Math.round(t / step) + 1 }, (_, k) => k * step) };
  }, [dates, series, kind, yMax]);

  const y = (v: number) => PAD.top + plotH - (Math.min(v, top) / top) * plotH;
  const xMid = (i: number) => PAD.left + band * i + band / 2;
  const hasData = series.some((s) => s.values.some((v) => v !== null && v > 0));
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 64))));
  const barW = Math.max(2, Math.min(28, band * 0.62));

  const tipRows = (i: number): Array<[string, string, string | null]> => [
    ...series.map((s): [string, string, string | null] => [s.label, s.values[i] === null ? '—' : format(s.values[i]!), s.color]),
    ...(extra ? extra(i).map(([k, v]): [string, string, string | null] => [k, v, null]) : []),
  ];

  return (
    <section className="rt-chart" aria-label={title}>
      <header className="rt-chart__head">
        <div>
          <h3 className="rt-chart__title">{title}</h3>
          {subtitle ? <p className="rt-chart__sub">{subtitle}</p> : null}
        </div>
        <div className="rt-chart__tools">
          {series.length > 1 ? (
            <ul className="rt-legend">
              {series.map((s) => (
                <li key={s.key}><i style={{ background: s.color }} aria-hidden="true" />{s.label}</li>
              ))}
            </ul>
          ) : null}
          <button type="button" className="rt-linkbtn" onClick={() => setTable((t) => !t)} aria-pressed={table}>
            {table ? 'Chart' : 'Table'}
          </button>
        </div>
      </header>

      {table ? (
        <div className="rt-tablewrap">
          <table className="rt-table">
            <thead>
              <tr><th scope="col">Day</th>{tipRows(0).map(([k]) => <th key={k} scope="col">{k}</th>)}</tr>
            </thead>
            <tbody>
              {dates.map((d, i) => (
                <tr key={d}><th scope="row">{shortDate(d)}</th>{tipRows(i).map(([k, v]) => <td key={k}>{v}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={wrap} className="rt-chart__plot" onMouseLeave={() => setHover(null)}>
          {!hasData ? <p className="rt-chart__empty">{emptyText}</p> : null}
          <svg width={width} height={height} role="img" aria-label={`${title}, ${n} days`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} className={t === 0 ? 'rt-axis' : 'rt-grid'} />
                <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="rt-tick">{format(t)}</text>
              </g>
            ))}
            {dates.map((d, i) => (i % labelEvery === 0 || i === n - 1) && (i === n - 1 || n - 1 - i >= labelEvery / 2) ? (
              <text key={d} x={xMid(i)} y={height - 8} textAnchor="middle" className="rt-tick">{shortDate(d)}</text>
            ) : null)}

            {hover !== null ? <line x1={xMid(hover)} x2={xMid(hover)} y1={PAD.top} y2={PAD.top + plotH} className="rt-crosshair" /> : null}

            {kind !== 'lines'
              ? dates.map((d, i) => {
                  let base = 0;
                  const segs = kind === 'stacked' ? series : series.slice(0, 1);
                  const last = segs.map((s) => (s.values[i] ?? 0) > 0).lastIndexOf(true);
                  return (
                    <g key={d} opacity={hover === null || hover === i ? 1 : 0.55}>
                      {segs.map((s, k) => {
                        const v = s.values[i] ?? 0;
                        if (v <= 0) return null;
                        const y0 = y(base);
                        const y1 = y(base + v);
                        base += v;
                        const gap = k > 0 ? 2 : 0; // 2px surface gap between stacked segments
                        return <path key={s.key} d={barPath(xMid(i) - barW / 2, y1, barW, y0 - y1 - gap, k === last)} fill={s.color} />;
                      })}
                    </g>
                  );
                })
              : series.map((s) => {
                  const pts = s.values.map((v, i) => (v === null ? null : [xMid(i), y(v)] as const));
                  const d = pts.reduce((acc, p, i) => (p ? `${acc}${acc && pts[i - 1] ? 'L' : 'M'}${p[0]},${p[1]}` : acc), '');
                  const lastIdx = pts.map(Boolean).lastIndexOf(true);
                  return (
                    <g key={s.key}>
                      <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                      {pts.map((p, i) => (p && (n <= 31 || i === hover) ? (
                        <circle key={i} cx={p[0]} cy={p[1]} r={hover === i ? 5 : 4} fill={s.color} stroke="var(--color-surface)" strokeWidth={2} />
                      ) : null))}
                      {series.length > 1 && lastIdx >= 0 ? (
                        <text x={pts[lastIdx]![0] + 10} y={pts[lastIdx]![1]} dy="0.32em" className="rt-endlabel">{s.label}</text>
                      ) : null}
                    </g>
                  );
                })}

            {dates.map((d, i) => (
              <rect key={d} x={PAD.left + band * i} y={PAD.top} width={band} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
            ))}
          </svg>
          {hover !== null ? (
            <div className="rt-tip" role="status" style={{ left: Math.min(Math.max(xMid(hover), 90), width - 90) }}>
              <div className="rt-tip__date">{shortDate(dates[hover]!)}</div>
              <dl>
                {tipRows(hover).map(([k, v, c]) => (
                  <div key={k}><dt>{c ? <i style={{ background: c }} aria-hidden="true" /> : null}{k}</dt><dd>{v}</dd></div>
                ))}
              </dl>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
