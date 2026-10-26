// lib/social-hub/slots/schedule-write.ts
import { busyFeedTimes } from '@/lib/instagram/feed-spacing';
import { calendarDateKey, SOCIAL_TIMEZONE } from '@/lib/instagram/clock';
import { uniformIndex } from '@/lib/instagram/window';
import { weekdayOf } from '@/lib/social-hub/time';
import { rebookSlot } from '@/lib/social-hub/placement';

import { driftMinute } from './book';
import { readCaps, readOverrides, readSlotSource, readTemplate } from './load';
import type { OverrideOp } from './override';
import { resolveDay, validateDay } from './resolve';
import { checkSchedule, confirmLines, pairTimes, SCHEDULE_ENTRIES, scheduleFromTemplate, templateRowsFor, type ScheduleConfirm, type ScheduleEntry, type TypeSchedule } from './schedule';
import { DEFAULT_FEED_MODE, FEED_GAP, isFeedSlot, nyMinuteOf } from './times';
import {
  isReelType, parseSlotId, sameSlotKey, slotId, slotKeyString,
  type FeedMode, type OverrideRow, type ResolvedSlot, type SetBy, type SlotKey, type SlotQuery, type TemplateRow,
} from './types';
import {
  bookedDates, bookedPost, bookingsOn, holdStartedToday, modeClash, TAKEN, writeDiff,
  type BookedPost, type Booking, type State,
} from './write';

/**
 * Saving one type's standing schedule (calendar type schedules spec §1, "What
 * changes on save"). The type's template rows are replaced for every weekday,
 * and only the system's own bookings move:
 *  - Old and new times pair up (schedule.ts pairTimes). A system booking on a
 *    day ahead (or today, before its slot starts) follows its time's pair to
 *    the new minute, through placement.rebookSlot (Stories: the Stories repo's
 *    rescheduleSet, since a set's minute lives in stories.sets). A Trial /
 *    Main change reaches the system's bookings at that time.
 *  - A system booking whose time or day goes away, or whose new minute holds a
 *    hand-set slot that date, goes back to Ready to place (`toReady`). The
 *    route sends those back first (ruling P1), then applies the save in one
 *    transaction, which re-plans and verifies.
 *  - Nothing a person set moves (the spec's anti-goal). A person's slot or
 *    post keeps its time and Trial / Main (an 'add' pin, 'person', where the
 *    new template would drop it), and is tied to the routine slot it
 *    replaced: that slot doesn't come back at its new time on that date (a
 *    'person' 'remove' at the new minute). A person's 'remove' moves with its
 *    time's pair. A person's other 'add's stay as they are.
 *  - The system's own date pins for this type on days ahead are dropped; a
 *    started slot today keeps today's state (write.ts holdStartedToday).
 *  - Last Few Days and Carousels share no day. A day one gains comes off the
 *    other after a confirm; on a date where the other type is hand-set, the
 *    saved type skips that date (a 'system' 'remove'; `lfdSkips`).
 * Every date with an override or a booking is re-validated (validateDay).
 * Writes: social_hub.slot_template, slot_override, schedule (stories.sets
 * only through the injected Stories repo function).
 */

export type SaveConfirm = ScheduleConfirm | { kind: 'empty'; days: [] };

export type SaveMove = { booking: Booking; to: { nyDate: string; startMinute: number; feedMode: FeedMode | null } };

export type SavePlan =
  | {
      ok: true;
      /** What was planned, so the transaction can plan it again. */
      schedule: TypeSchedule;
      confirmed: boolean;
      /** The new template rows of every entry this save changes (this one, and the other of LFD / Carousels after a confirm). */
      templateRows: TemplateRow[];
      overrideOps: OverrideOp[];
      moves: SaveMove[];
      toReady: BookedPost[];
      /** "Wed Oct 28": dates the saved type skips because the other of LFD / Carousels is hand-set there. */
      lfdSkips: string[];
      /** The schedule as it was: Undo is a save of it. */
      inverse: TypeSchedule;
      /** The other entry's schedule as it was, when this save took days from it (LFD / Carousels); else null. */
      inverseOther: TypeSchedule | null;
      before: State;
      after: State;
    }
  | { ok: false; status: 400 | 422; errors: string[]; confirm?: SaveConfirm };

