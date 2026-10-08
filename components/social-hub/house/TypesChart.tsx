import { colorStyle } from '@/components/social-hub/marks';
import { formatUsd } from '@/lib/social-hub/cost';
import { formatMetricKey, metricSpec } from '@/lib/social-hub/metrics';
import type { TypeRow } from '@/lib/social-hub/house';
import type { MetricKey } from '@/lib/social-hub/types';

/** Performance by vertical (SH-20): one bar per vertical, mean per post on the selected metric, with counts and cost per post (SH-21). */
export function TypesChart({ rows, metric }: { rows: TypeRow[]; metric: MetricKey }) {
  const spec = metricSpec(metric);
  const values = rows.map((r) => r.value ?? 0);
  const max = Math.max(...values, 0) || 1;
  return (
    <figure className="sh-bars" aria-label={`${spec.label} per post by vertical`}>
      {rows.map((r) => (
        <div key={r.vertical} className="sh-bars__row" style={colorStyle(r.vertical)}>
          <span className="sh-bars__label">{r.label}</span>
          <span className="sh-bars__track" aria-hidden="true">
            <span className="sh-bars__bar" style={{ width: `${r.value == null ? 0 : Math.max(2, (r.value / max) * 100)}%` }} />
          </span>
          <span className="sh-bars__value">{r.value == null ? (r.posts ? 'n/a for this format' : '—') : formatMetricKey(r.value, metric)}</span>
          <span className="sh-bars__meta">{r.posts} posts · {formatUsd(r.costPerPost)} a post</span>
        </div>
      ))}
      <figcaption className="sh-subtle">
        Mean {spec.label.toLowerCase()} per published post{spec.higherIsBetter ? '' : ' (lower is better)'}. Cost per post counts each content item once.
      </figcaption>
    </figure>
  );
}
