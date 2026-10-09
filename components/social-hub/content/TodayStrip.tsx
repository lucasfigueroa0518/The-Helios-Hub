import { PostLink } from '@/components/social-hub/nav/PostLink';
import { StateBadge, TYPE_ICON, TypeMark, typeStyle } from '@/components/social-hub/ui/marks';
import { thumbOf } from '@/components/social-hub/ui/Thumb';
import type { HubPost } from '@/lib/social-hub/types';
import { clock, displayName } from '@/lib/social-hub/views/format';
import type { Offerer } from '@/lib/social-hub/views/offer';

/**
 * Today's Content: every type's candidates for today's quota in one row that
 * scrolls sideways, each card showing the content itself (first frame, cover
 * slide, or the video's opening frame). A card opens the post, where every
 * action and number lives.
 */
export function TodayStrip({ posts, o }: { posts: HubPost[]; o: Offerer }) {
  return (
    <ul className="sh-strip sh-gallery" aria-label="Today’s content">
      {posts.map((post) => {
        const when = post.postedAt ?? post.publishAt;
        const state = o.offer(post).state;
        return (
          <li key={post.id} className="sh-panel sh-strip__card sh-gallery__card" style={{ listStyle: 'none' }}>
            <PostLink id={post.id} className={`sh-strip__art sh-gallery__art${post.format === 'feed' ? '' : ' is-tall'}`} decorative>
              <Art post={post} />
            </PostLink>
            <div className="sh-gallery__meta">
              <TypeMark vertical={post.vertical} />
              <span>{when ? clock(when) : post.status === 'generating' ? 'Being made' : 'No slot yet'}</span>
            </div>
            <PostLink id={post.id} className="sh-strip__name">{displayName(post)}</PostLink>
            <StateBadge state={state} />
          </li>
        );
      })}
    </ul>
  );
}

function Art({ post }: { post: HubPost }) {
  const { src, count, remote } = thumbOf(post.media);
  const Icon = TYPE_ICON[post.vertical];
  const video = post.media.kind === 'video' && !src ? post.media.src : null;
  return (
    <span className="sh-gallery__frame" style={typeStyle(post.vertical)} aria-hidden="true">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" decoding="async" {...(remote ? { referrerPolicy: 'no-referrer' as const } : {})} />
      ) : video ? (
        // No poster: the browser shows the video's opening frame.
        <video src={`${video}#t=0.5`} muted playsInline preload="metadata" />
      ) : (
        <span className="sh-gallery__empty"><Icon size={22} />{post.status === 'generating' ? 'Being made' : 'No preview'}</span>
      )}
      {count && count > 1 ? <span className="sh-thumb__count">{count}</span> : null}
    </span>
  );
}
