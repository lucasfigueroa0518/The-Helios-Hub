import { Loader2, TriangleAlert } from 'lucide-react';

import type { AllProgress, ProgressItem } from '@/lib/content-type/progress';
import { missFor, NO_MISSES, type RunMiss, type RunMisses } from '@/lib/content-type/run-misses';
import { stageLabel } from '@/lib/content-type/run-status';
import { CardMedia } from '@/components/social-hub/content/CardMedia';
import { MakeItButton } from '@/components/social-hub/content/MakeItButton';
import { ActionBar } from '@/components/social-hub/house/ActionBar';
import { PostLink } from '@/components/social-hub/nav/PostLink';
import { StateBadge, TYPE_ICON, TypeMark, typeStyle } from '@/components/social-hub/ui/marks';
import type { HubPost } from '@/lib/social-hub/types';
import { ideaRef } from '@/lib/social-hub/run-today';
import { cardTimeLine } from '@/lib/social-hub/views/card-time';
import type { QuotaCandidate } from '@/lib/social-hub/views/day-rank';
import { displayName } from '@/lib/social-hub/views/format';
import type { Offerer } from '@/lib/social-hub/views/offer';
import { canMakeCard, runForCandidate, runOnMadeCard } from '@/lib/social-hub/views/run-for';

/**
 * Today's Content (spec 2026-10-13 §2): the day's cards in one row, in posting
 * order. A made card shows the content itself (hover to play or step through)
 * and its buttons; a card not made yet shows its idea and Make it, and says
 * why when today's run for it didn't finish (Phase B, B6).
 */

function RunChip({ run }: { run: ProgressItem | null }) {
  if (!run) return null;
  return (
    <span className="sh-run-chip" role="status">
      <Loader2 size={13} className="sh-spin" aria-hidden="true" />
      {run.state === 'running' ? stageLabel(run.stage) : 'Queued'}
    </span>
  );
}

export function TodayStrip({ candidates, o, runs, now, misses = NO_MISSES, controls = true }: { candidates: QuotaCandidate[]; o: Offerer; now: Date; runs: AllProgress; misses?: RunMisses; /** False on the preview page: buttons show but can't be clicked, and Make it is hidden. */ controls?: boolean }) {
  return (
    <ul className="sh-strip sh-gallery" aria-label="Today’s content">
      {candidates.map((c, i) => {
        const run = runForCandidate(c, runs);
        return c.post
          ? <Made key={c.post.id} post={c.post} o={o} now={now} run={runOnMadeCard(c.post, run)} controls={controls} />
          : <Pending key={c.idea?.id ?? `${c.vertical}:${c.series ?? i}`} c={c} run={run} miss={missFor(c, misses, run)} controls={controls} />;
      })}
    </ul>
  );
}

function Made({ post, o, now, run, controls }: { post: HubPost; o: Offerer; now: Date; run: ProgressItem | null; controls: boolean }) {
  const offer = o.offer(post);
  const { primary, grid } = offer.card;
  return (
    <li className="sh-panel sh-strip__card sh-gallery__card" style={{ listStyle: 'none' }}>
      <CardMedia post={post} />
      <div className="sh-gallery__meta">
        <TypeMark vertical={post.vertical} />
        <span>{cardTimeLine(post, now)}</span>
      </div>
      <PostLink id={post.id} className="sh-strip__name">{displayName(post)}</PostLink>
      {run ? <RunChip run={run} /> : <StateBadge state={offer.state} />}
      {post.status === 'published' && post.permalink ? (
        <a className="sh-out sh-gallery__view" href={post.permalink} target="_blank" rel="noreferrer">View on Instagram</a>
      ) : null}
      {!run && (primary || grid.length) ? (
        <ActionBar menu={{ primary, secondary: grid, more: [], links: [], offNote: null }} variant="card" showOffNote={false} readOnly={!controls} />
      ) : null}
    </li>
  );
}

function Pending({ c, run, miss, controls }: { c: QuotaCandidate; run: ProgressItem | null; miss: RunMiss | null; controls: boolean }) {
  const Icon = TYPE_ICON[c.vertical];
  const tag = c.rank == null ? null : `#${c.rank} in the queue${c.tag ? ` · ${c.tag.text}` : ''}`;
  const target = c.vertical === 'stories' ? c.seriesId : c.idea ? ideaRef(c.idea.id) : undefined;
  return (
    <li className="sh-panel sh-strip__card sh-gallery__card is-pending" style={{ listStyle: 'none' }}>
      <span className={`sh-strip__art sh-gallery__art${c.vertical === 'carousels' ? '' : ' is-tall'}`}>
        <span className="sh-gallery__frame" style={typeStyle(c.vertical)} aria-hidden="true">
          {miss
            ? <span className="sh-gallery__empty"><TriangleAlert size={22} />{miss.title}</span>
            : <span className="sh-gallery__empty"><Icon size={22} />Not made yet</span>}
        </span>
      </span>
      <div className="sh-gallery__meta">
        <TypeMark vertical={c.vertical} />
        <span>{tag ?? (c.series ? c.series : 'Open slot')}</span>
      </div>
      <span className="sh-strip__name">{c.idea?.title ?? (c.series ? `${c.series}: today’s set` : 'Open slot: the next run picks its idea')}</span>
      {miss ? <span className="sh-muted sh-gallery__hint" role="status">{miss.title}{miss.detail ? `: ${miss.detail}` : ''}</span> : null}
      {run ? <RunChip run={run} /> : !controls ? <span className="sh-muted sh-gallery__hint">Make it builds this card.</span> : canMakeCard(c) ? <MakeItButton vertical={c.vertical} target={target} /> : <span className="sh-muted sh-gallery__hint">Run now makes it.</span>}
    </li>
  );
}
