'use client';

import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';

import { formatCompactNumber } from '@/lib/traffic/format';
import type { TrafficDailyPoint } from '@/lib/traffic/types';

export const CHART_METRICS = ['visitors', 'pageviews'] as const;
export type ChartMetric = (typeof CHART_METRICS)[number];

type MetricMeta = {
  label: string;
  format: (value: number) => string;
};

const METRICS: Record<ChartMetric, MetricMeta> = {
  visitors: { label: 'Visitors', format: formatCompactNumber },
  pageviews: { label: 'Page views', format: formatCompactNumber },
};

const GRID_FRACTIONS = [0, 0.25, 0.5, 0.75, 1];

const AREA_STOPS: Array<[string, number]> = [
  ['0%', 0.2],
  ['22%', 0.115],
  ['46%', 0.058],
  ['72%', 0.02],
  ['100%', 0],
];

type Domain = { lo: number; hi: number };

function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const base = 10 ** Math.floor(Math.log10(value));
  const normalized = value / base;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return step * base;
}

function domainFor(values: number[]): Domain {
  return { lo: 0, hi: niceCeil(Math.max(...values, 1)) };
}

function valueAt(domain: Domain, fraction: number): number {
  return domain.lo + fraction * (domain.hi - domain.lo);
}

function yFor(value: number, domain: Domain, top: number, innerH: number): number {
  const span = domain.hi - domain.lo;
  const fraction = span <= 0 ? 0.5 : Math.min(1, Math.max(0, (value - domain.lo) / span));
  return top + innerH - fraction * innerH;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

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

export function TrafficChart({
  series,
  enabled,
}: {
  series: TrafficDailyPoint[];
  enabled: Record<ChartMetric, boolean>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(880);
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');

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
      const domain = domainFor(values);
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
  const leftMetric = activeMetrics[0] ?? 'visitors';
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

  if (series.length === 0) {
    return (
      <div className="traffic-chart" ref={containerRef}>
        <p className="traffic-chart__empty">No daily traffic in this range yet.</p>
      </div>
    );
  }

  return (
    <div className="traffic-chart" ref={containerRef}>
      <div
        className="traffic-chart__plot"
        tabIndex={0}
        role="group"
        aria-label="Site traffic over time. Use the left and right arrow keys to step through days."
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
                <stop offset="0%" className={`traffic-chart__stroke-stop--${metric}-soft`} />
                <stop offset="100%" className={`traffic-chart__stroke-stop--${metric}`} />
              </linearGradient>
            ))}
            {CHART_METRICS.map((metric) => (
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
                    className={`traffic-chart__area-stop--${metric}`}
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
              <stop offset="0%" className="traffic-chart__crosshair-stop" stopOpacity="0" />
              <stop offset="22%" className="traffic-chart__crosshair-stop" stopOpacity="1" />
              <stop offset="100%" className="traffic-chart__crosshair-stop" stopOpacity="1" />
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
                  className={fraction === 0 ? 'traffic-chart__axis' : 'traffic-chart__grid'}
                />
                <text
                  x={pad.left - 10}
                  y={y + 3}
                  className={`traffic-chart__tick traffic-chart__tick--${leftMetric} traffic-chart__tick--right`}
                >
                  {METRICS[leftMetric].format(valueAt(domains[leftMetric], fraction))}
                </text>
                {rightMetric && (
                  <text
                    x={width - pad.right + 10}
                    y={y + 3}
                    className={`traffic-chart__tick traffic-chart__tick--${rightMetric}`}
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
              className={`traffic-chart__tick${order === 0 ? ' traffic-chart__tick--left' : ''}${order === tickIndexes.length - 1 ? ' traffic-chart__tick--right' : ''}${hover === index ? ' traffic-chart__tick--current' : ''}`}
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
              className="traffic-chart__crosshair"
            />
          )}

          {CHART_METRICS.map((metric) => {
            const shape = shapes[metric];
            const endX = round(xs[lastIndex]);
            const endY = round(shape.ys[lastIndex]);
            const endDot = `M ${endX} ${endY} L ${endX} ${endY}`;
            return (
              <g
                key={metric}
                className={`traffic-chart__series${enabled[metric] ? '' : ' traffic-chart__series--off'}`}
                style={{ transformOrigin: `0px ${baseY}px` }}
              >
                {shape.area && (
                  <path d={shape.area} fill={`url(#${uid}-area-${metric})`} stroke="none" />
                )}
                <path
                  d={shape.line}
                  fill="none"
                  stroke={`url(#${uid}-stroke-${metric})`}
                  vectorEffect="non-scaling-stroke"
                  className="traffic-chart__line"
                />
                <path d={endDot} vectorEffect="non-scaling-stroke" className="traffic-chart__end-halo" />
                <path
                  d={endDot}
                  vectorEffect="non-scaling-stroke"
                  className={`traffic-chart__end-dot traffic-chart__end-dot--${metric}`}
                />
              </g>
            );
          })}

          {hovered && activeMetrics.map((metric) => (
            <g key={metric} className={`traffic-chart__marker traffic-chart__marker--${metric}`}>
              <circle cx={xs[hover as number]} cy={shapes[metric].ys[hover as number]} r="8" className="traffic-chart__marker-halo" />
              <circle cx={xs[hover as number]} cy={shapes[metric].ys[hover as number]} r="3.5" className="traffic-chart__marker-core" />
            </g>
          ))}

          <rect
            x={0}
            y={0}
            width={width}
            height={height}
            className="traffic-chart__hit"
          />
        </svg>

        {hovered && (
          <div className="traffic-chart__tooltip" style={{ left: `${tooltipX}px` }} role="status">
            <div className="traffic-chart__tooltip-date">{longDate(hovered.date)}</div>
            <dl className="traffic-chart__tooltip-rows">
              {activeMetrics.map((metric) => (
                <div key={metric} className={`traffic-chart__tooltip-row traffic-chart__tooltip-row--${metric}`}>
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
