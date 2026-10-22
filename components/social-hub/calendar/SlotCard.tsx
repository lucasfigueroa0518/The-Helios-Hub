'use client';

import { Check, Lock, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';

import { PostLink } from '@/components/social-hub/nav/PostLink';
import { Menu } from '@/components/social-hub/ui/Menu';
import { typeStyle } from '@/components/social-hub/ui/marks';
import { clockLabel, GRID, LAST_START, DAY_START } from '@/lib/social-hub/slots/times';
import type { FeedMode } from '@/lib/social-hub/slots/types';
import { chipNames, CARD_MINUTES, laterNote, type BoardCard, type BoardColumn, type BoardPost } from '@/lib/social-hub/views/week';
import { WEEKDAY_LONG } from '@/lib/social-hub/views/week-edit';

/**
 * One slot on the week board (spec decisions 3, 4, 9): a one-line card at its
 * time (time · dot · short name · booked mark · Trial/Main tag), and the
 * details panel it opens. The panel floats in the viewport (fixed), so no
 * column, scroll box or later card can cover or clip it.
 */

export type SlimPost = BoardPost & { name: string; refs: Record<string, string>; thumb: string | null };

const AXIS = 21 * 60 - 8 * 60;

/** "8:45", "6:00p": the card's compact time (the full time is in its label). */
export function shortClock(m: number): string {
  const h = Math.floor(m / 60);
  const t = `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, '0')}`;
  return h >= 12 ? `${t}p` : t;
}

const modeWord = (m: FeedMode) => (m === 'trial' ? 'Trial reel' : 'Main feed');

export function cardLabel(card: BoardCard<SlimPost>, when: string): string {
  const { full } = chipNames(card.vertical, card.series);
  return [
    full,
    `${when}, ${clockLabel(card.startMinute)}`,
    card.feedMode ? modeWord(card.feedMode) : null,
    card.booked ? `post booked: ${card.booked.name}` : null,
    card.statusText,
    card.locked ? 'locked' : null,
  ].filter(Boolean).join(', ');
}

export function SlotCard({ card, top, when, editable, dimmed, faded, open, dragProps, onOpen, onFlip, select }: {
  card: BoardCard<SlimPost>;
  /** The drawn y in axis minutes (stackOffsets): its true time, or lower when a crowded stack pushed it. */
  top: number;
  /** "Wed Oct 21" or "every Wednesday", for the spoken label. */
  when: string;
  editable: boolean;
  dimmed: boolean;
  /** This card is the one being dragged. */
  faded: boolean;
  open: boolean;
  dragProps: Record<string, unknown>;
  onOpen: (anchor: HTMLElement) => void;
  onFlip: () => void;
  /** Select mode (spec 2026-10-21 §2): a click toggles the card in the selection instead of opening it. */
  select?: { selected: boolean; onToggle: () => void } | null;
}) {
  const names = chipNames(card.vertical, card.series);
  const style: CSSProperties = {
    ...typeStyle(card.vertical),
    top: `${(top / AXIS) * 100}%`,
    // 2px short so stacked or back-to-back cards (8:30, 9:00) keep a hairline gap.
    height: `calc(${(CARD_MINUTES / AXIS) * 100}% - 2px)`,
    left: '4px',
    right: '4px',
  };
  const canFlip = editable && !card.locked && card.feedMode != null && !select;
  const activate = (el: HTMLElement) => (select ? select.onToggle() : onOpen(el));
  return (
    <div
      className="sh-board__card"
      style={style}
      data-status={card.status}
      data-selected={select?.selected ? 'true' : undefined}
      data-selecting={select ? 'true' : undefined}
      data-locked={card.locked ? 'true' : undefined}
      data-open={open ? 'true' : undefined}
      data-dimmed={dimmed ? 'true' : undefined}
      data-faded={faded ? 'true' : undefined}
      data-over-cap={card.overCap ? 'true' : undefined}
      data-card={card.key}
      {...dragProps}
      // In select mode the whole card toggles, the Trial / Main tag included.
      onClick={select ? () => select.onToggle() : undefined}
    >
      <div
        role="button"
        tabIndex={0}
        className="sh-board__open"
        aria-label={cardLabel(card, when)}
        aria-haspopup={select ? undefined : 'dialog'}
        aria-expanded={select ? undefined : open}
        aria-pressed={select ? select.selected : undefined}
        title={`${names.full} · ${clockLabel(card.startMinute)}`}
        onClick={select ? undefined : (e) => onOpen(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(e.currentTarget); }
        }}
      >
        {select?.selected ? <Check size={11} className="sh-board__check" aria-hidden="true" /> : null}
        <span className="sh-board__time" aria-hidden="true">{shortClock(card.startMinute)}</span>
        <span className="sh-board__name" aria-hidden="true">
          <span className="sh-board__dot" />
          <span className="sh-board__short">{names.short}</span>
        </span>
        {card.booked ? <span className="sh-board__mark" aria-hidden="true" title="A post is booked for this slot" /> : null}
        {card.locked && card.status !== 'posted' ? <Lock size={11} className="sh-board__lock" aria-hidden="true" /> : null}
      </div>
      {/* No tag on a locked card: it can't flip, and the lock needs the room (Trial / Main stays in the label and panel). */}
      {card.feedMode && !card.locked && select ? (
        <span className="sh-board__tag" data-mode={card.feedMode} aria-hidden="true">{card.feedMode === 'trial' ? 'Trial' : 'Main'}</span>
      ) : card.feedMode && !card.locked ? (
        <button
          type="button"
          className="sh-board__tag"
          data-mode={card.feedMode}
          disabled={!canFlip}
          aria-label={canFlip ? `${modeWord(card.feedMode)}. Switch to ${card.feedMode === 'trial' ? 'Main feed' : 'Trial reel'}` : modeWord(card.feedMode)}
          title={canFlip ? 'Click to switch Trial / Main' : undefined}
          onClick={(e) => { e.stopPropagation(); if (canFlip) onFlip(); }}
        >
          {card.feedMode === 'trial' ? 'Trial' : 'Main'}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Fixed position beside `anchor`, flipped left when asked or when the right
 * side has no room; held inside the viewport. Below 640px it is a bottom
 * sheet (CSS). Follows the anchor on scroll and resize.
 */
export function useFloating(anchor: HTMLElement | null, flip: boolean, width = 320) {
  const ref = useRef<HTMLDivElement>(null);
  // Transparent, not hidden, until placed: a visibility-hidden panel can't take focus (fix round 1, #3).
  const [style, setStyle] = useState<CSSProperties>({ opacity: 0 });
  useLayoutEffect(() => {
    if (!anchor) return;
    let frame = 0;
    const place = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = anchor.getBoundingClientRect();
        const h = ref.current?.offsetHeight ?? 320;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        if (vw < 640) { setStyle({}); return; }
        const gap = 8;
        const right = r.right + gap;
        const left = r.left - gap - width;
        const x = (flip && left >= 8) || right + width > vw - 8 ? Math.max(8, left) : right;
        const y = Math.min(Math.max(8, r.top - 6), Math.max(8, vh - h - 8));
        setStyle({ left: x, top: y, width });
      });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [anchor, flip, width]);
  return { ref, style };
}

/** Esc and an outside click close; focus goes into the panel when it opens and back to the anchor on Esc. */
export function useDismiss(ref: RefObject<HTMLElement | null>, anchor: HTMLElement | null, onClose: (refocus: boolean) => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]') || ref.current?.querySelector('.sh-menu__list')) return;
      e.preventDefault();
      close.current(true);
    };
    const down = (e: PointerEvent) => {
      if (document.querySelector('dialog[open]')) return;
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.closest('[data-card], [data-pick]')?.contains(t)) return;
      close.current(false);
    };
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', down);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', down); };
  }, [ref, anchor]);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
  }, [ref, anchor]);
}

