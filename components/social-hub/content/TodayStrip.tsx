import { Loader2 } from 'lucide-react';

import type { AllProgress, ProgressItem } from '@/lib/content-type/progress';
import { stageLabel } from '@/lib/content-type/run-status';
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
/** The run behind a candidate: its own (Explainers name the topic), else the type's run in flight (Carousels and Stories run as a batch). */
function runFor(c: QuotaCandidate, runs: AllProgress): ProgressItem | null {
  if (c.vertical === 'reels') return null;
  const items = runs[c.vertical];
  const own = items.find((i) => i.topicId && c.idea && (c.idea.id === i.topicId || c.idea.id.endsWith(`:${i.topicId}`)));
  if (own) return own;
  if (c.vertical === 'explainers') return null;
  if (c.vertical === 'stories' && c.series) return items.find((i) => i.label === c.series) ?? null;
  return c.post && c.post.status !== 'generating' ? null : items.find((i) => i.state === 'running') ?? items[0] ?? null;
}

function RunChip({ run }: { run: ProgressItem | null }) {
  if (!run) return null;
  return (
    <span className="sh-run-chip" role="status">
      <Loader2 size={13} className="sh-spin" aria-hidden="true" />
      {run.state === 'running' ? stageLabel(run.stage) : 'Queued'}
    </span>
  );
}

export function TodayStrip({ candidates, o, runs }: { candidates: QuotaCandidate[]; o: Offerer; runs: AllProgress }) {
  return (
    <ul className="sh-strip sh-gallery" aria-label="Today’s content">
      {candidates.map((c, i) => (c.post ? <Made key={c.post.id} c={c} post={c.post} o={o} run={runFor(c, runs)} /> : <Pending key={c.idea?.id ?? `${c.vertical}:${c.series ?? i}`} c={c} run={runFor(c, runs)} />))}
    </ul>
  );
}

function rankTag(c: QuotaCandidate): string | null {
  if (c.rank == null) return null;
  return `#${c.rank}${c.moved === 'promoted' ? ' · Promoted' : c.moved === 'demoted' ? ' · Demoted' : ''}`;
}

function Made({ c, post, o, run }: { c: QuotaCandidate; post: HubPost; o: Offerer; run: ProgressItem | null }) {
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
      {run ? <RunChip run={run} /> : <StateBadge state={o.offer(post).state} />}
    </li>
  );
}

function Pending({ c, run }: { c: QuotaCandidate; run: ProgressItem | null }) {
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
      {run ? <RunChip run={run} /> : <span className="sh-muted sh-gallery__hint">Run now makes it.</span>}
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
