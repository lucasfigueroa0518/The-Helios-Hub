import Link from 'next/link';

import { VerticalTag } from '@/components/social-hub/marks';
import { costOfPosts, formatUsd } from '@/lib/social-hub/cost';
import { postHref } from '@/lib/social-hub/ids';
import { formatMetricKey, metricSpec, postMetric } from '@/lib/social-hub/metrics';
import { verticalInfo } from '@/lib/social-hub/verticals';
import type { HubPost, MetricKey, Vertical } from '@/lib/social-hub/types';

/** The vertical's key columns (spec §5.3) when one vertical is in view. */
const KEY_COLUMNS: Record<Vertical, MetricKey[]> = {
  reels: ['avgWatchTimeMs', 'skipRate', 'shares'],
  explainers: ['avgWatchTimeMs', 'skipRate', 'saved'],
  carousels: ['reach', 'saved', 'shares'],
  stories: ['reach', 'completion', 'exitsFirst3'],
};

function Thumb({ post }: { post: HubPost }) {
  const src = post.media.kind === 'frames' ? post.media.frames[0]?.src : post.media.kind === 'slides' ? post.media.slides[0]?.photo : null;
  return src
    ? <img className="sh-thumb" src={src} alt="" loading="lazy" referrerPolicy="no-referrer" />
    : <span className="sh-thumb sh-thumb--blank" style={{ background: `var(${verticalInfo(post.vertical).colorVar})` }} aria-hidden="true" />;
}

/**
 * Posts table (spec §5.3): thumbnail, vertical, name, posted, the selected
 * metric, cost, key columns. Checkbox → compare (a GET form, 2–6 posts).
 */
export function PostsTable({ posts, metric, vertical, base, compareAction, keep }: {
  posts: HubPost[];
  metric: MetricKey;
  vertical: Vertical | null;
  base: string;
  compareAction: string;
  keep: Record<string, string | undefined>;
}) {
  if (posts.length === 0) {
    return <div className="sh-empty"><strong>No published posts in this view</strong>Widen the range or clear a filter.</div>;
  }
  const extra = vertical ? KEY_COLUMNS[vertical].filter((k) => k !== metric) : [];
  const total = costOfPosts(posts);
  return (
    <form method="get" action={compareAction} className="sh-table-form">
      {Object.entries({ ...keep, tab: 'compare', mode: 'side' }).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <div className="sh-table-bar">
        <span className="sh-muted">{posts.length} on this page · cost {formatUsd(total.micros)}{total.unknown ? ` · ${total.unknown} without cost` : ''}</span>
        <button type="submit" className="sh-btn">Compare selected (2–6)</button>
      </div>
      <div className="sh-table-wrap" role="region" aria-label="Posts table" tabIndex={0}>
        <table className="sh-table">
          <thead>
            <tr>
              <th scope="col"><span className="sh-sr">Compare</span></th>
              <th scope="col">Post</th>
              <th scope="col">Posted</th>
              <th scope="col" className="sh-num">{metricSpec(metric).label}</th>
              <th scope="col" className="sh-num">Cost</th>
              {extra.map((k) => <th key={k} scope="col" className="sh-num">{metricSpec(k).label}</th>)}
            </tr>
          </thead>
          <tbody>
            {posts.map((post) => (
              <tr key={post.id}>
                <td><input type="checkbox" name="cmp" value={post.id} aria-label={`Compare ${post.name}`} /></td>
                <td>
                  <span className="sh-table__post">
                    <Thumb post={post} />
                    <span className="sh-table__name">
                      <Link href={postHref(base, post.id)} className="sh-link">{post.name}</Link>
                      <VerticalTag vertical={post.vertical} />
                    </span>
                  </span>
                </td>
                <td className="sh-nowrap">{post.nyDate}</td>
                <td className="sh-num">{formatMetricKey(postMetric(post, metric), metric)}</td>
                <td className="sh-num">{formatUsd(post.costMicros)}</td>
                {extra.map((k) => <td key={k} className="sh-num">{formatMetricKey(postMetric(post, k), k)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </form>
  );
}
