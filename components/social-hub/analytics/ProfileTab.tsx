import type { ReactNode } from 'react';

import { headlines, metricChoices, type AnalyticsQuery } from '@/lib/social-hub/analytics';
import type { HubPost } from '@/lib/social-hub/types';

import { StatTiles } from './StatTiles';
import { TopPerformers } from './TopPerformers';

/**
 * Profile analytics (spec §5.1). Account-level numbers come from the
 * `social_hub` tables the Phase 2 collector fills (P2-M1). `account` is the
 * slot for them; until they exist the tab says so plainly (§S6).
 */
export function ProfileTab({ q, posts, base, account, accountState }: { q: AnalyticsQuery; posts: HubPost[]; base: string; account?: ReactNode; accountState: 'absent' | 'empty' | 'error' }) {
  return (
    <>
      {account ?? (
        <section className="sh-card sh-empty">
          <strong>{accountState === 'error' ? 'Account data could not be read' : 'No account data yet'}</strong>
          {accountState === 'absent'
            ? 'The social_hub tables are written (db/social_hub_schema.sql) but not applied. '
            : accountState === 'empty'
              ? 'The social_hub tables exist but hold no rows in this range: the account collector fills them (Phase 2, P2-M1). '
              : 'The social_hub read failed; the rest of the page still works. '}
          Account reach, follower vs non-follower split, followers, demographics and most-active times come from that collector.
          Meta has no per-post follower split (META_API_CHECK), so discovery is account-level only.
        </section>
      )}
      <section className="sh-card">
        <header className="sh-card__head"><h2 className="sh-card__title">From our posts</h2><span className="sh-muted">Summed over {posts.length} published posts in this view</span></header>
        <div className="sh-card__body"><StatTiles items={headlines(posts, metricChoices(q).filter((m) => ['views', 'reach', 'totalInteractions', 'shares'].includes(m.key)))} /></div>
      </section>
      <section className="sh-card">
        <header className="sh-card__head"><h2 className="sh-card__title">Top performers</h2><span className="sh-muted">Top 5 in this view{q.vertical ? '' : ', every vertical'}</span></header>
        <div className="sh-card__body"><TopPerformers posts={posts} metric={q.metric} base={base} /></div>
      </section>
    </>
  );
}
