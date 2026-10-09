import { ArrowDownRight, ArrowUpRight } from 'lucide-react';

import { formatMetric } from '@/lib/social-hub/metrics';
import type { Kpi } from '@/lib/social-hub/views/analytics';
import { change, changeLabel } from '@/lib/social-hub/views/typical';

export function formatKpi(value: number | null, display: Kpi['display']): string {
  if (value == null) return '—';
  if (display === 'money') return `$${value.toFixed(value < 10 ? 2 : 0)}`;
  return formatMetric(value, display);
}

/** A tiny line of daily values (dataviz: one hue, no axes, last point marked). */
export function Sparkline({ values, width = 96, height = 24, color = 'currentColor', label }: { values: Array<number | null>; width?: number; height?: number; color?: string; label?: string }) {
  const nums = values.map((v, i) => ({ i, v })).filter((p): p is { i: number; v: number } => p.v != null);
  if (nums.length < 2) return <span className="sh-spark sh-spark--empty" style={{ width, height }} aria-hidden="true" />;
  const max = Math.max(...nums.map((p) => p.v));
  const min = Math.min(...nums.map((p) => p.v));
  const span = max - min || 1;
  const x = (i: number) => 1 + (i / Math.max(values.length - 1, 1)) * (width - 4);
  const y = (v: number) => 2 + (1 - (v - min) / span) * (height - 4);
  const d = nums.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const last = nums[nums.length - 1]!;
  return (
    <svg className="sh-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r="2" fill={color} />
    </svg>
  );
}

export function Delta({ value, previous, higherIsBetter, suffix = 'vs previous period' }: { value: number | null; previous: number | null; higherIsBetter: boolean; suffix?: string }) {
  const d = change(value, previous);
  if (d == null) return <span className="sh-delta">{previous == null ? 'No earlier period to compare' : '—'}</span>;
  const flat = Math.abs(d) < 0.005;
  const good = flat ? null : (d > 0) === higherIsBetter;
  const Icon = d > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`sh-delta${good == null ? '' : good ? ' sh-delta--up' : ' sh-delta--down'}`}>
      {flat ? null : <Icon size={13} aria-hidden="true" />}
      {changeLabel(d)} <span className="sh-delta__vs">{suffix}</span>
    </span>
  );
}

/** At most six figures, each with its comparison (DESIGN.md: never a wall of equal tiles). */
export function KpiStrip({ kpis, emphasis }: { kpis: Kpi[]; emphasis?: string }) {
  return (
    <dl className="sh-kpis">
      {kpis.slice(0, 6).map((k) => (
        <div key={k.key} className={`sh-kpi${emphasis === k.key ? ' sh-kpi--on' : ''}`}>
          <dt>{k.label}</dt>
          <dd>
            <span className="sh-kpi__value">{formatKpi(k.value, k.display)}</span>
            {k.spark.length ? <Sparkline values={k.spark} label={`${k.label} by day`} /> : null}
          </dd>
          <Delta value={k.value} previous={k.previous} higherIsBetter={k.higherIsBetter} />
        </div>
      ))}
    </dl>
  );
}