/** Every 15 minutes from 8:00 AM to 8:45 PM (the last start that posts by 9 PM). */
export const TIME_OPTIONS: number[] = Array.from({ length: (LAST_START - DAY_START) / GRID + 1 }, (_, i) => DAY_START + i * GRID);

/** Day and time as hub menus (DESIGN.md: no native selects): the keyboard and touch path for everything a drag does. */
export function DayTimePicker({ dayLabel, days, day, minute, onDay, onMinute, times = TIME_OPTIONS }: {
  dayLabel: string;
  /** The times the chosen day can still take (openMinutes); every mark by default. */
  times?: readonly number[];
  days: Array<{ day: number; label: string }>;
  day: number;
  minute: number;
  onDay: (day: number) => void;
  onMinute: (minute: number) => void;
}) {
  return (
    <>
      <Menu label={dayLabel} value={String(day)} align="left" options={days.map((d) => ({ value: String(d.day), label: d.label }))} onSelect={(v) => onDay(Number(v))} />
      <Menu label="Time" value={String(minute)} align="left" options={times.map((m) => ({ value: String(m), label: clockLabel(m) }))} onSelect={(v) => onMinute(Number(v))} />
    </>
  );
}

export function Floating({ anchor, flip, label, onClose, children, width }: { anchor: HTMLElement; flip: boolean; label: string; onClose: (refocus: boolean) => void; children: ReactNode; width?: number }) {
  const { ref, style } = useFloating(anchor, flip, width);
  const titleId = useId();
  useDismiss(ref, anchor, (refocus) => {
    onClose(refocus);
    if (refocus) anchor.focus();
  });
  return (
    <div ref={ref} className="sh-board__panel" style={style} role="dialog" aria-modal="false" aria-labelledby={titleId}>
      <div className="sh-board__panel-head">
        <h3 id={titleId} tabIndex={-1} data-autofocus>{label}</h3>
        <button type="button" className="sh-btn sh-btn--icon sh-btn--quiet" aria-label="Close" onClick={() => { onClose(true); anchor.focus(); }}><X size={14} aria-hidden="true" /></button>
      </div>
      {children}
    </div>
  );
}

