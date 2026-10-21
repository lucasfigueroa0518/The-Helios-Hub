import { addDays, nyDateOf, WEEKDAY_SHORT, weekdayOf } from '@/lib/social-hub/time';
import { resolveDay } from '@/lib/social-hub/slots/resolve';
import { isLocked } from '@/lib/social-hub/slots/rules';
import { clockLabel, DAY_END, DAY_START, DRIFT, FEED_GAP, isFeedSlot, isUsual, nyMinuteOf, RUN_HOUR_LABEL } from '@/lib/social-hub/slots/times';
import { slotId, slotKeyString, type FeedMode, type ResolvedSlot, type StorySeries, type TemplateRow } from '@/lib/social-hub/slots/types';
import type { HubPost, Vertical } from '@/lib/social-hub/types';
import { verticalInfo } from '@/lib/social-hub/verticals';
import { SERIES_LABEL } from '@/lib/stories/render/copy';

/** The week board's model (spec 2026-10-20-calendar-week-board-redesign): columns, cards, lanes, time and y. Pure. */

/** Stories run three series, so each chip names its series. */
const SERIES_SHORT: Record<keyof typeof SERIES_LABEL, string> = { morning_download: 'Morning Dl', guess_the_number: 'Guess #', free_vs_paid: 'Free/Paid' };

/** A chip's visible name and its full name (for the aria-label). */
export function chipNames(vertical: Vertical, series: StorySeries | null): { short: string; full: string } {
  if (vertical === 'stories' && series) return { short: SERIES_SHORT[series], full: SERIES_LABEL[series] };
  const info = verticalInfo(vertical);
  return { short: info.short, full: info.label };
}

/** What the "Switch on" confirm needs to say (ruling R8): read on the server before the switch. */
export type SwitchFacts = {
  /** No saved template yet: the first flip copies today's pattern in. null: the template couldn't be read, so it's unknown. */
  templateEmpty: boolean | null;
  /** Last Few Days' auto_run is off. */
  lfdPaused: boolean;
  /** The weekdays (0 = Sunday) that will have an LFD slot after the switch. */
  lfdDays: readonly number[];
};

export const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const WEEKDAY_PLURAL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

