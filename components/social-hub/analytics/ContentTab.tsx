import { costOfPosts, formatUsd } from '@/lib/social-hub/cost';
import Link from 'next/link';

import { formatBlocks, hrefWith, pageOf, queryParams, rankPosts, type AnalyticsQuery } from '@/lib/social-hub/analytics';
import type { HubPost } from '@/lib/social-hub/types';

import { PostsTable } from './PostsTable';
import { StatTiles } from './StatTiles';

/** Content analytics (spec §5.2, §5.3): per-format numbers, then the posts table. */
export function ContentTab({ q, posts, base, action }: { q: AnalyticsQuery; posts: HubPost[]; base: string; action: string }) {
  const blocks = formatBlocks(posts);
  const cost = costOfPosts(posts);
  const table = pageOf(rankPosts(posts, q.metric), q.page);
  const pageHref = (n: number) => hrefWith(action, q, { page: n > 1 ? String(n) : null });
  return (
    <>
      {blocks.length === 0 ? (
        <div className="sh-card sh-empty"><strong>No published posts in this view</strong>Widen the range or pick another vertical.</div>
      ) : (
        blocks.map((block) => (
          <section key={block.format} className="sh-card">
            <header className="sh-card__head">
              <h2 className="sh-card__title">{block.label} · {block.count} posted</h2>
              <span className="sh-muted">Cost to make {formatUsd(block.costMicros)} · {formatUsd(block.count ? Math.round(block.costMicros / block.count) : null)} a post</span>
            </header>
            <div className="sh-card__body"><StatTiles items={block.headlines} /></div>
          </section>
        ))
      )}
      <section className="sh-card">
        <header className="sh-card__head">
          <h2 className="sh-card__title">Posts</h2>
          <span className="sh-muted">Ranked by the selected metric · total cost {formatUsd(cost.micros)}</span>
        </header>
        <div className="sh-card__body">
          <PostsTable posts={table.items} metric={q.metric} vertical={q.vertical} base={base} compareAction={action} keep={{ ...queryParams(q), cmp: undefined }} />
          {table.pageCount > 1 ? (
            <nav className="sh-seg sh-pager" aria-label="Posts table pages">
              {table.page > 1 ? <Link href={pageHref(table.page - 1)}>‹ Previous</Link> : null}
              <span className="sh-muted">Page {table.page} of {table.pageCount}</span>
              {table.page < table.pageCount ? <Link href={pageHref(table.page + 1)}>Next ›</Link> : null}
            </nav>
          ) : null}
        </div>
      </section>
    </>
  );
}
