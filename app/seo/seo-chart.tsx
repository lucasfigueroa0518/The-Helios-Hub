'use client';

import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';

import { formatCompactNumber, formatCtr, formatPosition } from '@/lib/seo/format';
import type { SeoDailyPoint } from '@/lib/seo/types';

export const CHART_METRICS = ['clicks', 'impressions', 'ctr', 'position'] as const;
export type ChartMetric = (typeof CHART_METRICS)[number];

type MetricMeta = {
  label: string;
  /** Volume metrics get an area wash; rate metrics stay as bare lines. */
  area: boolean;
  /** Position 1 is the best result, so that axis runs best-at-top. */
  invert: boolean;
  format: (value: number) => string;
};

const METRICS: Record<ChartMetric, MetricMeta> = {
  clicks: { label: 'Clicks', area: true, invert: false, format: formatCompactNumber },
  impressions: { label: 'Impressions', area: true, invert: false, format: formatCompactNumber },
  ctr: { label: 'Avg. CTR', area: false, invert: false, format: formatCtr },
  position: { label: 'Avg. position', area: false, invert: true, format: formatPosition },
};

const GRID_FRACTIONS = [0, 0.25, 0.5, 0.75, 1];

/** Eased falloff — a plain two-stop wash bands visibly across this much height. */
const AREA_STOPS: Array<[string, number]> = [
  ['0%', 0.2],
  ['22%', 0.115],
  ['46%', 0.058],
  ['72%', 0.02],
  ['100%', 0],
];

type Domain = { lo: number; hi: number; invert: boolean };

function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const base = 10 ** Math.floor(Math.log10(value));
  const normalized = value / base;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return step * base;
}

function domainFor(metric: ChartMetric, values: number[]): Domain {
  if (metric === 'position') {
    const ranked = values.filter((value) => value > 0);
    const best = ranked.length ? Math.min(...ranked) : 1;
    const worst = ranked.length ? Math.max(...ranked) : 10;
    const lo = Math.max(0, Math.floor(best) - 1);
    return { lo, hi: Math.max(lo + 4, Math.ceil(worst) + 1), invert: true };
  }
  if (metric === 'ctr') {
    return { lo: 0, hi: niceCeil(Math.max(...values, 0.005) * 1.1), invert: false };
  }
  return { lo: 0, hi: niceCeil(Math.max(...values, 1)), invert: false };
}

function valueAt(domain: Domain, fraction: number): number {
  const span = domain.hi - domain.lo;
  return domain.invert ? domain.hi - fraction * span : domain.lo + fraction * span;
}