/** The Stories repo's rescheduleSet, run on the save's transaction (injected: hub code doesn't write stories.sets itself). */
export type StoriesReschedule = (tx: SlotQuery, setId: string, nyDate: string, publishAt: Date, slotMinute: number, slotBy: SetBy) => Promise<unknown>;

export type ApplySaveOpts = { by: string; now: Date; rng?: (count: number) => number; rescheduleSet: StoriesReschedule };

export type ApplySaveResult =
  | { ok: true; moved: number; toReady: number; inverse: TypeSchedule; inverseOther: TypeSchedule | null; lfdSkips: string[] }
  | { ok: false; status: 409; error: string };

/** Thrown once writes have started, so the transaction rolls back; saveSchedule answers 409 with its message. */
export class ScheduleConflict extends Error {
  readonly name = 'ScheduleConflict';
}

export const LEGACY_REFUSAL = 'Turn on the calendar first.';
const CHANGED = 'Posts on this schedule changed while saving. Refresh and try again.';

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Wed Oct 28" for a New York date. */
export const dayLabel = (nyDate: string): string =>
  `${WEEKDAY[weekdayOf(nyDate)]!.slice(0, 3)} ${MONTH[Number(nyDate.slice(5, 7)) - 1]} ${Number(nyDate.slice(8, 10))}`;

type EntryKey = Pick<ScheduleEntry, 'vertical' | 'series'>;
const isEntry = (k: EntryKey, e: EntryKey) => k.vertical === e.vertical && k.series === e.series;
const entryOf = (k: EntryKey) => SCHEDULE_ENTRIES.find((e) => isEntry(e, k)) ?? null;
const LFD = entryOf({ vertical: 'last_few_days', series: null })!;
const CAROUSELS = entryOf({ vertical: 'carousels', series: null })!;

const rowKey = (head: string | number, k: SlotKey) => `${head}|${slotKeyString(k)}`;

/** Sorted, de-duplicated days; times sorted, with Trial / Main only on reel types (null there takes the type's default). */
function normalized(s: TypeSchedule, entry: ScheduleEntry): TypeSchedule {
  const reel = isReelType(entry.vertical);
  return {
    entry,
    times: [...s.times]
      .map((t) => ({ minute: t.minute, feedMode: reel ? (t.feedMode ?? DEFAULT_FEED_MODE[entry.vertical]) : null }))
      .sort((a, b) => a.minute - b.minute),
    days: [...new Set(s.days)].sort((a, b) => a - b),
  };
}

function diffOverrides(before: readonly OverrideRow[], after: readonly OverrideRow[]): OverrideOp[] {
  const oOld = new Map(before.map((r) => [rowKey(r.nyDate, r), r]));
  const oNew = new Map(after.map((r) => [rowKey(r.nyDate, r), r]));
  const ops: OverrideOp[] = [];
  for (const [k, r] of oOld) if (!oNew.has(k)) ops.push({ op: 'delete', nyDate: r.nyDate, vertical: r.vertical, startMinute: r.startMinute, series: r.series });
  for (const [k, r] of oNew) {
    const old = oOld.get(k);
    if (old && old.action === r.action && old.feedMode === r.feedMode && old.setBy === r.setBy) continue;
    ops.push({ op: 'upsert', ...r });
  }
  return ops;
}

