import { PostLink } from '@/components/social-hub/nav/PostLink';
import { StateBadge, TYPE_ICON, TypeMark, typeStyle } from '@/components/social-hub/ui/marks';
import { thumbOf } from '@/components/social-hub/ui/Thumb';
import type { HubPost } from '@/lib/social-hub/types';
import type { QuotaCandidate } from '@/lib/social-hub/views/day-rank';
import { clock, displayName } from '@/lib/social-hub/views/format';
import type { Offerer } from '@/lib/social-hub/views/offer';

/**
 * Today's Content: every type's quota candidates in one row that scrolls
 * sideways. A candidate with content shows the content itself (first frame,
 * cover slide, or the video's opening frame) and opens the post; one not
 * made yet shows its idea, which Run now makes.
 */
export function TodayStrip({ candidates, o }: { candidates: QuotaCandidate[]; o: Offerer }) {
  return (
    <ul className="sh-strip sh-gallery" aria-label="Today’s content">
      {candidates.map((c, i) => (c.post ? <Made key={c.post.id} c={c} post={c.post} o={o} /> : <Pending key={c.idea?.id ?? `${c.vertical}:${c.series ?? i}`} c={c} />))}
    </ul>
  );
}

function rankTag(c: QuotaCandidate): string | null {
  if (c.rank == null) return null;
  return `#${c.rank}${c.moved === 'promoted' ? ' · Promoted' : c.moved === 'demoted' ? ' · Demoted' : ''}`;
}

function Made({ c, post, o }: { c: QuotaCandidate; post: HubPost; o: Offerer }) {
  const when = post.postedAt ?? post.publishAt;
  const tag = rankTag(c);
  return (
    <li className="sh-panel sh-strip__card sh-gallery__card" style={{ listStyle: 'none' }}>
      <PostLink id={post.id} className={`sh-strip__art sh-gallery__art${post.format === 'feed' ? '' : ' is-tall'}`} decorative>
        <Art post={post} />
      </PostLink>
      <div className="sh-gallery__meta">
        <TypeMark vertical={post.vertical} />
        <span>{when ? clock(when) : post.status === 'generating' ? 'Being made' : 'No slot yet'}{tag ? ` · ${tag}` : ''}</span>
      </div>
      <PostLink id={post.id} className="sh-strip__name">{displayName(post)}</PostLink>
      <StateBadge state={o.offer(post).state} />
    </li>
  );
}

function Pending({ c }: { c: QuotaCandidate }) {
  const Icon = TYPE_ICON[c.vertical];
  const tag = rankTag(c);
  return (
    <li className="sh-panel sh-strip__card sh-gallery__card is-pending" style={{ listStyle: 'none' }}>
      <span className={`sh-strip__art sh-gallery__art${c.vertical === 'carousels' ? '' : ' is-tall'}`}>
        <span className="sh-gallery__frame" style={typeStyle(c.vertical)} aria-hidden="true">
          <span className="sh-gallery__empty"><Icon size={22} />Not made yet</span>
        </span>
      </span>
      <div className="sh-gallery__meta">
        <TypeMark vertical={c.vertical} />
        <span>{tag ?? (c.series ? c.series : 'Quota candidate')}</span>
      </div>
      <span className="sh-strip__name">{c.idea?.title ?? (c.series ? `${c.series}: today’s set` : 'Open slot: the next run picks its idea')}</span>
      <span className="sh-muted sh-gallery__hint">Run now makes it.</span>
    </li>
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
