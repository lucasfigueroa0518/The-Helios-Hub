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
import { dayWord, displayName } from '@/lib/social-hub/views/format';
import { leadDaysFor } from '@/lib/social-hub/lead';
import type { StorySeries } from '@/lib/social-hub/slots/types';
import { addDays, nyDateOf } from '@/lib/social-hub/time';
import type { Offerer } from '@/lib/social-hub/views/offer';
import { canMakeCard, runForCandidate, runOnMadeCard } from '@/lib/social-hub/views/run-for';

/**
 * Today's Content (spec 2026-10-13 §2): the day's cards in one row, in posting
 * order. A made card shows the content itself (hover to play or step through)
 * and its buttons; a card not made yet shows its idea and Make it, and says
 * why when today's run for it didn't finish (Phase B, B6).
 *
 * `day` (the look-ahead tabs): a later day's cards. Make it, run chips and run
 * misses are today's, so a later day shows none of them; an empty slot says
 * which night makes it (lib/social-hub/lead.ts).
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

export function TodayStrip({ candidates, o, runs, now, misses = NO_MISSES, controls = true, day, label = 'Today’s content' }: { candidates: QuotaCandidate[]; o: Offerer; now: Date; runs: AllProgress; misses?: RunMisses; /** False on the preview page: buttons show but can't be clicked, and Make it is hidden. */ controls?: boolean; /** A later New York day (the look-ahead tabs); omitted for today. */ day?: string; label?: string }) {
  const ahead = Boolean(day && day > nyDateOf(now)!);
  return (
    <ul className="sh-strip sh-gallery" aria-label={label}>
      {candidates.map((c, i) => {
        const run = ahead ? null : runForCandidate(c, runs);
        return c.post
          ? <Made key={c.post.id} post={c.post} o={o} now={now} run={ahead ? null : runOnMadeCard(c.post, run)} controls={controls} />
          : ahead
            ? <Ahead key={c.idea?.id ?? `${c.vertical}:${c.series ?? i}`} c={c} day={day!} now={now} />
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

/** The night (New York date) whose run makes this slot's post: the day minus the type's lead days. */
export function nightFor(c: QuotaCandidate, day: string): string {
  const series = c.vertical === 'stories' ? ((c.seriesId?.split(':').pop() ?? null) as StorySeries | null) : null;
  return addDays(day, -leadDaysFor(c.vertical, series));
}

/** A later day's empty slot: nothing to make from here; say which night makes it, or that its night has passed. */
function Ahead({ c, day, now }: { c: QuotaCandidate; day: string; now: Date }) {
  const Icon = TYPE_ICON[c.vertical];
  const night = nightFor(c, day);
  const today = nyDateOf(now)!;
  const passed = night <= today;
  const line = passed ? `${ranOn(night, now)} made nothing for this slot.` : `${runsOn(night, now)} makes it.`;
  return (
    <li className="sh-panel sh-strip__card sh-gallery__card is-pending" style={{ listStyle: 'none' }}>
      <span className={`sh-strip__art sh-gallery__art${c.vertical === 'carousels' ? '' : ' is-tall'}`}>
        <span className="sh-gallery__frame" style={typeStyle(c.vertical)} aria-hidden="true">
          <span className="sh-gallery__empty">{passed ? <TriangleAlert size={22} /> : <Icon size={22} />}{passed ? 'Not made' : 'Not made yet'}</span>
        </span>
      </span>
      <div className="sh-gallery__meta">
        <TypeMark vertical={c.vertical} />
        <span>{c.series ?? 'Open slot'}</span>
      </div>
      <span className="sh-strip__name">{c.series ? `${c.series}: that day’s set` : 'Open slot'}</span>
      <span className="sh-muted sh-gallery__hint">{line}</span>
    </li>
  );
}

/** A night run that already ran (runs start just after midnight on their date): "This morning’s run", "Yesterday’s run", "The Fri Nov 13 run". */
function ranOn(night: string, now: Date): string {
  const word = dayWord(night, now);
  return word === 'Today' ? 'This morning’s run' : word === 'Yesterday' ? 'Yesterday’s run' : `The ${word} run`;
}

/** A night run still ahead: "Tonight’s run" (just after midnight), else "The run early on Tue Nov 17". */
function runsOn(night: string, now: Date): string {
  const word = dayWord(night, now);
  return word === 'Tomorrow' ? 'Tonight’s run' : `The run early on ${word}`;
}
