// lib/social-hub/slots/write.ts
import { busyFeedTimes } from '@/lib/instagram/feed-spacing';
import { calendarDateKey, SOCIAL_TIMEZONE, zoneOffsetMinutes } from '@/lib/instagram/clock';
import { addCalendarDays, uniformIndex } from '@/lib/instagram/window';
import { isDayKey, weekdayOf } from '@/lib/social-hub/time';
import type { Vertical } from '@/lib/social-hub/types';
import { isVertical } from '@/lib/social-hub/verticals';

import { readCaps, readOverrides, readTemplate } from './load';
import { resolveDay, sortSlots, validateDay } from './resolve';
import { applyMove, applyPlace, applyRemove, canPlace, isLocked, ALREADY_STARTED, PAST_DAY, type DayCtx, type Refusal } from './rules';
import { readSeedInputs, seedTemplate, type SeedInputs } from './seed';
import { EXPLAINER_WINDOWS } from '@/lib/explainers/publish/config';
import { LFD_WINDOW } from '@/lib/lfd/config';
import { POSTING_SLOTS } from '@/lib/reels/publish/slots';
import { CAROUSEL_SLOTS } from '@/lib/social/overnight/config';
import { rebookSlot } from '@/lib/social-hub/placement';

import { driftMinute } from './book';
import { DEFAULT_FEED_MODE, DEFAULT_TIMES, FEED_GAP, isFeedSlot } from './times';
import {
  isReelType, isSlotMinute, isStorySeries, parseSlotId, sameSlotKey, slotId, slotKeyString,
  type FeedMode, type OverrideRow, type ResolvedSlot, type SlotKey, type SlotQuery, type SlotSource, type StorySeries, type TemplateRow,
} from './types';

/**
 * The calendar's writes on free-time keys (week board spec; base spec §4).
 * Every change goes through rules.ts (canPlace / applyPlace / applyMove /
 * applyRemove): this file holds no placement invariant of its own. It works on
 * in-memory copies of the template and the overrides, so the result is checked
 * before anything is written, then writes the difference.
 *
 * Bookings (social_hub.schedule) follow their slot:
 *  - a move whose source holds a waiting post moves that post to the slot's new
 *    day and minute in the same transaction (spec §Calls I made): the one
 *    booking move, placement.rebookSlot (rescheduleItem's), at a minute in [slot, slot + DRIFT]
 *    after now, 30 minutes from other feed posts when it is one;
 *  - a change that removes a booked slot (or flips its Trial / Main) always
 *    returns 409 { booked } with each post's refs. This route never
 *    unschedules (ruling R7): for "Move it back to ready" the client calls
 *    /api/social-hub/actions/unschedule (it has the in-flight publish guard
 *    and each type's own steps), then sends the change again; "Keep it"
 *    sends nothing. Stories' minute lives in stories.sets, so a booked
 *    Stories slot's move is a 409 too (why 'cannot-move').
 *
 * Bookings made before the cutover carry a legacy window id ('afternoon',
 * 'morning_download'); they read as that window's start minute, so they are
 * in the way and move like any other, and a moved one gets slot = slotId(...).
 * Writes: social_hub.slot_template, slot_override, settings, schedule.
 */

type Key = { vertical: Vertical; startMinute: number; series: StorySeries | null };

export type SlotChange =
  | ({ scope: 'template'; op: 'put'; weekday: number; feedMode?: FeedMode | null; clearCarousels?: boolean } & Key)
  | ({ scope: 'template'; op: 'delete'; weekday: number } & Key)
  | { scope: 'template'; op: 'move'; from: { weekday: number } & Key; to: { weekday: number; startMinute: number }; clearCarousels?: boolean }
  | ({ scope: 'date'; op: 'put'; nyDate: string; action: 'add' | 'remove'; feedMode?: FeedMode | null; clearCarousels?: boolean } & Key)
  | ({ scope: 'date'; op: 'delete'; nyDate: string } & Key)
  | { scope: 'date'; op: 'move'; from: { nyDate: string } & Key; to: { nyDate: string; startMinute: number }; clearCarousels?: boolean };

