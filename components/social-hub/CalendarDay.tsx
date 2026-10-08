import Link from 'next/link';

import { metricLine, postTime } from '@/lib/social-hub/calendar';
import { withParams, type HubParams } from '@/lib/social-hub/links';
import { timeLabel } from '@/lib/social-hub/time';
import type { HubPost } from '@/lib/social-hub/types';

import { colorStyle, StatusBadge, VerticalTag } from './marks';

/** Day view (spec §4): a timeline in ET with vertical, name, description, status and a metric line. */
export function CalendarDay({ posts, base, params }: { posts: HubPost[]; base: string; params: HubParams }) {
  if (posts.length === 0) {
    return <div className="sh-card sh-empty"><strong>Nothing on this day</strong>No published, scheduled or cancelled posts.</div>;
  }
  return (
    <ol className="sh-timeline">
      {posts.map((post) => {
        const line = metricLine(post);
        return (
          <li key={post.id} className={`sh-timeline__item sh-timeline__item--${post.status}`} style={colorStyle(post.vertical)}>
            <span className="sh-timeline__time">{timeLabel(postTime(post))}</span>
            <Link href={withParams(base, '', params, { post: post.id })} scroll={false} className="sh-timeline__card">
              <span className="sh-timeline__meta">
                <VerticalTag vertical={post.vertical} />
                <StatusBadge post={post} />
              </span>
              <span className="sh-timeline__name">{post.name}</span>
              {post.description ? <span className="sh-timeline__desc">{post.description}</span> : null}
              {line ? <span className="sh-timeline__metrics">{line}</span> : null}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
