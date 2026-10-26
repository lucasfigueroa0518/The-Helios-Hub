// lib/social-hub/slots/rules.ts
import { WEEKDAY_SHORT } from '@/lib/social-hub/time';
import type { Vertical } from '@/lib/social-hub/types';

import { LFD_CAROUSEL_CONFLICT, sortSlots } from './resolve';
import {
  clockLabel, DAY_END, DAY_START, DEFAULT_FEED_MODE, DEFAULT_TIMES, FEED_GAP, isFeedSlot, isUsual, LAST_START,
  nearestUsualStart, nextOpenMinute, SERIES_NAME, TYPE_NAME,
} from './times';
import { isReelType, isSlotMinute, sameSlotKey, type FeedMode, type ResolvedSlot, type SlotKey, type StorySeries } from './types';

/**
 * The one placement rule set (week board spec, Must handle §1 and §3). Drag,
 * Move to, Ready to place, gap fixes and Reset day all go through here, on
 * the server and in the client preview. The only place that knows the LFD /
 * Carousel rule, duplicate keys, past/now locking and the 8 AM–9 PM bounds.
 * Pure: "today" and "now" come in with the day.
 */

/** One day's slots. nyDate null is a Standard-week weekday, which has no "now". */
export type DayCtx = { nyDate: string | null; weekday: number; slots: ResolvedSlot[]; today: string; nowMinute: number };

export type Refusal = { ok: false; reason: string; confirm?: 'remove-carousels' };

/** A change a gap's fix button would make; the caller sends it through applyPlace / applyMove / applyRemove. */
export type SlotChangeIntent =
  | { op: 'place'; vertical: Vertical; startMinute: number; series: StorySeries | null; feedMode: FeedMode | null }
  | { op: 'move'; key: SlotKey; toMinute: number }
  | { op: 'remove'; key: SlotKey };

export type Gap = {
  kind: 'no-explainer' | 'no-stories' | 'fewer-than-standard' | 'outside-usual' | 'feed-gap' | 'over-cap';
  text: string;
  fix?: SlotChangeIntent;
};

export const PAST_DAY = 'That day has passed.';
export const NO_TIME_LEFT = 'No time left today.';
export const ALREADY_STARTED = 'Already started.';
export const OUTSIDE_DAY = 'Slots run from 8 AM to 9 PM.';
export const OFF_GRID = 'Pick a time on the 15-minute grid.';
export const NEEDS_SERIES = 'Pick a Stories series.';
export const NO_SERIES = 'Only Stories have a series.';
export const LFD_ONCE = 'Last Few Days runs once a day.';
export const AI_EVENTS_ONCE = 'AI Events posts at most twice a day (Miami and Boston).';
/** AE-29: one post per city, Miami and Boston. */
export const AI_EVENTS_PER_DAY = 2;
export const NOT_ON_DAY = 'That slot isn’t on this day.';
export const CAROUSEL_STARTED = 'A Carousel on that day has already started.';

const refuse = (reason: string, confirm?: 'remove-carousels'): Refusal => (confirm ? { ok: false, reason, confirm } : { ok: false, reason });

const isPastDay = (ctx: DayCtx) => ctx.nyDate !== null && ctx.nyDate < ctx.today;

/** A slot that has started (today, at or before now) or sits on a past day can't move or be removed. */
export function isLocked(ctx: DayCtx, s: Pick<ResolvedSlot, 'startMinute'>): boolean {
  if (ctx.nyDate === null) return false;
  return ctx.nyDate < ctx.today || (ctx.nyDate === ctx.today && s.startMinute <= ctx.nowMinute);
}

const nameOf = (k: Pick<SlotKey, 'vertical' | 'series'>) => (k.series ? SERIES_NAME[k.series] : TYPE_NAME[k.vertical]);

/**
 * Whether a slot may go on this day, and at which minute. A time already
 * passed today moves to the next 15-minute mark; callers use the returned
 * minute and never adjust it themselves. `ignore` is the slot being moved
 * within its own day.
 */
