'use client';

import { ChevronRight, Lock } from 'lucide-react';
import { useEffect, useRef, useState, type TouchEvent } from 'react';

import { PostLink } from '@/components/social-hub/nav/PostLink';
import { typeStyle } from '@/components/social-hub/ui/marks';
import type { SlimPost } from '@/components/social-hub/calendar/SlotCard';
import { clockLabel } from '@/lib/social-hub/slots/times';
import { WEEKDAY_SHORT } from '@/lib/social-hub/time';
import { chipNames, type BoardCard, type BoardColumn, type CardStatus } from '@/lib/social-hub/views/week';

/**
 * The Week on a phone (planning/Social Hub/Calendar Look-back/PLAN.md, 2026-11-15): one day at a time.
 * A Mon–Sun strip (tap, or swipe the list), then the day's slots as full-width rows in time order.
 * A posted row opens its analytics (the post drawer); any other row opens the same slot details
 * as the desktop board (move, remove, Trial / Main). Nothing drags here. Shown by CSS under 640px.
 */

const STATE_WORD: Record<CardStatus, string> = {
  empty: 'Open slot',
  waiting: 'Waiting for approval',
  approved: 'Ready',
  started: 'Started',
  posted: 'Posted',
};

export function DayAgenda({ columns, byDay, editable, dim, onOpen, onFlip }: {
  columns: readonly BoardColumn[];
  /** Each day's cards, as the board draws them (a past day holds only what posted). */
  byDay: ReadonlyArray<ReadonlyArray<BoardCard<SlimPost>>>;
  editable: boolean;
  dim: string | null;
  onOpen: (card: BoardCard<SlimPost>, anchor: HTMLElement) => void;
  onFlip: (card: BoardCard<SlimPost>) => void;
}) {
  const todayIndex = columns.findIndex((c) => c.isToday);
  const first = todayIndex >= 0 ? todayIndex : 0;
  const [day, setDay] = useState(first);
  // Another week opens on its today, or its Monday.
  const weekKey = columns[0]?.nyDate;
  useEffect(() => { setDay(first); }, [weekKey, first]);

  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => { const t = e.touches[0]!; touch.current = { x: t.clientX, y: t.clientY }; };
  const onTouchEnd = (e: TouchEvent) => {
    const s = touch.current;
    touch.current = null;
    if (!s) return;
    const t = e.changedTouches[0]!;
    const dx = t.clientX - s.x;
    // A clear sideways swipe changes day; a scroll (mostly vertical) doesn't.
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(t.clientY - s.y) * 1.5) return;
    setDay((d) => Math.min(columns.length - 1, Math.max(0, d + (dx < 0 ? 1 : -1))));
  };

  const col = columns[day];
  // Time order (a past day's posts placed by when they went out come after its slot cards in the model).
  const cards = [...(byDay[day] ?? [])].sort((a, b) => a.startMinute - b.startMinute || a.key.localeCompare(b.key));
  if (!col) return null;
  const title = `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][col.weekday]}, ${new Date(`${col.nyDate}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })}`;

  return (
    <div className="sh-agenda">
      <div className="sh-agenda__strip" role="tablist" aria-label="Day">
        {columns.map((c, i) => (
          <button
            key={c.nyDate}
            type="button"
            role="tab"
            className="sh-agenda__day"
            aria-selected={i === day}
            data-today={c.isToday ? 'true' : undefined}
            data-past={c.past ? 'true' : undefined}
            onClick={() => setDay(i)}
          >
            <span className="sh-agenda__wd">{WEEKDAY_SHORT[c.weekday]}</span>
            <span className="sh-agenda__dn">{Number(c.nyDate.slice(8))}</span>
            <span className="sh-agenda__n" aria-label={c.past ? `${c.count} posted` : `${c.count} slots`}>{c.count}</span>
          </button>
        ))}
      </div>

      <div className="sh-agenda__body" role="tabpanel" aria-label={title} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <p className="sh-agenda__title">
          {title}
          {col.isToday ? <span className="sh-board__badge sh-board__badge--today">Today</span> : null}
          {col.past ? <span className="sh-board__badge">Posted</span> : null}
          {col.edited ? <span className="sh-board__badge sh-board__badge--edited">Edited</span> : null}
        </p>
        {cards.length === 0 ? (
          <p className="sh-agenda__empty">{col.past ? 'Nothing posted this day.' : 'No slots this day.'}</p>
        ) : (
          <ul className="sh-agenda__list">
            {cards.map((card) => <Row key={card.key} card={card} editable={editable} dimmed={dim !== null && dim !== card.vertical} onOpen={onOpen} onFlip={onFlip} />)}
          </ul>
        )}
      </div>
    </div>
  );
}

function Row({ card, editable, dimmed, onOpen, onFlip }: {
  card: BoardCard<SlimPost>;
  editable: boolean;
  dimmed: boolean;
  onOpen: (card: BoardCard<SlimPost>, anchor: HTMLElement) => void;
  onFlip: (card: BoardCard<SlimPost>) => void;
}) {
  const names = chipNames(card.vertical, card.series);
  const post = card.booked;
  const posted = card.status === 'posted' && post ? post : null;
  const lead = posted?.lead ?? null;
  const line = posted ? (lead ? lead.label : 'Posted') : post ? `${STATE_WORD[card.status]} · ${post.name}` : card.overCap ? 'Over today’s limit' : STATE_WORD[card.status];
  const main = (
    <>
      <span className="sh-agenda__time">{clockLabel(card.startMinute)}</span>
      <span className="sh-agenda__main">
        <span className="sh-agenda__type"><span className="sh-board__dot" aria-hidden="true" />{names.full}</span>
        <span className="sh-agenda__name">{posted ? posted.name : line}</span>
        {posted ? <span className="sh-agenda__line">{line}</span> : null}
      </span>
      {card.locked && !posted ? <Lock size={14} className="sh-board__lock" aria-hidden="true" /> : null}
      <ChevronRight size={16} className="sh-agenda__go" aria-hidden="true" />
    </>
  );
  const canFlip = editable && !card.locked && card.feedMode != null;
  return (
    <li className="sh-agenda__row" style={typeStyle(card.vertical)} data-status={card.status} data-dimmed={dimmed ? 'true' : undefined}>
      {posted ? (
        <PostLink id={posted.id} className="sh-agenda__open" label={`${clockLabel(card.startMinute)}, ${names.full}: ${posted.name}${lead ? `, ${lead.label}` : ''}. Open its analytics`}>{main}</PostLink>
      ) : (
        <button type="button" className="sh-agenda__open" aria-haspopup="dialog" onClick={(e) => onOpen(card, e.currentTarget)}>{main}</button>
      )}
      {card.feedMode && !card.locked ? (
        <button
          type="button"
          className="sh-agenda__tag sh-board__tag"
          data-mode={card.feedMode}
          disabled={!canFlip}
          aria-label={`${card.feedMode === 'trial' ? 'Trial reel' : 'Main feed'}${canFlip ? `. Switch to ${card.feedMode === 'trial' ? 'Main feed' : 'Trial reel'}` : ''}`}
          onClick={() => { if (canFlip) onFlip(card); }}
        >
          {card.feedMode === 'trial' ? 'Trial' : 'Main'}
        </button>
      ) : null}
    </li>
  );
}
