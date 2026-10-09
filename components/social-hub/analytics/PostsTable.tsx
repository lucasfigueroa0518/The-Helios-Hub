import { ArrowDown, ArrowUp } from 'lucide-react';

import { ComparePick } from '@/components/social-hub/analytics/CompareTray';
import { HubLink } from '@/components/social-hub/nav/HubNav';
import { PostLink } from '@/components/social-hub/nav/PostLink';
import { TypeMark } from '@/components/social-hub/ui/marks';
import { Thumb } from '@/components/social-hub/ui/Thumb';
import { formatUsd } from '@/lib/social-hub/cost';
import { withParams, type HubParams } from '@/lib/social-hub/links';
import { formatMetricKey, metricSpec, postMetric } from '@/lib/social-hub/metrics';
import type { Query } from '@/lib/social-hub/views/analytics';
import { sortedPosts } from '@/lib/social-hub/views/analytics';
import { displayName, shortDate } from '@/lib/social-hub/views/format';
import type { HubPost, MetricKey } from '@/lib/social-hub/types';

/**
 * Posts in view, sortable by any column, 25 a page; tick to compare (BRIEFS.md §3).
 * With `limit`, only the top rows show, with one link to the full list.
 */
export function PostsTable({ posts, q, path, params, columns, showType, limit, moreHref }: {
  posts: HubPost[];
  q: Query;
  path: string;
  params: HubParams;
  columns: MetricKey[];
  showType: boolean;
  limit?: number;
  moreHref?: string;
}) {
  const sorted = sortedPosts(posts, limit ? { ...q, page: 1 } : q);
  const { page, pageCount, total } = sorted;
  const items = limit ? sorted.items.slice(0, limit) : sorted.items;
  const href = (changes: Record<string, string | null>) => withParams(path, '', params, changes);
  const sortHref = (col: string) => href({ sort: col === q.metric ? null : col, dir: q.sort === col && q.dir === 'desc' ? 'asc' : null, page: null });
  const head = (col: string, label: string, numeric = true) => {
    const active = q.sort === col;
    const Icon = q.dir === 'asc' ? ArrowUp : ArrowDown;
    return (
      <th scope="col" className={numeric ? 'sh-num' : undefined} aria-sort={active ? (q.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
        <HubLink href={sortHref(col)} history="replace">{label}{active ? <Icon size={12} aria-hidden="true" /> : null}</HubLink>
      </th>
    );
  };
  if (total === 0) return <div className="sh-panel sh-empty"><strong>No posts in this range</strong>Try a longer range, or clear a filter.</div>;
  return (
    <div className="sh-panel">
      <div className="sh-table-wrap">
        <table className="sh-table sh-table--stack">
          <thead>
            <tr>
              <th scope="col" className="sh-col-pick"><span className="sh-sr">Compare</span></th>
              <th scope="col">Post</th>
              {head('posted', 'Posted', false)}
              {columns.map((c) => <th key={c} scope="col" className="sh-num" aria-sort={q.sort === c ? (q.dir === 'asc' ? 'ascending' : 'descending') : undefined}><HubLink href={sortHref(c)} history="replace">{metricSpec(c).label}{q.sort === c ? (q.dir === 'asc' ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />) : null}</HubLink></th>)}
              {head('cost', 'Cost')}
            </tr>
          </thead>
          <tbody>
            {items.map((post) => (
              <tr key={post.id}>
                <td className="sh-col-pick"><ComparePick id={post.id} name={displayName(post)} /></td>
                <td className="sh-stack-lead">
                  <span className="sh-cell-post">
                    <PostLink id={post.id} className="sh-item__thumb" decorative><Thumb post={post} /></PostLink>
                    <span className="sh-cell-post__text">
                      <PostLink id={post.id} className="sh-cell-post__name">{displayName(post)}</PostLink>
                      {showType ? <TypeMark vertical={post.vertical} /> : null}
                    </span>
                  </span>
                </td>
                <td className="sh-nowrap sh-muted">{shortDate(post.postedAt)}</td>
                {columns.map((c) => <td key={c} className={`sh-num${q.sort === c ? ' sh-num--on' : ''}`} data-label={metricSpec(c).label.toLowerCase()}>{formatMetricKey(postMetric(post, c), c)}</td>)}
                <td className="sh-num sh-muted" data-label="cost">{formatUsd(post.costMicros)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="sh-pager">
        {limit ? (
          <>
            <span className="sh-subtle">Top {items.length} of {total.toLocaleString('en-US')} posts</span>
            {moreHref && total > items.length ? <HubLink className="sh-pill" href={moreHref} history="replace">Show all {total.toLocaleString('en-US')}</HubLink> : null}
          </>
        ) : (
          <span className="sh-subtle">{(page - 1) * 25 + 1}–{Math.min(page * 25, total)} of {total.toLocaleString('en-US')} posts</span>
        )}
        {!limit && pageCount > 1 ? (
          <span className="sh-pills">
            {page > 1 ? <HubLink className="sh-pill" href={href({ page: page === 2 ? null : String(page - 1) })} history="replace">Previous</HubLink> : null}
            {page < pageCount ? <HubLink className="sh-pill" href={href({ page: String(page + 1) })} history="replace">Next</HubLink> : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}