export async function planScheduleSave(q: SlotQuery, input: TypeSchedule, opts: { now: Date; confirm?: boolean }): Promise<SavePlan> {
  const entry = entryOf(input.entry);
  if (!entry) return { ok: false, status: 400, errors: ['Pick a schedule.'] };
  const s = normalized(input, entry);
  const today = calendarDateKey(opts.now, SOCIAL_TIMEZONE);
  const nowMinute = nyMinuteOf(opts.now);
  // One after the other: a transaction's handle runs one statement at a time.
  const template = await readTemplate(q);
  const overrides = await readOverrides(q, today, '9999-12-31');
  const caps = await readCaps(q);

  const others = SCHEDULE_ENTRIES.filter((e) => !isEntry(e, entry)).map((e) => scheduleFromTemplate(template, e).schedule);
  const check = checkSchedule(s, { cap: caps[entry.vertical], others });
  if (check.errors.length) return { ok: false, status: 422, errors: check.errors };
  const confirm: SaveConfirm | null = check.empty ? { kind: 'empty', days: [] } : check.confirm;

  // ── The template: this entry's rows for every weekday; after an LFD / Carousels confirm, the other loses those days.
  const other = check.confirm ? (check.confirm.kind === 'lfd-carousels' ? CAROUSELS : LFD) : null;
  const clearDays = new Set(check.confirm?.days ?? []);
  const newTemplate: TemplateRow[] = [
    ...template.filter((r) => !isEntry(r, entry) && !(other && isEntry(r, other) && clearDays.has(r.weekday))),
    ...templateRowsFor(s),
  ];
  const before: State = { template, overrides };
  const after: State = { template: newTemplate, overrides: [...overrides] };

  const oldMinutes = [...new Set(template.filter((r) => isEntry(r, entry)).map((r) => r.startMinute))];
  const pair = pairTimes(oldMinutes, s.times.map((t) => t.minute));
  const affected = (k: EntryKey) => isEntry(k, entry) || (other !== null && isEntry(k, other));
  const started = (nyDate: string, minute: number) => nyDate === today && minute <= nowMinute;

  const dates = bookedDates(today, overrides.map((o) => o.nyDate));
  const bookings = (await bookingsOn(q, dates)).filter((b) => affected(b.key));

  const personBooking = (nyDate: string, k: SlotKey) => bookings.some((b) => b.slotBy === 'person' && b.nyDate === nyDate && sameSlotKey(b.key, k));
  const rowAt = (nyDate: string, k: SlotKey) => after.overrides.find((o) => o.nyDate === nyDate && sameSlotKey(o, k));
  const personHeld = (nyDate: string, k: SlotKey) => rowAt(nyDate, k)?.setBy === 'person' || personBooking(nyDate, k);
  const put = (r: OverrideRow) => { after.overrides = [...after.overrides.filter((o) => !(o.nyDate === r.nyDate && sameSlotKey(o, r))), r]; };
  const drop = (nyDate: string, k: SlotKey) => { after.overrides = after.overrides.filter((o) => !(o.nyDate === nyDate && sameSlotKey(o, k))); };

  // ── The system's own date pins for this entry go, except: today's started ones, today's ties (a 'remove'
  // a started slot put on the time it moved to; it moves on below with its time's pair), and a pin that holds a
  // person's post (a Standard-week move whose target day had passed keeps the booking where it is).
  after.overrides = after.overrides.filter((o) => {
    if (!isEntry(o, entry) || o.setBy !== 'system') return true;
    if (started(o.nyDate, o.startMinute) || (o.nyDate === today && o.action === 'remove')) return true;
    return o.action === 'add' && personBooking(o.nyDate, o);
  });

  // ── Hand-set slots keep their time, tied to the routine slot they replaced.
  for (const nyDate of dates) {
    const weekday = weekdayOf(nyDate);
    const was = resolveDay(template, overrides, nyDate);
    for (const e of other ? [entry, other] : [entry]) {
      const routine = template.filter((r) => r.weekday === weekday && isEntry(r, e)).map((r) => r.startMinute);
      for (const m of routine) {
        const key: SlotKey = { vertical: e.vertical, startMinute: m, series: e.series };
        const to = e === entry ? (pair.get(m) ?? null) : m;
        const tied: SlotKey | null = to !== null && to !== m && s.days.includes(weekday) ? { ...key, startMinute: to } : null;
        const own = rowAt(nyDate, key);
        if (own?.setBy === 'person' && own.action === 'remove') {
          // A person's removal moves with its time; a hand-set slot already at the new minute wins.
          if (tied && !personHeld(nyDate, tied)) {
            drop(nyDate, key);
            put({ nyDate, ...tied, action: 'remove', feedMode: null, setBy: 'person' });
          }
          continue;
        }
        if (own?.setBy === 'system' && own.action === 'remove' && nyDate === today) {
          // Today's tie moves with its time, as a person's removal does.
          if (tied && tied.startMinute > nowMinute && !personHeld(nyDate, tied)) {
            drop(nyDate, key);
            put({ nyDate, ...tied, action: 'remove', feedMode: null, setBy: 'system' });
          }
          continue;
        }
        const held = (own?.setBy === 'person' && own.action === 'add') || personBooking(nyDate, key);
        const slot = was.find((x) => sameSlotKey(x, key));
        if (!held || !slot || started(nyDate, m)) continue;
        const base = newTemplate.find((r) => r.weekday === weekday && sameSlotKey(r, key));
        if (own?.setBy !== 'person' && (!base || base.feedMode !== slot.feedMode)) {
          put({ nyDate, ...key, action: 'add', feedMode: slot.feedMode, setBy: 'person' });
        }
        if (tied && !personHeld(nyDate, tied)) put({ nyDate, ...tied, action: 'remove', feedMode: null, setBy: 'person' });
      }
    }
  }

  holdStartedToday(before, after, today, nowMinute);

  // ── A slot that started today already went (or is going) out: its time's new minute doesn't also run today.
  const todayWeekday = weekdayOf(today);
  if (s.days.includes(todayWeekday)) {
    const wasToday = resolveDay(template, overrides, today);
    for (const r of template) {
      if (r.weekday !== todayWeekday || !isEntry(r, entry) || r.startMinute > nowMinute) continue;
      const to = pair.get(r.startMinute) ?? null;
      if (to === null || to === r.startMinute || to <= nowMinute || !wasToday.some((x) => sameSlotKey(x, r))) continue;
      const tied: SlotKey = { vertical: r.vertical, startMinute: to, series: r.series };
      if (rowAt(today, tied) || personHeld(today, tied)) continue;
      put({ nyDate: today, ...tied, action: 'remove', feedMode: null, setBy: 'system' });
    }
  }

  // ── Last Few Days and Carousels: the saved type skips a date where the other is hand-set.
  const lfdSkips: string[] = [];
  if (entry === LFD || entry === CAROUSELS) {
    const rival = entry === LFD ? CAROUSELS : LFD;
    for (const nyDate of dates) {
      const day = resolveDay(after.template, after.overrides, nyDate);
      const mine = day.filter((x) => isEntry(x, entry));
      if (!mine.length || !day.some((x) => isEntry(x, rival) && personHeld(nyDate, x))) continue;
      const base = resolveDay(after.template, [], nyDate);
      let created = false; // Only skips this save makes are listed; one already in place isn't news.
      for (const x of mine) {
        if (personHeld(nyDate, x) || started(nyDate, x.startMinute)) continue;
        const was = overrides.find((o) => o.nyDate === nyDate && sameSlotKey(o, x));
        if (base.some((b) => sameSlotKey(b, x))) {
          put({ nyDate, ...x, action: 'remove', feedMode: null, setBy: 'system' });
          if (!(was?.action === 'remove' && was.setBy === 'system')) created = true;
        } else {
          drop(nyDate, x);
          created = true;
        }
      }
      if (created) lfdSkips.push(dayLabel(nyDate));
    }
  }

  // ── Every date with an override or a booking still stands.
  const errors = new Set<string>();
  const check2 = new Set([...after.overrides.map((o) => o.nyDate), ...bookings.map((b) => b.nyDate)].filter((d) => d >= today));
  for (const d of [...check2].sort()) for (const e of validateDay(resolveDay(after.template, after.overrides, d))) errors.add(`${d}: ${e}`);
  if (errors.size) return { ok: false, status: 422, errors: [...errors] };

  // ── Bookings: the system's follow; a person's never move.
  const moves: SaveMove[] = [];
  const toReady: BookedPost[] = [];
  for (const b of bookings) {
    if (started(b.nyDate, b.key.startMinute) || b.publishAt.getTime() <= opts.now.getTime()) continue;
    const was = resolveDay(template, overrides, b.nyDate).find((x) => sameSlotKey(x, b.key));
    if (!was || modeClash(b, was)) continue; // Already out of step before this save: not its doing.
    const is = resolveDay(after.template, after.overrides, b.nyDate).find((x) => sameSlotKey(x, b.key));
    if (b.slotBy === 'person') {
      if (!is || modeClash(b, is)) throw new Error(`A schedule save would move ${b.vertical} booking ${b.id}, which a person set.`);
      continue;
    }
    if (is) {
      if (modeClash(b, is)) moves.push({ booking: b, to: { nyDate: b.nyDate, startMinute: b.key.startMinute, feedMode: is.feedMode } });
      continue;
    }
    const to = isEntry(b.key, entry) ? (pair.get(b.key.startMinute) ?? null) : null;
    if (to !== null && (b.nyDate > today || to > nowMinute)) {
      const k2: SlotKey = { ...b.key, startMinute: to };
      const slot = resolveDay(after.template, after.overrides, b.nyDate).find((x) => sameSlotKey(x, k2));
      const taken = bookings.some((o) => o !== b && o.nyDate === b.nyDate && sameSlotKey(o.key, k2));
      if (slot && !personHeld(b.nyDate, k2) && !taken) {
        moves.push({ booking: b, to: { nyDate: b.nyDate, startMinute: to, feedMode: slot.feedMode } });
        continue;
      }
    }
    toReady.push(bookedPost(b, 'removed'));
  }

  if (confirm && !opts.confirm) {
    const skips = lfdSkips.map((d) => (entry === LFD ? `Last Few Days skips ${d}: you set a Carousel there.` : `Carousels skip ${d}: you set Last Few Days there.`));
    return { ok: false, status: 422, errors: [...confirmLines(confirm, entry.label), ...skips], confirm };
  }

  return {
    ok: true,
    schedule: s,
    confirmed: opts.confirm === true,
    templateRows: newTemplate.filter((r) => affected(r)),
    overrideOps: diffOverrides(overrides, after.overrides),
    moves,
    toReady,
    lfdSkips,
    inverse: scheduleFromTemplate(template, entry).schedule,
    inverseOther: other ? scheduleFromTemplate(template, other).schedule : null,
    before,
    after,
  };
}

