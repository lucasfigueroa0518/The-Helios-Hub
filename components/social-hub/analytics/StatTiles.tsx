import { formatMetric } from '@/lib/social-hub/metrics';
import type { Headline } from '@/lib/social-hub/analytics';

/** Headline tiles: value plus "n of N reported" (a blank stays out of every figure). */
export function StatTiles({ items }: { items: Headline[] }) {
  return (
    <dl className="sh-tiles">
      {items.map((h) => (
        <div key={h.key} className="sh-tile">
          <dt>{h.label}</dt>
          <dd>{formatMetric(h.value, h.display)}</dd>
          <span className="sh-subtle">{h.reported} of {h.total} reported{h.display !== 'count' || h.key === 'completion' ? ' · average' : ''}</span>
        </div>
      ))}
    </dl>
  );
}