export function canPlace(ctx: DayCtx, s: { vertical: Vertical; startMinute: number; series: StorySeries | null; ignore?: SlotKey }): { ok: true; minute: number } | Refusal {
  if (isPastDay(ctx)) return refuse(PAST_DAY);
  if (!isSlotMinute(s.startMinute)) return refuse(OFF_GRID);
  if (s.startMinute < DAY_START || s.startMinute > LAST_START) return refuse(OUTSIDE_DAY);
  if (s.vertical === 'stories' && !s.series) return refuse(NEEDS_SERIES);
  if (s.vertical !== 'stories' && s.series) return refuse(NO_SERIES);

  let minute = s.startMinute;
  if (ctx.nyDate !== null && ctx.nyDate === ctx.today && minute <= ctx.nowMinute) {
    minute = nextOpenMinute(ctx.nowMinute);
    if (minute > LAST_START || minute >= DAY_END) return refuse(NO_TIME_LEFT);
  }

  const others = s.ignore ? ctx.slots.filter((o) => !sameSlotKey(o, s.ignore!)) : ctx.slots;
  const has = (v: Vertical) => others.some((o) => o.vertical === v);
  if (s.vertical === 'carousels' && has('last_few_days')) return refuse(LFD_CAROUSEL_CONFLICT);
  if (s.vertical === 'last_few_days' && has('last_few_days')) return refuse(LFD_ONCE);
  if (s.vertical === 'ai_events' && others.filter((o) => o.vertical === 'ai_events').length >= AI_EVENTS_PER_DAY) return refuse(AI_EVENTS_ONCE);
  if (s.vertical === 'last_few_days' && has('carousels')) return refuse(LFD_CAROUSEL_CONFLICT, 'remove-carousels');
  if (others.some((o) => sameSlotKey(o, { vertical: s.vertical, startMinute: minute, series: s.series }))) {
    return refuse(`${nameOf(s).one} already has a slot at ${clockLabel(minute)}.`);
  }
  return { ok: true, minute };
}

/** The day without its Carousels, for Last Few Days after the person said yes. */
function withoutCarousels(ctx: DayCtx): { ctx: DayCtx; removed: ResolvedSlot[] } | Refusal {
  const removed = ctx.slots.filter((s) => s.vertical === 'carousels');
  if (removed.some((s) => isLocked(ctx, s))) return refuse(CAROUSEL_STARTED);
  return { ctx: { ...ctx, slots: ctx.slots.filter((s) => s.vertical !== 'carousels') }, removed };
}

const originFor = (ctx: DayCtx): ResolvedSlot['origin'] => (ctx.nyDate === null ? 'template' : 'override');

const feedModeFor = (vertical: Vertical, asked: FeedMode | null | undefined): FeedMode | null =>
  isReelType(vertical) ? (asked ?? DEFAULT_FEED_MODE[vertical]) : null;

/**
 * Add a slot. `clearCarousels` is the "yes" to Last Few Days on a Carousel
 * day: that day's Carousels go (listed in `removed`) and LFD goes in.
 */
export function applyPlace(
  ctx: DayCtx,
  s: SlotKey & { feedMode?: FeedMode | null },
  opts: { clearCarousels?: boolean } = {},
): { ok: true; slots: ResolvedSlot[]; minute: number; removed: ResolvedSlot[] } | Refusal {
  let day = ctx;
  let removed: ResolvedSlot[] = [];
  if (opts.clearCarousels && s.vertical === 'last_few_days' && !isPastDay(ctx)) {
    const cleared = withoutCarousels(ctx);
    if ('ok' in cleared) return cleared;
    day = cleared.ctx;
    removed = cleared.removed;
  }
  const r = canPlace(day, s);
  if (!r.ok) return r;
  const slot: ResolvedSlot = { vertical: s.vertical, startMinute: r.minute, series: s.series, feedMode: feedModeFor(s.vertical, s.feedMode), origin: originFor(ctx) };
  return { ok: true, slots: sortSlots([...day.slots, slot]), minute: r.minute, removed };
}

const sameDay = (a: DayCtx, b: DayCtx) => a.nyDate === b.nyDate && a.weekday === b.weekday;

/**
 * Move a slot to another minute, on its own day or another (`from` and `to`
 * are the same day for a move within it). Returns both days' slots; a move
 * onto its own key is a no-op.
 */
export function applyMove(
  from: DayCtx,
  to: DayCtx,
  key: SlotKey,
  toMinute: number,
  opts: { clearCarousels?: boolean } = {},
): { ok: true; from: ResolvedSlot[]; to: ResolvedSlot[]; minute: number; noop: boolean; removed: ResolvedSlot[] } | Refusal {
  const slot = from.slots.find((s) => sameSlotKey(s, key));
  if (!slot) return refuse(NOT_ON_DAY);
  if (isPastDay(from)) return refuse(PAST_DAY);
  if (isLocked(from, slot)) return refuse(ALREADY_STARTED);
  const within = sameDay(from, to);
  if (within && toMinute === key.startMinute) return { ok: true, from: from.slots, to: from.slots, minute: toMinute, noop: true, removed: [] };

  let target = within ? { ...from, slots: from.slots.filter((s) => !sameSlotKey(s, key)) } : to;
  let removed: ResolvedSlot[] = [];
  if (opts.clearCarousels && key.vertical === 'last_few_days' && !isPastDay(target)) {
    const cleared = withoutCarousels(target);
    if ('ok' in cleared) return cleared;
    target = cleared.ctx;
    removed = cleared.removed;
  }
  const r = canPlace(target, { vertical: key.vertical, startMinute: toMinute, series: key.series });
  if (!r.ok) return r;
  if (within && r.minute === key.startMinute) return { ok: true, from: from.slots, to: from.slots, minute: r.minute, noop: true, removed: [] };

  const moved: ResolvedSlot = { ...slot, startMinute: r.minute, origin: originFor(to) };
  const next = sortSlots([...target.slots, moved]);
  if (within) return { ok: true, from: next, to: next, minute: r.minute, noop: false, removed };
  return { ok: true, from: from.slots.filter((s) => !sameSlotKey(s, key)), to: next, minute: r.minute, noop: false, removed };
}