/**
 * Apply a planned save inside one transaction. It plans again on the
 * transaction's handle (the bookings are locked there) and refuses when that
 * plan still sends posts back to Ready (the route sent the first plan's
 * back already) or no longer holds. Every minute is drawn and every target
 * checked before anything is written; a failure after that throws
 * ScheduleConflict so the transaction rolls back.
 */
export async function applyScheduleSave(q: SlotQuery, plan: Extract<SavePlan, { ok: true }>, opts: ApplySaveOpts): Promise<ApplySaveResult> {
  if ((await readSlotSource(q)) !== 'template') return { ok: false, status: 409, error: LEGACY_REFUSAL };
  const p = await planScheduleSave(q, plan.schedule, { now: opts.now, confirm: plan.confirmed });
  if (!p.ok) return { ok: false, status: 409, error: p.errors.join(' ') };
  if (p.toReady.length) return { ok: false, status: 409, error: CHANGED };

  const slotOf = (m: SaveMove): ResolvedSlot => ({ vertical: m.booking.vertical, startMinute: m.to.startMinute, series: m.booking.key.series, feedMode: m.to.feedMode, origin: 'template' });
  const sameSlot = (m: SaveMove) => m.to.nyDate === m.booking.nyDate && m.to.startMinute === m.booking.key.startMinute;

  // Moved posts: drift minutes spaced from every other feed post (not their own old times). A Trial / Main
  // change alone keeps its minute.
  let busy: Date[] = [];
  if (p.moves.some((m) => !sameSlot(m) && isFeedSlot(slotOf(m)))) {
    busy = await busyFeedTimes(q as never, opts.now);
    for (const m of p.moves) {
      if (sameSlot(m)) continue;
      const own = busy.findIndex((t) => t.getTime() === m.booking.publishAt.getTime());
      if (own >= 0) busy.splice(own, 1);
    }
  }
  const times: Date[] = [];
  for (const m of p.moves) {
    if (sameSlot(m)) { times.push(m.booking.publishAt); continue; }
    const slot = slotOf(m);
    const at = driftMinute(m.to.nyDate, slot, opts.now, busy, opts.rng ?? uniformIndex);
    if (!at) return { ok: false, status: 409, error: `Every minute near ${m.to.nyDate} ${slotId(slot.startMinute, slot.series)} is within ${FEED_GAP} minutes of another feed post.` };
    if (isFeedSlot(slot)) busy.push(at);
    times.push(at);
  }
  const ids = p.moves.map((m) => m.booking.id);
  for (const m of p.moves) {
    if (sameSlot(m)) continue;
    const { rows } = await q(
      `SELECT 1 FROM social_hub.schedule WHERE vertical = $1 AND ny_date = $2::date AND slot = $3 AND status IN ('scheduled', 'publishing', 'published') AND id <> ALL($4::uuid[]) LIMIT 1`,
      [m.booking.vertical, m.to.nyDate, slotId(m.to.startMinute, m.booking.key.series), ids],
    );
    if (rows[0]) return { ok: false, status: 409, error: TAKEN };
  }

  for (const [i, m] of p.moves.entries()) {
    const at = times[i]!;
    const b = m.booking;
    if (b.vertical === 'stories') {
      const setId = b.refs.setId;
      if (!setId) throw new ScheduleConflict(`A Stories booking (${b.id}) has no set to move.`);
      try {
        await opts.rescheduleSet(q, setId, m.to.nyDate, at, m.to.startMinute, 'system');
      } catch (error) {
        const code = (error as { code?: string } | null)?.code;
        if (code === '23505') throw new ScheduleConflict(TAKEN);
        if ((error as { name?: string } | null)?.name === 'StaleStatusError') throw new ScheduleConflict(CHANGED);
        throw error;
      }
      continue;
    }
    // The one booking move; the mark stays the system's.
    const moved = await rebookSlot(q, { scheduleId: b.id, nyDate: m.to.nyDate, slot: slotId(m.to.startMinute, b.key.series), publishAt: at, feedMode: isReelType(b.vertical) ? m.to.feedMode : null });
    if (!moved.ok) throw new ScheduleConflict(moved.why === 'taken' ? TAKEN : CHANGED);
  }

  await writeDiff(q, p.before, p.after, opts.by);
  return { ok: true, moved: p.moves.length, toReady: plan.toReady.length, inverse: p.inverse, inverseOther: p.inverseOther, lfdSkips: p.lfdSkips };
}