export function SlotPanel({ card, column, anchor, flip, editable, dayOptions, timesFor, onClose, onMode, onMove, onRemove, onReset }: {
  card: BoardCard<SlimPost>;
  column: BoardColumn;
  anchor: HTMLElement;
  flip: boolean;
  editable: boolean;
  /** Days a card can move to: index and label. */
  dayOptions: Array<{ day: number; label: string }>;
  /** The start times a day can still take. */
  timesFor: (day: number) => number[];
  onClose: (refocus: boolean) => void;
  onMode: (m: FeedMode) => void;
  onMove: (to: number, minute: number) => void;
  onRemove: () => void;
  onReset: () => void;
}) {
  const names = chipNames(card.vertical, card.series);
  const when = new Date(`${column.nyDate}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const [to, setTo] = useState(card.day);
  const [minute, setMinute] = useState(card.startMinute);
  const canEdit = editable && !card.locked;
  const what = card.vertical === 'stories' ? `Story · ${names.full}` : names.full;
  const later = laterNote(card);
  return (
    <Floating anchor={anchor} flip={flip} label={what} onClose={onClose}>
      <p className="sh-board__when">{when} · {clockLabel(card.startMinute)}</p>
      <p className="sh-board__status">{card.locked && card.status !== 'posted' ? <Lock size={12} aria-hidden="true" /> : null}<strong>{card.statusText}</strong></p>
      {later ? <p className="sh-subtle">{later}</p> : null}
      {card.booked ? (
        <div className="sh-board__post">
          {card.booked.thumb ? <img src={card.booked.thumb} alt="" width={36} height={36} /> : <span className="sh-board__thumb" style={typeStyle(card.vertical)} aria-hidden="true" />}
          <span className="sh-board__post-name">{card.booked.name}</span>
          <PostLink id={card.booked.id} className="sh-link sh-board__post-open">Open post →</PostLink>
        </div>
      ) : null}
      {card.feedMode ? (
        <div className="sh-board__field">
          <div className="sh-pills" role="group" aria-label="Posts as">
            {(['trial', 'main'] as const).map((m) => (
              <button key={m} type="button" className="sh-pill" aria-pressed={card.feedMode === m} disabled={!canEdit} onClick={() => { if (card.feedMode !== m) onMode(m); }}>
                {m === 'trial' ? 'Trial' : 'Main feed'}
              </button>
            ))}
          </div>
          <p className="sh-subtle">
            {card.feedMode === 'trial'
              ? 'Trial reel: shown to non-followers first; it reaches your followers only if it does well.'
              : 'Main feed: posted to your profile and your followers’ feed.'}
          </p>
        </div>
      ) : null}
      {card.mine ? (
        <p className="sh-board__source">
          You changed this slot for this date.{' '}
          {editable ? <button type="button" className="sh-board__lnk" onClick={onReset}>Reset day</button> : null}
        </p>
      ) : <p className="sh-board__source sh-muted">Comes from the schedule (every {WEEKDAY_LONG[column.weekday]}).</p>}
      {canEdit ? (
        <div className="sh-board__move">
          <DayTimePicker
            dayLabel="Move to"
            days={dayOptions}
            day={to}
            minute={minute}
            times={timesFor(to)}
            onDay={(d) => { setTo(d); const open = timesFor(d); if (!open.includes(minute) && open.length) setMinute(open[0]!); }}
            onMinute={setMinute}
          />
          <button type="button" className="sh-btn" disabled={to === card.day && minute === card.startMinute} onClick={() => onMove(to, minute)}>Move</button>
        </div>
      ) : null}
      {canEdit ? (
        <div className="sh-board__panel-foot">
          <button type="button" className="sh-btn sh-btn--danger" onClick={onRemove}>Remove</button>
        </div>
      ) : !editable ? <p className="sh-subtle">Editing starts when the calendar is switched on.</p> : null}
    </Floating>
  );
}