/**
 * A waiting post a change would leave without its slot. `why`: its slot is
 * removed, its slot's Trial / Main changes, or its slot moves but the post
 * can't move from here (Stories).
 */
export type BookedPost = {
  scheduleId: string; vertical: Vertical; nyDate: string; slot: string; feedMode: FeedMode | null; publishAt: string;
  refs: Record<string, string>; why: 'removed' | 'feed-mode' | 'cannot-move';
};

export type Rescheduled = { scheduleId: string; nyDate: string; slot: string; publishAt: string };

export type ApplyResult =
  | { ok: true; minutes: Array<number | null>; rescheduled: Rescheduled[] }
  | { ok: false; status: 400 | 422; errors: string[]; confirm?: 'remove-carousels' }
  | { ok: false; status: 409; booked: BookedPost[] }
  | { ok: false; status: 409; error: string };

export type ApplyOpts = {
  by: string;
  now: Date;
  /** The drift draw over [slot, slot + 15], for tests; uniform by default. */
  rng?: (count: number) => number;
};

// ── Parsing ──

const MAX_CHANGES = 20;
const isMode = (m: unknown): m is FeedMode | null | undefined => m === undefined || m === null || m === 'trial' || m === 'main';
const isWeekday = (d: unknown): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6;

function parseKey(c: Record<string, unknown>): Key | string {
  if (!isVertical(c.vertical)) return 'Pick a content type.';
  if (!isSlotMinute(c.startMinute)) return 'Pick a start minute on the 15-minute grid.';
  const series = c.series ?? null;
  if (series !== null && !isStorySeries(series)) return 'Pick a Stories series.';
  return { vertical: c.vertical, startMinute: c.startMinute, series };
}

function parseOne(c: Record<string, unknown>): SlotChange | string {
  if (c.scope !== 'template' && c.scope !== 'date') return 'Each change is for the template or for a date.';
  const template = c.scope === 'template';
  const where = (x: Record<string, unknown>, fallback?: Record<string, unknown>) => {
    if (template) {
      const weekday = x.weekday ?? fallback?.weekday;
      return isWeekday(weekday) ? { weekday } : 'Pick a weekday.';
    }
    const nyDate = x.nyDate ?? fallback?.nyDate;
    return isDayKey(nyDate) ? { nyDate } : 'Pick a day as YYYY-MM-DD.';
  };
  const clear = c.clearCarousels === true ? { clearCarousels: true } : {};
  if (c.op === 'move') {
    const from = c.from as Record<string, unknown> | null;
    const to = c.to as Record<string, unknown> | null;
    if (typeof from !== 'object' || from === null || typeof to !== 'object' || to === null) return 'A move needs from and to.';
    const key = parseKey(from);
    if (typeof key === 'string') return key;
    const fromWhere = where(from);
    if (typeof fromWhere === 'string') return fromWhere;
    const toWhere = where(to, fromWhere);
    if (typeof toWhere === 'string') return toWhere;
    if (!isSlotMinute(to.startMinute)) return 'Pick a start minute on the 15-minute grid.';
    return { scope: c.scope, op: 'move', from: { ...fromWhere, ...key }, to: { ...toWhere, startMinute: to.startMinute }, ...clear } as SlotChange;
  }
  const key = parseKey(c);
  if (typeof key === 'string') return key;
  const at = where(c);
  if (typeof at === 'string') return at;
  if (c.op === 'delete') return { scope: c.scope, op: 'delete', ...at, ...key } as SlotChange;
  if (c.op !== 'put' || !isMode(c.feedMode)) return template ? 'Unknown template change.' : 'Unknown date change.';
  const mode = c.feedMode === undefined ? {} : { feedMode: c.feedMode };
  if (template) return { scope: 'template', op: 'put', ...at, ...key, ...mode, ...clear } as SlotChange;
  if (c.action !== 'add' && c.action !== 'remove') return 'Unknown date change.';
  return { scope: 'date', op: 'put', ...at, ...key, action: c.action, ...(c.action === 'add' ? mode : {}), ...(c.action === 'add' ? clear : {}) } as SlotChange;
}