// ── The route's work, with its live parts injected ──

const isWeekday = (d: unknown): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6;
const isMinute = (m: unknown): m is number => Number.isInteger(m);
const isMode = (m: unknown): m is FeedMode | null | undefined => m === undefined || m === null || m === 'trial' || m === 'main';

/** `{ schedule: { entry: { vertical, series }, times: [{ minute, feedMode }], days }, confirm? }`, or why not. */
export function parseScheduleBody(body: unknown): { schedule: TypeSchedule; confirm: boolean } | string {
  const b = body as { schedule?: unknown; confirm?: unknown } | null;
  const s = b?.schedule as { entry?: unknown; times?: unknown; days?: unknown } | undefined;
  if (!s || typeof s !== 'object') return 'Send a schedule.';
  const e = s.entry as { vertical?: unknown; series?: unknown } | undefined;
  const entry = e && typeof e === 'object' ? entryOf({ vertical: e.vertical as never, series: (e.series ?? null) as never }) : null;
  if (!entry) return 'Pick a schedule.';
  if (!Array.isArray(s.times) || s.times.length > 20) return 'Send up to 20 times.';
  const times = [];
  for (const t of s.times as unknown[]) {
    const x = t as { minute?: unknown; feedMode?: unknown } | null;
    if (!x || typeof x !== 'object' || !isMinute(x.minute) || !isMode(x.feedMode)) return 'Each time needs a minute (and Trial or Main for reels).';
    times.push({ minute: x.minute, feedMode: x.feedMode ?? null });
  }
  if (!Array.isArray(s.days) || !(s.days as unknown[]).every(isWeekday)) return 'Pick days as 0 (Sunday) to 6.';
  return { schedule: { entry, times, days: s.days as number[] }, confirm: b?.confirm === true };
}