function yFor(value: number, domain: Domain, top: number, innerH: number): number {
  const span = domain.hi - domain.lo;
  const fraction = span <= 0 ? 0.5 : Math.min(1, Math.max(0, (value - domain.lo) / span));
  return domain.invert ? top + fraction * innerH : top + innerH - fraction * innerH;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Monotone cubic (Fritsch–Carlson) interpolation. Straight polylines read as
 * wireframe, but a naive spline overshoots between points and would invent
 * clicks on days that had none — these tangents cannot overshoot the samples.
 */
function curvePath(xs: number[], ys: number[]): string {
  const count = xs.length;
  if (count === 0) return '';
  if (count === 1) return `M ${round(xs[0])} ${round(ys[0])}`;
  if (count === 2) return `M ${round(xs[0])} ${round(ys[0])} L ${round(xs[1])} ${round(ys[1])}`;

  const widths: number[] = [];
  const slopes: number[] = [];
  for (let i = 0; i < count - 1; i += 1) {
    const run = xs[i + 1] - xs[i];
    widths.push(run);
    slopes.push(run === 0 ? 0 : (ys[i + 1] - ys[i]) / run);
  }

  const tangents: number[] = new Array(count);
  tangents[0] = slopes[0];
  tangents[count - 1] = slopes[count - 2];
  for (let i = 1; i < count - 1; i += 1) {
    if (slopes[i - 1] * slopes[i] <= 0) {
      tangents[i] = 0;
    } else {
      const left = 2 * widths[i] + widths[i - 1];
      const right = widths[i] + 2 * widths[i - 1];
      tangents[i] = (left + right) / (left / slopes[i - 1] + right / slopes[i]);
    }
  }

  let path = `M ${round(xs[0])} ${round(ys[0])}`;
  for (let i = 0; i < count - 1; i += 1) {
    const third = widths[i] / 3;
    path += ` C ${round(xs[i] + third)} ${round(ys[i] + tangents[i] * third)}`
      + ` ${round(xs[i + 1] - third)} ${round(ys[i + 1] - tangents[i + 1] * third)}`
      + ` ${round(xs[i + 1])} ${round(ys[i + 1])}`;
  }
  return path;
}

function utcDate(iso: string): Date | null {
  const date = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function shortDate(iso: string): string {
  const date = utcDate(iso);
  return date
    ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    : iso;
}

function longDate(iso: string): string {
  const date = utcDate(iso);
  return date
    ? date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : iso;
}

export function SeoChart({
  series,
  enabled,
}: {
  series: SeoDailyPoint[];
  enabled: Record<ChartMetric, boolean>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(880);
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');

  // Measured before paint so the SVG is never briefly wider than its column.
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    setWidth(element.clientWidth || 880);
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect.width ?? 0);
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const height = width < 560 ? 200 : 280;

  const geometry = useMemo(() => {
    const pad = { top: 18, right: 56, bottom: 30, left: 56 };
    const innerW = Math.max(10, width - pad.left - pad.right);
    const innerH = Math.max(10, height - pad.top - pad.bottom);
    const baseY = pad.top + innerH;
    const xs = series.map((_, index) => (
      series.length === 1 ? pad.left + innerW / 2 : pad.left + (index / (series.length - 1)) * innerW
    ));

    const domains = {} as Record<ChartMetric, Domain>;
    const shapes = {} as Record<ChartMetric, { line: string; area: string; ys: number[] }>;

    for (const metric of CHART_METRICS) {
      const values = series.map((point) => Number(point[metric] ?? 0));
      const domain = domainFor(metric, values);
      const ys = values.map((value) => yFor(value, domain, pad.top, innerH));
      const line = curvePath(xs, ys);
      const area = ys.length > 1
        ? `${line} L ${round(xs[ys.length - 1])} ${round(baseY)} L ${round(xs[0])} ${round(baseY)} Z`
        : '';
      domains[metric] = domain;
      shapes[metric] = { line, area, ys };
    }

    const tickCount = Math.max(2, Math.min(6, Math.floor(innerW / 110)));
    const tickIndexes = series.length <= tickCount
      ? series.map((_, index) => index)
      : Array.from({ length: tickCount }, (_, step) => Math.round((step / (tickCount - 1)) * (series.length - 1)));

    return { pad, innerW, innerH, baseY, xs, domains, shapes, tickIndexes };
  }, [height, series, width]);

  const { pad, innerW, innerH, baseY, xs, domains, shapes, tickIndexes } = geometry;
  const activeMetrics = CHART_METRICS.filter((metric) => enabled[metric]);
  const leftMetric = activeMetrics[0] ?? 'clicks';
  const rightMetric = activeMetrics[1] ?? null;
  const hovered = hover === null ? null : series[hover] ?? null;
  const lastIndex = series.length - 1;

  function moveHoverTo(clientX: number, rect: DOMRect) {
    const offset = clientX - rect.left;
    const ratio = innerW <= 0 ? 0 : (offset - pad.left) / innerW;
    const index = Math.round(ratio * Math.max(1, series.length - 1));
    setHover(Math.min(series.length - 1, Math.max(0, index)));
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement> | ReactMouseEvent<SVGSVGElement>) {
    moveHoverTo(event.clientX, event.currentTarget.getBoundingClientRect());
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    setHover((current) => {
      const base = current ?? series.length - 1;
      const next = event.key === 'ArrowLeft' ? base - 1 : base + 1;
      return Math.min(series.length - 1, Math.max(0, next));
    });
  }

  const tooltipX = hover === null ? 0 : Math.min(Math.max(xs[hover], 96), Math.max(96, width - 96));

  // The container always renders so the width observer stays attached across
  // empty ranges.
  if (series.length === 0) {
    return (
      <div className="seo-chart" ref={containerRef}>
        <p className="seo-chart__empty">No daily totals in this range yet.</p>
      </div>
    );
  }

  return (
    <div className="seo-chart" ref={containerRef}>
      <div
        className="seo-chart__plot"
        tabIndex={0}
        role="group"
        aria-label="Search performance over time. Use the left and right arrow keys to step through days."
        onKeyDown={onKeyDown}
        onBlur={() => setHover(null)}
      >
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
          onMouseMove={onPointerMove}
          onMouseLeave={() => setHover(null)}
        >
          {/* userSpaceOnUse: a flat series has a zero-height bounding box, which
              collapses objectBoundingBox gradients to nothing. */}
          <defs>
            {CHART_METRICS.map((metric) => (
              <linearGradient
                key={`stroke-${metric}`}
                id={`${uid}-stroke-${metric}`}
                gradientUnits="userSpaceOnUse"
                x1={pad.left}
                y1={0}
                x2={width - pad.right}
                y2={0}
              >
                <stop offset="0%" className={`seo-chart__stroke-stop--${metric}-soft`} />
                <stop offset="100%" className={`seo-chart__stroke-stop--${metric}`} />
              </linearGradient>
            ))}
            {CHART_METRICS.filter((metric) => METRICS[metric].area).map((metric) => (
              <linearGradient
                key={`area-${metric}`}
                id={`${uid}-area-${metric}`}
                gradientUnits="userSpaceOnUse"
                x1={0}
                y1={pad.top}
                x2={0}
                y2={baseY}
              >
                {AREA_STOPS.map(([offset, opacity]) => (
                  <stop
                    key={offset}
                    offset={offset}
                    stopOpacity={opacity}
                    className={`seo-chart__area-stop--${metric}`}
                  />
                ))}
              </linearGradient>
            ))}
            <linearGradient
              id={`${uid}-crosshair`}
              gradientUnits="userSpaceOnUse"
              x1={0}
              y1={pad.top}
              x2={0}
              y2={baseY}
            >
              <stop offset="0%" className="seo-chart__crosshair-stop" stopOpacity="0" />
              <stop offset="22%" className="seo-chart__crosshair-stop" stopOpacity="1" />
              <stop offset="100%" className="seo-chart__crosshair-stop" stopOpacity="1" />
            </linearGradient>
          </defs>

          {GRID_FRACTIONS.map((fraction) => {
            const y = baseY - fraction * innerH;
            return (
              <g key={fraction}>
                <line
                  x1={pad.left}
                  x2={width - pad.right}
                  y1={y}
                  y2={y}
                  className={fraction === 0 ? 'seo-chart__axis' : 'seo-chart__grid'}
                />
                <text
                  x={pad.left - 10}
                  y={y + 3}
                  className={`seo-chart__tick seo-chart__tick--${leftMetric} seo-chart__tick--right`}
                >
                  {METRICS[leftMetric].format(valueAt(domains[leftMetric], fraction))}
                </text>
                {rightMetric && (
                  <text
                    x={width - pad.right + 10}
                    y={y + 3}
                    className={`seo-chart__tick seo-chart__tick--${rightMetric}`}
                  >
                    {METRICS[rightMetric].format(valueAt(domains[rightMetric], fraction))}
                  </text>
                )}
              </g>
            );
          })}

          {tickIndexes.map((index, order) => (
            <text
              key={series[index].date}
              x={xs[index]}
              y={height - 8}
              className={`seo-chart__tick${order === 0 ? ' seo-chart__tick--left' : ''}${order === tickIndexes.length - 1 ? ' seo-chart__tick--right' : ''}${hover === index ? ' seo-chart__tick--current' : ''}`}
            >
              {shortDate(series[index].date)}
            </text>
          ))}

          {hovered && (
            <line
              x1={xs[hover as number]}
              x2={xs[hover as number]}
              y1={pad.top}
              y2={baseY}
              stroke={`url(#${uid}-crosshair)`}
              className="seo-chart__crosshair"
            />
          )}

          {CHART_METRICS.map((metric) => {
            const shape = shapes[metric];
            const endX = round(xs[lastIndex]);
            const endY = round(shape.ys[lastIndex]);
            // Drawn as a zero-length round-capped stroke rather than a circle so
            // `non-scaling-stroke` keeps it a true circle while the group
            // collapses on toggle.
            const endDot = `M ${endX} ${endY} L ${endX} ${endY}`;
            return (
              <g
                key={metric}
                className={`seo-chart__series${enabled[metric] ? '' : ' seo-chart__series--off'}`}
                style={{ transformOrigin: `0px ${baseY}px` }}
              >
                {METRICS[metric].area && shape.area && (
                  <path d={shape.area} fill={`url(#${uid}-area-${metric})`} stroke="none" />
                )}
                <path
                  d={shape.line}
                  fill="none"
                  stroke={`url(#${uid}-stroke-${metric})`}
                  vectorEffect="non-scaling-stroke"
                  className="seo-chart__line"
                />
                <path d={endDot} vectorEffect="non-scaling-stroke" className="seo-chart__end-halo" />
                <path
                  d={endDot}
                  vectorEffect="non-scaling-stroke"
                  className={`seo-chart__end-dot seo-chart__end-dot--${metric}`}
                />
              </g>
            );
          })}

          {hovered && activeMetrics.map((metric) => (
            <g key={metric} className={`seo-chart__marker seo-chart__marker--${metric}`}>
              <circle cx={xs[hover as number]} cy={shapes[metric].ys[hover as number]} r="8" className="seo-chart__marker-halo" />
              <circle cx={xs[hover as number]} cy={shapes[metric].ys[hover as number]} r="3.5" className="seo-chart__marker-core" />
            </g>
          ))}

          <rect
            x={0}
            y={0}
            width={width}
            height={height}
            className="seo-chart__hit"
          />
        </svg>

        {hovered && (
          <div className="seo-chart__tooltip" style={{ left: `${tooltipX}px` }} role="status">
            <div className="seo-chart__tooltip-date">{longDate(hovered.date)}</div>
            <dl className="seo-chart__tooltip-rows">
              {activeMetrics.map((metric) => (
                <div key={metric} className={`seo-chart__tooltip-row seo-chart__tooltip-row--${metric}`}>
                  <dt>
                    <i aria-hidden="true" />
                    {METRICS[metric].label}
                  </dt>
                  <dd>{METRICS[metric].format(Number(hovered[metric] ?? 0))}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}