/** Remove a slot; started and past slots stay. */
export function applyRemove(ctx: DayCtx, key: SlotKey): { ok: true; slots: ResolvedSlot[]; removed: ResolvedSlot } | Refusal {
  const slot = ctx.slots.find((s) => sameSlotKey(s, key));
  if (!slot) return refuse(NOT_ON_DAY);
  if (isPastDay(ctx)) return refuse(PAST_DAY);
  if (isLocked(ctx, slot)) return refuse(ALREADY_STARTED);
  return { ok: true, slots: ctx.slots.filter((s) => !sameSlotKey(s, key)), removed: slot };
}

const keyOf = (s: ResolvedSlot): SlotKey => ({ vertical: s.vertical, startMinute: s.startMinute, series: s.series });

/** A place fix, only when the rules allow it, at the minute they allow. */
function placeFix(ctx: DayCtx, vertical: Vertical, startMinute: number, series: StorySeries | null): SlotChangeIntent | undefined {
  const r = canPlace(ctx, { vertical, startMinute, series });
  return r.ok ? { op: 'place', vertical, startMinute: r.minute, series, feedMode: DEFAULT_FEED_MODE[vertical] } : undefined;
}

/** A move fix, only when the rules allow it. */
function moveFix(ctx: DayCtx, s: ResolvedSlot, toMinute: number): SlotChangeIntent | undefined {
  const r = applyMove(ctx, ctx, keyOf(s), toMinute);
  return r.ok && !r.noop ? { op: 'move', key: keyOf(s), toMinute: r.minute } : undefined;
}

/**
 * Gaps and warnings for one day (decision 17, §Safety cap), each with a fix
 * where the rules allow one. `standard` is the Standard week's slots for this
 * weekday. A past day has none.
 */
export function gapsFor(ctx: DayCtx, standard: readonly ResolvedSlot[], caps: Record<Vertical, number>): Gap[] {
  if (isPastDay(ctx)) return [];
  const day = WEEKDAY_SHORT[ctx.weekday] ?? '';
  const slots = sortSlots([...ctx.slots]);
  const gaps: Gap[] = [];

  if (!slots.some((s) => s.vertical === 'explainers')) {
    gaps.push({ kind: 'no-explainer', text: `${day} has no Explainer.`, fix: placeFix(ctx, 'explainers', DEFAULT_TIMES.explainers[0]!, null) });
  }
  if (!slots.some((s) => s.vertical === 'stories')) {
    gaps.push({ kind: 'no-stories', text: `${day} has no Stories.`, fix: placeFix(ctx, 'stories', DEFAULT_TIMES.stories[0]!, 'morning_download') });
  }
  if (slots.length < standard.length) {
    gaps.push({ kind: 'fewer-than-standard', text: `${day} has ${slots.length} slots; the standard ${day} has ${standard.length}.` });
  }

  const counts = new Map<string, { name: { one: string; many: string }; n: number; cap: number }>();
  for (const s of slots) {
    const k = s.vertical === 'stories' ? `stories|${s.series}` : s.vertical;
    const c = counts.get(k) ?? { name: nameOf(s), n: 0, cap: caps[s.vertical] };
    c.n += 1;
    counts.set(k, c);
  }
  for (const c of counts.values()) {
    if (c.n > c.cap) gaps.push({ kind: 'over-cap', text: `${day} has ${c.n} ${c.name.many}; only ${c.cap} will be made.` });
  }

  for (const s of slots) {
    if (isUsual(s.vertical, s.startMinute)) continue;
    gaps.push({
      kind: 'outside-usual',
      text: `${nameOf(s).one} at ${clockLabel(s.startMinute)} is outside its usual window.`,
      fix: moveFix(ctx, s, nearestUsualStart(s.vertical, s.startMinute)),
    });
  }

  const feed = slots.filter(isFeedSlot);
  for (let i = 1; i < feed.length; i += 1) {
    const a = feed[i - 1]!;
    const b = feed[i]!;
    if (b.startMinute - a.startMinute >= FEED_GAP) continue;
    gaps.push({
      kind: 'feed-gap',
      text: `${nameOf(a).one} at ${clockLabel(a.startMinute)} and ${nameOf(b).one} at ${clockLabel(b.startMinute)} are less than ${FEED_GAP} minutes apart.`,
      fix: moveFix(ctx, b, a.startMinute + FEED_GAP),
    });
  }
  return gaps;
}
