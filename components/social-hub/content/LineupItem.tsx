import { ActionBar } from '@/components/social-hub/house/ActionBar';
import { PostLink } from '@/components/social-hub/nav/PostLink';
import { StateBadge, TypeMark } from '@/components/social-hub/ui/marks';
import { Thumb } from '@/components/social-hub/ui/Thumb';
import { clock, displayName } from '@/lib/social-hub/views/format';
import type { Offerer } from '@/lib/social-hub/views/offer';
import { metricWithTypical } from '@/lib/social-hub/views/typical';
import type { HubPost, MetricKey } from '@/lib/social-hub/types';

const LEAD_METRIC: Record<HubPost['format'], MetricKey> = { reel: 'views', feed: 'views', story: 'reach' };

/**
 * One piece of content in a list (BRIEFS.md §1): time, thumbnail, type,
 * name, state, and what to do about it. `compact` drops the actions where
 * the same item already sits in Needs you above.
 */
export function LineupItem({ post, o, showTime = true, compact = false, past = false }: { post: HubPost; o: Offerer; showTime?: boolean; compact?: boolean; past?: boolean }) {
  const { state, menu } = o.offer(post);
  const when = post.postedAt ?? post.publishAt;
  const metric = post.status === 'published' ? metricWithTypical(post, LEAD_METRIC[post.format], o.typical) : null;
  return (
    <li className={`sh-item${past ? ' sh-item--past' : ''}${compact ? ' sh-item--compact' : ''}`}>
      {showTime ? <span className="sh-item__time">{when ? clock(when) : '—'}</span> : null}
      <PostLink id={post.id} className="sh-item__thumb" decorative>
        <Thumb post={post} />
      </PostLink>
      <div className="sh-item__main">
        <div className="sh-item__meta">
          <TypeMark vertical={post.vertical} />
          <StateBadge state={state} />
        </div>
        <PostLink id={post.id} className="sh-item__name">{displayName(post)}</PostLink>
        {compact ? (
          <span className="sh-item__line">Also under Needs you</span>
        ) : (
          <span className={`sh-item__line${state.tone === 'failed' ? ' sh-item__line--failed' : ''}`}>
            {[metric, state.id === 'published' ? null : state.line].filter(Boolean).join(' · ') || state.line}
          </span>
        )}
      </div>
      {compact ? null : <div className="sh-item__actions"><ActionBar menu={menu} compact showOffNote={false} /></div>}
    </li>
  );
}
