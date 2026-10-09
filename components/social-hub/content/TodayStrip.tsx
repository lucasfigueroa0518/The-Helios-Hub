import { PostLink } from '@/components/social-hub/nav/PostLink';
import { StateBadge, TypeMark } from '@/components/social-hub/ui/marks';
import { Thumb } from '@/components/social-hub/ui/Thumb';
import type { HubPost } from '@/lib/social-hub/types';
import { clock, displayName } from '@/lib/social-hub/views/format';
import type { Offerer } from '@/lib/social-hub/views/offer';

/**
 * Today's content across every type, side by side: a row that scrolls
 * sideways. A card opens the post, where every action and number lives.
 */
export function TodayStrip({ posts, o }: { posts: HubPost[]; o: Offerer }) {
  return (
    <ul className="sh-strip" aria-label="Today’s content">
      {posts.map((post) => {
        const when = post.postedAt ?? post.publishAt;
        return (
          <li key={post.id} className="sh-panel sh-strip__card" style={{ listStyle: 'none' }}>
            <PostLink id={post.id} className="sh-strip__art" decorative>
              <Thumb post={post} size="lg" />
            </PostLink>
            <div className="sh-strip__meta">
              <TypeMark vertical={post.vertical} />
              <span>{when ? clock(when) : 'Not placed'}</span>
            </div>
            <PostLink id={post.id} className="sh-strip__name">{displayName(post)}</PostLink>
            <StateBadge state={o.offer(post).state} />
          </li>
        );
      })}
    </ul>
  );
}