function listOf(words: readonly string[]): string {
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** The "Switch on" confirm text: what the calendar does from now on, and what changes the moment it's on. */
export function switchOnCopy(facts: SwitchFacts): string {
  const parts = ['From now on the calendar decides what posts when.'];
  parts.push(
    facts.templateEmpty == null
      ? 'If a calendar was saved before, it comes back; otherwise today’s pattern is copied in.'
      : facts.templateEmpty
        ? 'Today’s pattern is copied in.'
        : 'Your saved calendar from last time comes back, not a fresh copy of today’s settings.',
  );
  if (facts.lfdPaused && facts.lfdDays.length) {
    const days = listOf([...facts.lfdDays].sort((a, b) => a - b).map((d) => WEEKDAY_PLURAL[d]!));
    parts.push(`Last Few Days is paused, so ${days} (its days) will have no Carousels until you edit the calendar.`);
  }
  return parts.join(' ');
}

/** The weekdays a template gives Last Few Days. */
export function lfdWeekdays(template: readonly TemplateRow[]): number[] {
  return [...new Set(template.filter((r) => r.vertical === 'last_few_days').map((r) => r.weekday))].sort((a, b) => a - b);
}

/**
 * A 409's booked posts split for Move back to ready: the ones with an action
 * ref go to the unschedule action; one with none (a reel booked with no idea)
 * would only 400, so the editor names it instead.
 */
export function splitBooked<T extends { refs: Readonly<Record<string, string>> }>(list: readonly T[]): { movable: T[]; stuck: T[] } {
  const movable: T[] = [];
  const stuck: T[] = [];
  for (const b of list) (Object.keys(b.refs).length ? movable : stuck).push(b);
  return { movable, stuck };
}

/** Move back to ready only helps when at least one booked post can go to the unschedule action; Keep it always can. */
export const canMoveBack = (list: ReadonlyArray<{ refs: Readonly<Record<string, string>> }>): boolean => splitBooked(list).movable.length > 0;

export const stuckNote = (n: number): string =>
  `${n} post${n === 1 ? '' : 's'} couldn’t be moved here. Unschedule ${n === 1 ? 'it' : 'them'} from the post page.`;

export type WeekDayInput = { nyDate: string | null; weekday: number; slots: ResolvedSlot[] };

/** A post in one of these holds its slot (the same set the slot writer reports as booked). */
const HOLDS = new Set(['scheduled', 'publishing', 'published']);

export function mondayOf(nyDate: string): string {
  return addDays(nyDate, -((weekdayOf(nyDate) + 6) % 7));
}

/** The seven dates from `monday`, each resolved from a template alone (legacy view, preview). */
export function datedWeek(template: readonly TemplateRow[], monday: string): WeekDayInput[] {
  return Array.from({ length: 7 }, (_, i) => {
    const nyDate = addDays(monday, i);
    return { nyDate, weekday: weekdayOf(nyDate), slots: resolveDay(template, [], nyDate) };
  });
}

/** The template itself, Monday first, with no dates. */
export function templateWeek(template: readonly TemplateRow[], monday: string): WeekDayInput[] {
  return datedWeek(template, monday).map((d) => ({ ...d, nyDate: null }));
}

/** Each weekday's Standard week slots (0 = Sunday), for "Edited" and Reset day. */
export function standardByWeekday(template: readonly TemplateRow[]): Record<number, ResolvedSlot[]> {
  return Object.fromEntries(templateWeek(template, '2026-10-19').map((d) => [d.weekday, d.slots]));
}

/** "Oct 19 – 25", or "Oct 26 – Nov 1" across a month end. */
export function weekLabel(monday: string): string {
  const fmt = (d: string, month: boolean) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { ...(month ? { month: 'short' as const } : {}), day: 'numeric', timeZone: 'UTC' });
  const sunday = addDays(monday, 6);
  return `${fmt(monday, true)} – ${fmt(sunday, sunday.slice(5, 7) !== monday.slice(5, 7))}`;
}


/* ── The board ─────────────────────────────────────────────────────────── */

export type CardStatus = 'empty' | 'waiting' | 'approved' | 'posted' | 'started';

export type BoardColumn = {
  nyDate: string | null;
  weekday: number;
  past: boolean;
  isToday: boolean;
  /** A past day folds into a slim "N posted" column. */
  folded: boolean;
  /** The date's resolved slots differ from its standard weekday (by key, time or mode). */
  edited: boolean;
  /** Folded: the posts that went out. Otherwise: the day's slots. */
  count: number;
};

/** What the board reads of a post: enough to show its slot's status (the page passes slim copies to the client). */
export type BoardPost = Pick<HubPost, 'id' | 'vertical' | 'nyDate' | 'slot' | 'status'> & {
  approval: Pick<HubPost['approval'], 'required' | 'approvedAt'>;
  /** When the booking posts; the details say so when it is later than the slot's drift (spec §Backend, feed spacing). */
  publishAt?: string | null;
};

export type BoardCard<P extends BoardPost = HubPost> = {
  /** Unique across the week: `<day index>|<vertical>|t0780[:series]`. */
  key: string;
  day: number;
  vertical: Vertical;
  series: StorySeries | null;
  startMinute: number;
  feedMode: FeedMode | null;
  origin: 'template' | 'override';
  booked: P | null;
  status: CardStatus;
  statusText: string;
  locked: boolean;
  /** Past the type's daily cap for this day, so the run makes nothing for it. */
  overCap: boolean;
  outsideUsual: boolean;
};