export type SaveDeps = {
  /** Reads outside the transaction (the plan, the legacy check). */
  query: SlotQuery;
  transaction: <T>(fn: (tx: SlotQuery) => Promise<T>) => Promise<T>;
  /** Back to Ready to place, through the type's own unschedule (actions/unschedule's deps). */
  unschedule: (post: BookedPost) => Promise<{ ok: boolean; note: string }>;
  rescheduleSet: StoriesReschedule;
  by: string;
  now: Date;
  rng?: (count: number) => number;
};

export type SaveResponse = { status: number; body: Record<string, unknown> };

/**
 * POST /api/social-hub/slots/schedule's work: parse, refuse in legacy, plan;
 * send the plan's `toReady` posts back to Ready first (ruling P1: no
 * transaction spans the types' own unschedule), then apply in one
 * transaction. If anything fails after posts went back, the error says so.
 */
export async function saveSchedule(body: unknown, deps: SaveDeps): Promise<SaveResponse> {
  const parsed = parseScheduleBody(body);
  if (typeof parsed === 'string') return { status: 400, body: { error: parsed } };
  if ((await readSlotSource(deps.query)) !== 'template') return { status: 409, body: { error: LEGACY_REFUSAL } };
  const plan = await planScheduleSave(deps.query, parsed.schedule, { now: deps.now, confirm: parsed.confirm });
  if (!plan.ok) return { status: plan.status, body: plan.confirm ? { errors: plan.errors, confirm: plan.confirm } : { errors: plan.errors } };

  let sent = 0;
  const notSaved = (error: string) => ({
    status: 409,
    body: { error: sent ? `${sent} ${sent === 1 ? 'post is' : 'posts are'} already in Ready to place. The schedule wasn't saved: ${error}` : error, toReady: sent },
  });
  for (const post of plan.toReady) {
    const out = await deps.unschedule(post).catch((error: unknown) => ({ ok: false, note: error instanceof Error ? error.message : String(error) }));
    if (!out.ok) return notSaved(out.note || 'A post could not go back to Ready to place.');
    sent += 1;
  }
  try {
    const out = await deps.transaction((tx) => applyScheduleSave(tx, plan, { by: deps.by, now: deps.now, rng: deps.rng, rescheduleSet: deps.rescheduleSet }));
    if (!out.ok) return notSaved(out.error);
    return { status: 200, body: { ok: true, moved: out.moved, toReady: out.toReady, toReadyByType: toReadyByType(plan.toReady, plan.schedule.entry), inverse: out.inverse, inverseOther: out.inverseOther, lfdSkips: out.lfdSkips } };
  } catch (error) {
    if (error instanceof ScheduleConflict) return notSaved(error.message);
    throw error;
  }
}