export function parseChanges(body: unknown): SlotChange[] | string {
  const list = (body as { changes?: unknown } | null)?.changes;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_CHANGES) return `Send 1 to ${MAX_CHANGES} changes.`;
  const out: SlotChange[] = [];
  for (const c of list as unknown[]) {
    if (typeof c !== 'object' || c === null) return 'Each change must be an object.';
    const one = parseOne(c as Record<string, unknown>);
    if (typeof one === 'string') return one;
    out.push(one);
  }
  return out;
}

// ── The in-memory state ──

type State = { template: TemplateRow[]; overrides: OverrideRow[] };

const keyOf = (s: Key): SlotKey => ({ vertical: s.vertical, startMinute: s.startMinute, series: s.series });

/** Minute of the New York day of an instant. */
function nyMinuteOf(at: Date): number {
  const local = new Date(at.getTime() + zoneOffsetMinutes(at, SOCIAL_TIMEZONE) * 60_000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

/** The Standard week's slots for a weekday. */
function templateDay(t: readonly TemplateRow[], weekday: number): ResolvedSlot[] {
  return sortSlots(
    t.filter((r) => r.weekday === weekday).map((r) => ({ vertical: r.vertical, startMinute: r.startMinute, series: r.series, feedMode: r.feedMode, origin: 'template' as const })),
  );
}

function setTemplateDay(s: State, weekday: number, slots: readonly ResolvedSlot[]): void {
  s.template = [
    ...s.template.filter((r) => r.weekday !== weekday),
    ...slots.map((x) => ({ weekday, vertical: x.vertical, startMinute: x.startMinute, series: x.series, feedMode: x.feedMode })),
  ];
}

/** A date's overrides become exactly the difference between its slots and the Standard week's. */
function setDateDay(s: State, nyDate: string, slots: readonly ResolvedSlot[]): void {
  const base = resolveDay(s.template, [], nyDate);
  const rows: OverrideRow[] = [];
  for (const b of base) if (!slots.some((x) => sameSlotKey(x, b))) rows.push({ nyDate, ...keyOf(b), action: 'remove', feedMode: null });
  for (const x of slots) {
    const b = base.find((y) => sameSlotKey(x, y));
    if (!b || b.feedMode !== x.feedMode) rows.push({ nyDate, ...keyOf(x), action: 'add', feedMode: x.feedMode });
  }
  s.overrides = [...s.overrides.filter((o) => o.nyDate !== nyDate), ...rows];
}

type Follow = { from: { nyDate: string | null; weekday: number }; to: { nyDate: string | null; weekday: number }; key: SlotKey; minute: number };

type Applied = { ok: true; minute: number | null; follow?: Follow } | Refusal;

const ok = (minute: number | null, follow?: Follow): Applied => (follow ? { ok: true, minute, follow } : { ok: true, minute });

/** A put on a key the day already has: only its Trial / Main can change. */
function withMode(slots: readonly ResolvedSlot[], key: SlotKey, feedMode: FeedMode | null | undefined): ResolvedSlot[] {
  if (feedMode === undefined || !isReelType(key.vertical)) return [...slots];
  return slots.map((x) => (sameSlotKey(x, key) ? { ...x, feedMode: feedMode ?? DEFAULT_FEED_MODE[key.vertical] } : x));
}

/** One change on the in-memory state, through the rules. */
function applyOne(s: State, c: SlotChange, today: string, nowMinute: number): Applied {
  const dayCtx = (nyDate: string): DayCtx => ({ nyDate, weekday: weekdayOf(nyDate), slots: resolveDay(s.template, s.overrides, nyDate), today, nowMinute });
  const weekCtx = (weekday: number): DayCtx => ({ nyDate: null, weekday, slots: templateDay(s.template, weekday), today, nowMinute });
  const write = (ctx: DayCtx, slots: readonly ResolvedSlot[]) => (ctx.nyDate === null ? setTemplateDay(s, ctx.weekday, slots) : setDateDay(s, ctx.nyDate, slots));
  const clear = { clearCarousels: 'clearCarousels' in c && c.clearCarousels === true };

  if (c.op === 'move') {
    const from = c.scope === 'template' ? weekCtx(c.from.weekday) : dayCtx(c.from.nyDate);
    const sameDay = c.scope === 'template' ? c.to.weekday === c.from.weekday : c.to.nyDate === c.from.nyDate;
    const to = sameDay ? from : c.scope === 'template' ? weekCtx(c.to.weekday) : dayCtx(c.to.nyDate);
    const key = keyOf(c.from);
    const r = applyMove(from, to, key, c.to.startMinute, clear);
    if (!r.ok) return r;
    if (r.noop) return ok(r.minute);
    write(from, r.from);
    if (!sameDay) write(to, r.to);
    return ok(r.minute, { from: { nyDate: from.nyDate, weekday: from.weekday }, to: { nyDate: to.nyDate, weekday: to.weekday }, key, minute: r.minute });
  }

  const key = keyOf(c);
  const ctx = c.scope === 'template' ? weekCtx(c.weekday) : dayCtx(c.nyDate);
  const has = ctx.slots.find((x) => sameSlotKey(x, key));

  if (c.op === 'put' && (c.scope === 'template' || c.action === 'add')) {
    if (has) {
      if (ctx.nyDate !== null && (ctx.nyDate < today || isLocked(ctx, has))) return { ok: false, reason: ctx.nyDate < today ? PAST_DAY : ALREADY_STARTED };
      write(ctx, withMode(ctx.slots, key, c.feedMode));
      return ok(key.startMinute);
    }
    const r = applyPlace(ctx, { ...key, feedMode: c.feedMode ?? null }, clear);
    if (!r.ok) return r;
    write(ctx, r.slots);
    return ok(r.minute);
  }

  if (c.op === 'put' || (c.op === 'delete' && c.scope === 'template')) {
    // Removing: a slot the day doesn't have is already gone (past days still refuse).
    if (ctx.nyDate !== null && ctx.nyDate < today) return { ok: false, reason: PAST_DAY };
    if (!has) return ok(null);
    const r = applyRemove(ctx, key);
    if (!r.ok) return r;
    write(ctx, r.slots);
    return ok(null);
  }

  // A date's op delete: that key goes back to the Standard week (Reset, one slot).
  const nyDate = (c as { nyDate: string }).nyDate;
  if (nyDate < today) return { ok: false, reason: PAST_DAY };
  const rest = s.overrides.filter((o) => !(o.nyDate === nyDate && sameSlotKey(o, key)));
  const after = resolveDay(s.template, rest, nyDate).find((x) => sameSlotKey(x, key));
  if (!has && !after) { s.overrides = rest; return ok(null); }
  if (has && after) {
    if (has.feedMode !== after.feedMode && isLocked(ctx, has)) return { ok: false, reason: ALREADY_STARTED };
    s.overrides = rest;
    return ok(key.startMinute);
  }
  if (has) {
    const r = applyRemove(ctx, key);
    if (!r.ok) return r;
  } else {
    // The Standard week's slot comes back: as a placement at exactly its own minute.
    const r = canPlace(ctx, key);
    if (!r.ok) return r;
    if (r.minute !== key.startMinute) return { ok: false, reason: ALREADY_STARTED };
  }
  s.overrides = rest;
  return ok(after ? key.startMinute : null);
}

/**
 * An "every <weekday>" edit made on that weekday changes the template, but a
 * slot that has already started today keeps today's state: one override per
 * such key pins what today resolved to before (add with its feed mode, or
 * remove). A key with an override today is already pinned.
 */
function holdStartedToday(before: State, s: State, today: string, nowMinute: number): void {
  const was = resolveDay(before.template, before.overrides, today);
  const now = resolveDay(s.template, s.overrides, today);
  const keys = new Map<string, SlotKey>();
  for (const x of [...was, ...now]) keys.set(slotKeyString(x), keyOf(x));
  for (const key of keys.values()) {
    if (key.startMinute > nowMinute) continue;
    if (s.overrides.some((o) => o.nyDate === today && sameSlotKey(o, key))) continue;
    const a = was.find((x) => sameSlotKey(x, key));
    const b = now.find((x) => sameSlotKey(x, key));
    if ((!a && !b) || (a && b && a.feedMode === b.feedMode)) continue;
    s.overrides.push(a ? { nyDate: today, ...key, action: 'add', feedMode: a.feedMode } : { nyDate: today, ...key, action: 'remove', feedMode: null });
  }
}

// ── Bookings ──

const REF_KEY: Record<Vertical, string> = { carousels: 'postId', explainers: 'jobId', last_few_days: 'lfdPostId', stories: 'setId', reels: 'postIdeaId' };

/** Types whose booking is the social_hub.schedule row (placement.rescheduleItem); Stories' minute lives in stories.sets. */
const MOVE_HERE: ReadonlySet<Vertical> = new Set(['carousels', 'last_few_days', 'reels', 'explainers']);

type Booking = { id: string; vertical: Vertical; nyDate: string; slot: string; key: SlotKey; feedMode: FeedMode | null; publishAt: Date; refs: Record<string, string> };

/**
 * A pre-cutover booking's window id as its free-time key: the window's start
 * minute from each type's window constants, Stories' series at the Stories
 * default time. Null for anything else.
 */
const LEGACY_START: Record<Exclude<Vertical, 'stories'>, ReadonlyArray<{ id: string; startMinute: number }>> = {
  reels: POSTING_SLOTS,
  explainers: EXPLAINER_WINDOWS,
  carousels: CAROUSEL_SLOTS,
  last_few_days: [LFD_WINDOW],
};

export function legacyKey(vertical: Vertical, slot: string): { startMinute: number; series: StorySeries | null } | null {
  if (vertical === 'stories') return isStorySeries(slot) ? { startMinute: DEFAULT_TIMES.stories[0]!, series: slot } : null;
  const w = LEGACY_START[vertical]?.find((x) => x.id === slot);
  return w ? { startMinute: w.startMinute, series: null } : null;
}

/** Waiting posts on these dates (free-time or legacy window slot ids), locked for this transaction. */
async function bookingsOn(q: SlotQuery, dates: readonly string[]): Promise<Booking[]> {
  if (!dates.length) return [];
  const { rows } = await q(
    `SELECT s.id::text AS id, s.vertical, s.ny_date::text AS ny_date, s.slot, s.feed_mode, s.publish_at, s.idea_ref, ci.native_ref
       FROM social_hub.schedule s LEFT JOIN social_hub.content_items ci ON ci.id = s.content_item_id
      WHERE s.status = 'scheduled' AND s.ny_date = ANY($1::date[])
      ORDER BY s.publish_at
      FOR UPDATE OF s`,
    [dates],
  );
  const out: Booking[] = [];
  for (const r of rows) {
    const v = r.vertical as Vertical;
    const parsed = parseSlotId(String(r.slot)) ?? legacyKey(v, String(r.slot));
    if (!parsed) continue;
    const ref = v === 'reels' ? r.idea_ref : r.native_ref;
    out.push({
      id: r.id, vertical: v, nyDate: String(r.ny_date).slice(0, 10), slot: String(r.slot), key: { vertical: v, ...parsed },
      feedMode: r.feed_mode ?? null, publishAt: new Date(r.publish_at), refs: ref ? { [REF_KEY[v]]: String(ref) } : {},
    });
  }
  return out;
}

/** A booking made before the cutover has no feed_mode: it posts as its type always did. */
const modeOf = (b: Booking): FeedMode | null => b.feedMode ?? DEFAULT_FEED_MODE[b.vertical];

const modeClash = (b: Booking, slot: ResolvedSlot) => {
  const mode = modeOf(b);
  return isReelType(b.vertical) && slot.feedMode != null && mode != null && slot.feedMode !== mode;
};

/** Where a booking on (nyDate, key) goes when its slot moved: the move's target on the matching date. */
function followTarget(follows: readonly Follow[], b: Booking): { nyDate: string; minute: number } | null {
  for (const f of follows) {
    if (!sameSlotKey(f.key, b.key)) continue;
    if (f.from.nyDate !== null) {
      if (f.from.nyDate === b.nyDate) return { nyDate: f.to.nyDate!, minute: f.minute };
    } else if (weekdayOf(b.nyDate) === f.from.weekday) {
      return { nyDate: addCalendarDays(b.nyDate, f.to.weekday - f.from.weekday), minute: f.minute };
    }
  }
  return null;
}

type Plan = { b: Booking; nyDate: string; slot: ResolvedSlot };

const TAKEN = 'That slot is taken.';

const bookedPost = (b: Booking, why: BookedPost['why']): BookedPost => ({
  scheduleId: b.id, vertical: b.vertical, nyDate: b.nyDate, slot: b.slot, feedMode: b.feedMode, publishAt: b.publishAt.toISOString(), refs: b.refs, why,
});

// ── Apply ──

/** Where bookings can sit: the next two weeks, plus every date a change touched. */
function bookedDates(today: string, extra: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const d of extra) if (d >= today) out.add(d);
  for (let i = 0; i < 14; i += 1) out.add(addCalendarDays(today, i));
  return [...out].sort();
}

const rowKey = (head: string | number, k: SlotKey) => `${head}|${slotKeyString(k)}`;

export async function applySlotChanges(q: SlotQuery, changes: readonly SlotChange[], opts: ApplyOpts): Promise<ApplyResult> {
  const today = calendarDateKey(opts.now, SOCIAL_TIMEZONE);
  const nowMinute = nyMinuteOf(opts.now);
  const [template, overrides] = await Promise.all([readTemplate(q), readOverrides(q, today, '9999-12-31')]);
  const before: State = { template, overrides };
  const s: State = { template: [...template], overrides: [...overrides] };

  const minutes: Array<number | null> = [];
  const follows: Follow[] = [];
  const touchedDates = new Set<string>();
  const touchedWeekdays = new Set<number>();
  for (const c of changes) {
    const r = applyOne(s, c, today, nowMinute);
    if (!r.ok) return r.confirm ? { ok: false, status: 422, errors: [r.reason], confirm: r.confirm } : { ok: false, status: 422, errors: [r.reason] };
    minutes.push(r.minute);
    if (r.follow) follows.push(r.follow);
    if (c.op === 'move') {
      if (c.scope === 'date') { touchedDates.add(c.from.nyDate); touchedDates.add(c.to.nyDate); } else { touchedWeekdays.add(c.from.weekday); touchedWeekdays.add(c.to.weekday); }
    } else if (c.scope === 'date') touchedDates.add(c.nyDate);
    else touchedWeekdays.add(c.weekday);
  }
  holdStartedToday(before, s, today, nowMinute);

  // A template change must not break a date that already has overrides (that date's own rules ran when it was edited).
  const errors = new Set<string>();
  if (touchedWeekdays.size) {
    const dates = new Set(s.overrides.filter((o) => o.nyDate >= today && touchedWeekdays.has(weekdayOf(o.nyDate))).map((o) => o.nyDate));
    for (const d of [...dates].sort()) for (const e of validateDay(resolveDay(s.template, s.overrides, d))) errors.add(`${d}: ${e}`);
  }
  if (errors.size) return { ok: false, status: 422, errors: [...errors] };

  // Bookings: those whose slot this change set moves, removes or flips.
  const booked: BookedPost[] = [];
  const plans: Plan[] = [];
  for (const b of await bookingsOn(q, bookedDates(today, touchedDates))) {
    const was = resolveDay(before.template, before.overrides, b.nyDate).find((x) => sameSlotKey(x, b.key));
    if (!was || modeClash(b, was)) continue; // Already out of step before this change: not this change's doing.
    const is = resolveDay(s.template, s.overrides, b.nyDate).find((x) => sameSlotKey(x, b.key));
    if (is) {
      if (modeClash(b, is)) booked.push(bookedPost(b, 'feed-mode'));
      continue;
    }
    // A target that is past or already started (a cross-weekday template move) can't take the post: it counts as removed.
    const found = followTarget(follows, b);
    const target = found && (found.nyDate > today || (found.nyDate === today && found.minute > nowMinute)) ? found : null;
    const slot = target && resolveDay(s.template, s.overrides, target.nyDate).find((x) => sameSlotKey(x, { ...b.key, startMinute: target.minute }));
    if (target && slot) {
      if (MOVE_HERE.has(b.vertical)) plans.push({ b, nyDate: target.nyDate, slot });
      else booked.push(bookedPost(b, 'cannot-move'));
      continue;
    }
    booked.push(bookedPost(b, 'removed'));
  }
  if (booked.length) return { ok: false, status: 409, booked };

  // Moved posts: drift minutes, spaced from every other feed post (not from their own old times).
  const rescheduled: Rescheduled[] = [];
  const moves = plans;
  let busy: Date[] = [];
  if (moves.some((p) => isFeedSlot(p.slot))) {
    busy = await busyFeedTimes(q as never, opts.now);
    for (const p of moves) {
      const own = busy.findIndex((t) => t.getTime() === p.b.publishAt.getTime());
      if (own >= 0) busy.splice(own, 1);
    }
  }
  // Every minute is drawn before anything is written, so a refusal leaves the database as it was.
  const times: Date[] = [];
  for (const p of moves) {
    const at = driftMinute(p.nyDate, p.slot, opts.now, busy, opts.rng ?? uniformIndex);
    if (!at) return { ok: false, status: 422, errors: [`Every minute near ${p.nyDate} ${slotId(p.slot.startMinute, p.slot.series)} is within ${FEED_GAP} minutes of another feed post.`] };
    if (isFeedSlot(p.slot)) busy.push(at);
    times.push(at);
  }
  // A target slot id another waiting or posted post already holds (or two moves onto one): refused before any write.
  const targets = moves.map((p) => `${p.b.vertical}|${p.nyDate}|${slotId(p.slot.startMinute, p.slot.series)}`);
  if (new Set(targets).size < targets.length) return { ok: false, status: 409, error: TAKEN };
  for (const p of moves) {
    const { rows } = await q(
      `SELECT 1 FROM social_hub.schedule WHERE vertical = $1 AND ny_date = $2::date AND slot = $3 AND status IN ('scheduled', 'publishing', 'published') AND id <> ALL($4::uuid[]) LIMIT 1`,
      [p.b.vertical, p.nyDate, slotId(p.slot.startMinute, p.slot.series), moves.map((m) => m.b.id)],
    );
    if (rows[0]) return { ok: false, status: 409, error: TAKEN };
  }
  for (const [i, p] of moves.entries()) {
    const at = times[i]!;
    const slot = slotId(p.slot.startMinute, p.slot.series);
    // The one booking move (placement.rebookSlot, as rescheduleItem): the row stays (source, approval); the slot's Trial / Main moves with it.
    const moved = await rebookSlot(q, { scheduleId: p.b.id, nyDate: p.nyDate, slot, publishAt: at, feedMode: isReelType(p.b.vertical) ? p.slot.feedMode : null });
    // A race past the check above; the route's transaction rolls back on this result's status.
    if (!moved.ok && moved.why === 'taken') return { ok: false, status: 409, error: TAKEN };
    if (!moved.ok) throw new Error(`Booking ${p.b.id} started posting before it could move.`);
    rescheduled.push({ scheduleId: p.b.id, nyDate: p.nyDate, slot, publishAt: at.toISOString() });
  }

  await writeDiff(q, before, s, opts.by);
  return { ok: true, minutes, rescheduled };
}

/** Write only what changed: deleted rows go, new or changed rows are upserted, untouched rows keep their updated_by. */
async function writeDiff(q: SlotQuery, before: State, s: State, by: string): Promise<void> {
  const tOld = new Map(before.template.map((r) => [rowKey(r.weekday, r), r]));
  const tNew = new Map(s.template.map((r) => [rowKey(r.weekday, r), r]));
  for (const [k, r] of tOld) {
    if (tNew.has(k)) continue;
    await q(`DELETE FROM social_hub.slot_template WHERE weekday = $1 AND vertical = $2 AND start_minute = $3 AND coalesce(series, '') = coalesce($4, '')`, [r.weekday, r.vertical, r.startMinute, r.series]);
  }
  for (const [k, r] of tNew) {
    const old = tOld.get(k);
    if (old && old.feedMode === r.feedMode) continue;
    await q(
      `INSERT INTO social_hub.slot_template (weekday, vertical, start_minute, series, feed_mode, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (weekday, vertical, start_minute, (coalesce(series, ''))) DO UPDATE SET feed_mode = EXCLUDED.feed_mode, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [r.weekday, r.vertical, r.startMinute, r.series, r.feedMode, by],
    );
  }
  const oOld = new Map(before.overrides.map((r) => [rowKey(r.nyDate, r), r]));
  const oNew = new Map(s.overrides.map((r) => [rowKey(r.nyDate, r), r]));
  for (const [k, r] of oOld) {
    if (oNew.has(k)) continue;
    await q(`DELETE FROM social_hub.slot_override WHERE ny_date = $1::date AND vertical = $2 AND start_minute = $3 AND coalesce(series, '') = coalesce($4, '')`, [r.nyDate, r.vertical, r.startMinute, r.series]);
  }
  for (const [k, r] of oNew) {
    const old = oOld.get(k);
    if (old && old.action === r.action && old.feedMode === r.feedMode) continue;
    await q(
      `INSERT INTO social_hub.slot_override (ny_date, vertical, start_minute, series, action, feed_mode, updated_by, updated_at) VALUES ($1::date, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (ny_date, vertical, start_minute, (coalesce(series, ''))) DO UPDATE SET action = EXCLUDED.action, feed_mode = EXCLUDED.feed_mode, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [r.nyDate, r.vertical, r.startMinute, r.series, r.action, r.feedMode, by],
    );
  }
}

// ── Caps ──

/**
 * Change daily caps (a person's decision, spec §Safety cap). Each value is an
 * integer 0–10; anything else throws before writing. Merged over the stored caps.
 */
export async function writeCaps(q: SlotQuery, patch: Partial<Record<Vertical, number>>): Promise<Record<Vertical, number>> {
  for (const [v, n] of Object.entries(patch)) {
    if (!isVertical(v)) throw new Error(`Unknown content type “${v}”.`);
    if (!Number.isInteger(n) || (n as number) < 0 || (n as number) > 10) throw new Error('A daily limit is a whole number from 0 to 10.');
  }
  const next = { ...(await readCaps(q)), ...patch };
  await q(
    `INSERT INTO social_hub.settings (key, value, updated_at) VALUES ('daily_caps', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(next)],
  );
  return next;
}

// ── The switch ──

/** Flip the switch. Inside a transaction pass `seed` read beforehand: readSeedInputs swallows query errors, which would abort it. The first flip to 'template' seeds the week at the default times (spec §Seeding). */
export async function setSlotSource(q: SlotQuery, source: SlotSource, by: string, seed?: SeedInputs): Promise<{ seeded: number }> {
  let seeded = 0;
  if (source === 'template') {
    const { rows } = await q(`SELECT count(*)::int AS n FROM social_hub.slot_template`);
    if (Number(rows[0]?.n ?? 0) === 0) {
      for (const r of seedTemplate(seed ?? (await readSeedInputs(q)))) {
        // Counts rows inserted: a row another flip already wrote is not seeded here.
        const { rows: inserted } = await q(
          `INSERT INTO social_hub.slot_template (weekday, vertical, start_minute, series, feed_mode, updated_by) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING RETURNING 1`,
          [r.weekday, r.vertical, r.startMinute, r.series, r.feedMode, by],
        );
        seeded += inserted.length;
      }
    }
  }
  await q(
    `INSERT INTO social_hub.settings (key, value, updated_at) VALUES ('slot_source', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(source)],
  );
  return { seeded };
}