export const STATUS_TEXT = {
  waiting: 'Made, waiting for your approval.',
  approved: 'Ready and approved.',
  posted: 'Posted',
  started: 'Already started.',
  overCap: 'Over today’s limit, so nothing is made for this slot.',
} as const;

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Wed Oct 21". */
export function dayShortLabel(nyDate: string): string {
  const [, m, d] = nyDate.split('-').map(Number);
  return `${WEEKDAY_SHORT[weekdayOf(nyDate)]} ${MONTH_SHORT[m! - 1]} ${d}`;
}

const setOf = (slots: readonly ResolvedSlot[]) => new Set(slots.map((s) => `${slotKeyString(s)}|${s.feedMode ?? ''}`));

function sameSlots(a: readonly ResolvedSlot[], b: readonly ResolvedSlot[]): boolean {
  const x = setOf(a);
  const y = setOf(b);
  return x.size === y.size && [...x].every((k) => y.has(k));
}

const byTimeThenKey = (a: ResolvedSlot, b: ResolvedSlot) => a.startMinute - b.startMinute || slotKeyString(a).localeCompare(slotKeyString(b));

export function boardModel<P extends BoardPost = HubPost>(input: {
  mode: 'week' | 'template';
  days: readonly WeekDayInput[];
  posts: readonly P[];
  now: Date;
  /** The daily caps (readCaps on the live page, DEFAULT_CAPS on the preview). */
  caps: Record<Vertical, number>;
  /** Each weekday's standard slots (0 = Sunday), for "Edited". Without it no day reads as edited. */
  standard?: Readonly<Record<number, readonly ResolvedSlot[]>>;
}): { columns: BoardColumn[]; cards: BoardCard<P>[] } {
  const caps = input.caps;
  const today = nyDateOf(input.now)!;
  const nowMinute = nyMinuteOf(input.now);
  const columns: BoardColumn[] = [];
  const cards: BoardCard<P>[] = [];

  input.days.forEach((d, day) => {
    const dated = input.mode === 'week' && d.nyDate != null;
    const past = dated && d.nyDate! < today;
    const slots = [...d.slots].sort(byTimeThenKey);
    const ctx = { nyDate: dated ? d.nyDate : null, weekday: d.weekday, slots, today, nowMinute };
    const seen = new Map<string, number>();
    const dayCards: BoardCard<P>[] = slots.map((s) => {
      const capKey = s.vertical === 'stories' ? `stories|${s.series ?? ''}` : s.vertical;
      const index = seen.get(capKey) ?? 0;
      seen.set(capKey, index + 1);
      const overCap = index >= Math.max(0, caps[s.vertical]);
      const id = slotId(s.startMinute, s.series);
      const booked = dated
        ? input.posts.find((p) => p.vertical === s.vertical && p.nyDate === d.nyDate && p.slot?.id === id && (HOLDS.has(p.status) || p.status === 'ready')) ?? null
        : null;
      const timeLocked = dated && isLocked(ctx, s);
      let status: CardStatus;
      if (booked?.status === 'published') status = 'posted';
      // Placing is not approving: a booked post that needs a person and has no approval yet is waiting (spec decision 16).
      else if (booked) status = !booked.approval.approvedAt && (booked.status === 'ready' || booked.approval.required) ? 'waiting' : 'approved';
      else status = timeLocked ? 'started' : 'empty';
      const statusText = status === 'empty'
        ? overCap
          ? STATUS_TEXT.overCap
          : d.nyDate && dated
            ? `Empty for now. The ${RUN_HOUR_LABEL[s.vertical]} run makes it on ${dayShortLabel(d.nyDate)}.`
            : `Every ${WEEKDAY_LONG[d.weekday]}. Each week the ${RUN_HOUR_LABEL[s.vertical]} run makes this post on the day.`
        : STATUS_TEXT[status];
      return {
        key: `${day}|${slotKeyString(s)}`,
        day,
        vertical: s.vertical,
        series: s.series,
        startMinute: s.startMinute,
        feedMode: s.feedMode,
        origin: s.origin,
        booked,
        status,
        statusText,
        locked: timeLocked || status === 'posted',
        overCap,
        outsideUsual: !isUsual(s.vertical, s.startMinute),
      };
    });
    const standard = input.standard?.[d.weekday];
    columns.push({
      nyDate: d.nyDate,
      weekday: d.weekday,
      past,
      isToday: dated && d.nyDate === today,
      folded: past,
      edited: dated && standard != null && !sameSlots(d.slots, standard),
      count: past ? dayCards.filter((c) => c.status === 'posted').length : dayCards.length,
    });
    cards.push(...dayCards);
  });
  return { columns, cards };
}

