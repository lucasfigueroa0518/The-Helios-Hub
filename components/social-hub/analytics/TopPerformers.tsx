import Link from 'next/link';

import { VerticalTag } from '@/components/social-hub/marks';
import { formatUsd } from '@/lib/social-hub/cost';
import { postHref } from '@/lib/social-hub/ids';
import { formatMetricKey, metricSpec, postMetric, topPerformers } from '@/lib/social-hub/metrics';
import type { HubPost, MetricKey } from '@/lib/social-hub/types';

/** Top 5 by the selected metric, all verticals mixed (SH-30). */
export function TopPerformers({ posts, metric, base }: { posts: readonly HubPost[]; metric: MetricKey; base: string }) {
  const top = topPerformers(posts, metric);
  if (top.length === 0) return <p className="sh-muted">No post in this range has a {metricSpec(metric).label.toLowerCase()} number yet.</p>;
  return (
    <ol className="sh-top">
      {top.map((post, i) => (
        <li key={post.id}>
          <span className="sh-top__rank">{i + 1}</span>
          <span className="sh-top__body">
            <Link href={postHref(base, post.id)} className="sh-link sh-top__name">{post.name}</Link>
            <span className="sh-top__meta"><VerticalTag vertical={post.vertical} /><span className="sh-subtle">{post.nyDate} · cost {formatUsd(post.costMicros)}</span></span>
          </span>
          <span className="sh-top__value">{formatMetricKey(postMetric(post, metric), metric)}</span>
        </li>
      ))}
    </ol>
  );
}