/**
 * The posts a save sent back to Ready to place, counted per schedule entry
 * ("2 Carousels" after a Last Few Days confirm): the saved entry first, then
 * any other, in SCHEDULE_ENTRIES order. Entries with none are left out.
 */
export function toReadyByType(posts: readonly BookedPost[], saved: EntryKey): Array<{ label: string; count: number }> {
  const counts = new Map<ScheduleEntry, number>();
  for (const p of posts) {
    const e = entryOf({ vertical: p.vertical, series: parseSlotId(p.slot)?.series ?? null });
    if (e) counts.set(e, (counts.get(e) ?? 0) + 1);
  }
  const order = [...SCHEDULE_ENTRIES].sort((a, b) => Number(isEntry(b, saved)) - Number(isEntry(a, saved)));
  return order.filter((e) => counts.has(e)).map((e) => ({ label: e.label, count: counts.get(e)! }));
}

/** GET's body: every entry's schedule as the template holds it (merged when its days differ), the caps, and which source is live. */
export async function readSchedules(q: SlotQuery) {
  const template = await readTemplate(q);
  const caps = await readCaps(q);
  const source = await readSlotSource(q);
  return { schedules: SCHEDULE_ENTRIES.map((e) => scheduleFromTemplate(template, e)), caps, source };
}