/**
 * The slot's details line when its post was booked later than [slot, slot + 15]:
 * a Main-feed post pushed past another feed post's 30 minutes (book.ts), or a
 * retry. Null when the post goes out inside the slot's drift, or has posted.
 */
export function laterNote(card: Pick<BoardCard<BoardPost>, 'vertical' | 'feedMode' | 'startMinute' | 'booked'>): string | null {
  const b = card.booked;
  if (!b?.publishAt || b.status === 'published') return null;
  const at = new Date(b.publishAt);
  if (Number.isNaN(at.getTime()) || nyDateOf(at) !== b.nyDate) return null;
  const minute = nyMinuteOf(at);
  if (minute <= card.startMinute + DRIFT) return null;
  return isFeedSlot(card)
    ? `Posts at ${clockLabel(minute)}, later than the slot, to keep ${FEED_GAP} minutes from another feed post.`
    : `Posts at ${clockLabel(minute)}, later than the slot.`;
}

/* ── Time and y ────────────────────────────────────────────────────────── */

/** The axis runs 8 AM to 9 PM. */
const SPAN = DAY_END - DAY_START;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Y (0..height) for a minute of the day, held to 8 AM–9 PM; the inverse of minuteForY. */
export const yForMinute = (minute: number, height: number): number => ((clamp(minute, DAY_START, DAY_END) - DAY_START) / SPAN) * height;

/** The raw minute at a y; the caller snaps it (snapMinute). */
export const minuteForY = (y: number, height: number): number => DAY_START + (clamp(y, 0, height) / height) * SPAN;

/**
 * How tall a card is, in minutes of the axis. A card is a one-line chip a bit
 * taller than its 15-minute posting drift, so cards 15 minutes apart still
 * touch and share the width instead of sitting on top of each other.
 */
export const CARD_MINUTES = 30;

/**
 * Side-by-side lanes (spec Must handle 5). Cards on one day whose
 * [start, start + CARD_MINUTES) ranges overlap, transitively, form a cluster.
 * In start order (then key order) each card takes the first lane that is free
 * by its start, so a card goes under one that has ended instead of narrowing
 * every card in the cluster; `of` is the lanes the cluster uses.
 */
export function lanes(cards: readonly Pick<BoardCard, 'key' | 'day' | 'startMinute'>[]): Map<string, { lane: number; of: number }> {
  const out = new Map<string, { lane: number; of: number }>();
  const byDay = new Map<number, Array<Pick<BoardCard, 'key' | 'day' | 'startMinute'>>>();
  for (const c of cards) (byDay.get(c.day) ?? byDay.set(c.day, []).get(c.day)!).push(c);
  for (const list of byDay.values()) {
    list.sort((a, b) => a.startMinute - b.startMinute || a.key.localeCompare(b.key));
    let cluster: Array<{ key: string; lane: number }> = [];
    let ends: number[] = [];
    let end = -Infinity;
    const flush = () => cluster.forEach((c) => out.set(c.key, { lane: c.lane, of: ends.length }));
    for (const c of list) {
      if (cluster.length && c.startMinute >= end) { flush(); cluster = []; ends = []; }
      let lane = ends.findIndex((e) => e <= c.startMinute);
      if (lane < 0) { lane = ends.length; ends.push(0); }
      ends[lane] = c.startMinute + CARD_MINUTES;
      cluster.push({ key: c.key, lane });
      end = Math.max(end, c.startMinute + CARD_MINUTES);
    }
    flush();
  }
  return out;
}
