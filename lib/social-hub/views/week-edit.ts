import { sortSlots } from '@/lib/social-hub/slots/resolve';
import { ALREADY_STARTED, applyMove, applyPlace, applyRemove, canPlace, isLocked, PAST_DAY, type DayCtx, type Refusal } from '@/lib/social-hub/slots/rules';
import { clockLabel, DAY_START, DEFAULT_FEED_MODE, GRID, isUsual, LAST_START, nextOpenMinute, nyMinuteOf, SERIES_NAME, snapMinute, TYPE_NAME, USUAL } from '@/lib/social-hub/slots/times';
import { isReelType, MAX_CHANGES, parseSlotId, sameSlotKey, slotId, type FeedMode, type ResolvedSlot, type SlotKey, type StorySeries } from '@/lib/social-hub/slots/types';
import type { SlotChange } from '@/lib/social-hub/slots/write';
import { nyDateOf } from '@/lib/social-hub/time';
import type { Vertical } from '@/lib/social-hub/types';
import { dayShortLabel, WEEKDAY_LONG, type BoardPost, type WeekDayInput } from '@/lib/social-hub/views/week';

/**
 * The week board's edits (spec 2026-10-20-calendar-week-board-redesign), as
 * pure plans: what a drop would do (the ghost's tag and tone), the slot
 * changes an edit sends, the changes that undo it, Reset day, and which
 * booked posts an edit would leave without a slot. Every edit here is a date
 * edit; standing changes happen only in the Schedules tool.
 * Every plan goes through slots/rules.ts, the same rules the server applies;
 * the server stays the judge. The board applies a plan's `next` on screen
 * while it saves (and for good on the preview, which saves nothing).
 */

export { WEEKDAY_LONG };

export type BoardState<P extends BoardPost = BoardPost> = {
  days: WeekDayInput[];
  /** Each weekday's standing slots (0 = Sunday): what Reset day restores and Gaps compare with. */
  standard: Readonly<Record<number, readonly ResolvedSlot[]>>;
  posts: P[];
};

export type Clock = { today: string; nowMinute: number };

export const clockOf = (now: Date): Clock => ({ today: nyDateOf(now)!, nowMinute: nyMinuteOf(now) });

export type Edit =
  | { op: 'place'; day: number; vertical: Vertical; series: StorySeries | null; minute: number; feedMode?: FeedMode | null; clearCarousels?: boolean }
  | { op: 'move'; day: number; key: SlotKey; to: number; minute: number; clearCarousels?: boolean }
  | { op: 'remove'; day: number; key: SlotKey }
  | { op: 'mode'; day: number; key: SlotKey; feedMode: FeedMode };

export type Plan<P extends BoardPost = BoardPost> = {
  ok: true;
  /** Nothing would change (a drop on its own spot). */
  noop: boolean;
  minute: number | null;
  /** What happened, for the toast ("Explainer moved to 12:00 PM on Wed Oct 21"). */
  label: string;
  changes: SlotChange[];
  inverse: SlotChange[];
  next: BoardState<P>;
};

/** A post that holds its slot until it posts (the slot writer's booked set). */
const HOLDING = new Set(['scheduled', 'publishing', 'ready']);

/** A post in one of these keeps another post out of its slot: waiting, posting or posted. */
export const holdsSlot = (status: BoardPost['status']): boolean => HOLDING.has(status) || status === 'published';

/** Whether another post already holds a time on this date for a Ready post (one rule for the ghost and for Place). */
export function readyTakenAt(state: BoardState<BoardPost>, item: Pick<BoardPost, 'id' | 'vertical'>, series: StorySeries | null, nyDate: string | null): (minute: number) => boolean {
  return (m) => state.posts.some((p) => p.id !== item.id && p.vertical === item.vertical && p.nyDate === nyDate && p.slot?.id === slotId(m, series) && holdsSlot(p.status));
}

/**
 * What a dragover's preview depends on: the day, and the snapped minute or
 * the usual start the hysteresis holds. The board re-runs dropState only when
 * this changes (dropState's own snap and hold, as one key).
 */
export function dropKey(day: number, raw: number, vertical: Vertical, prev: Pick<Drop, 'minute' | 'snappedTo'> | null): string {
  if (prev?.snappedTo && Math.abs(raw - prev.minute) <= 10) return `${day}|h${prev.minute}`;
  return `${day}|${snapMinute(raw, vertical).minute}`;
}

export const nameOf = (k: { vertical: Vertical; series: StorySeries | null }): string => (k.series ? SERIES_NAME[k.series].one : TYPE_NAME[k.vertical].one);

const keyOf = (s: SlotKey): SlotKey => ({ vertical: s.vertical, startMinute: s.startMinute, series: s.series });

export function dayCtx(state: BoardState<BoardPost>, day: number, clock: Clock): DayCtx {
  const d = state.days[day]!;
  return { nyDate: d.nyDate, weekday: d.weekday, slots: [...d.slots], today: clock.today, nowMinute: clock.nowMinute };
}

/** "Wed Oct 21". */
export function dayName(state: BoardState<BoardPost>, day: number): string {
  return dayShortLabel(state.days[day]!.nyDate);
}

/** The toast: a board edit holds for that date only. */
export const toastText = (label: string): string => `${label}. Just this date.`;

// ── Slot changes in the writer's shape ──

const clearOf = (clear?: boolean) => (clear ? { clearCarousels: true as const } : {});

function putAdd(state: BoardState<BoardPost>, day: number, key: SlotKey, feedMode: FeedMode | null, clear?: boolean): SlotChange {
  return { scope: 'date', op: 'put', nyDate: state.days[day]!.nyDate, action: 'add', ...keyOf(key), feedMode, ...clearOf(clear) };
}

function putRemove(state: BoardState<BoardPost>, day: number, key: SlotKey): SlotChange {
  return { scope: 'date', op: 'put', nyDate: state.days[day]!.nyDate, action: 'remove', ...keyOf(key) };
}

function moveChange(state: BoardState<BoardPost>, from: number, key: SlotKey, to: number, minute: number, clear?: boolean): SlotChange {
  const a = state.days[from]!;
  const b = state.days[to]!;
  return { scope: 'date', op: 'move', from: { nyDate: a.nyDate, ...keyOf(key) }, to: { nyDate: b.nyDate, startMinute: minute }, ...clearOf(clear) };
}

/** The keys the person has now set on a date (each once): a board edit's keys join them, so the date reads Edited at once. */
function withPerson(personKeys: readonly SlotKey[], keys: readonly SlotKey[]): SlotKey[] {
  const out = [...personKeys];
  for (const k of keys) if (!out.some((x) => sameSlotKey(x, k))) out.push(keyOf(k));
  return out;
}

// ── Drop preview ──

export type DropTone = 'usual' | 'outside' | 'cap' | 'confirm' | 'refused';

export type Drop = {
  minute: number;
  snappedTo: string | null;
  tone: DropTone;
  /** The ghost's tag: "1:00 PM · usual afternoon", or the reason it can't go there. */
  tag: string;
  reason: string | null;
  confirm?: 'remove-carousels';
};

const capName = (vertical: Vertical, series: StorySeries | null) => (vertical === 'stories' && series ? SERIES_NAME[series].many : TYPE_NAME[vertical].many);

export const TAKEN = 'That slot is taken.';

/**
 * Where a drop lands and how it reads (decisions 6, 7, 12, 13; §Safety cap).
 * Snaps with snapMinute; once snapped it holds the usual start until the
 * pointer is more than 10 minutes away (ruling R5). Refused (red, with the
 * reason) beats asking (LFD onto a Carousel day) beats the daily limit beats
 * outside the usual windows. `ignore` is the card being moved within its day.
 * `ready` is a Ready to place post: it fills an existing empty slot at that
 * time, and a Story only ever goes into one of its series' slots.
 */
export function dropState(input: {
  ctx: DayCtx;
  vertical: Vertical;
  series: StorySeries | null;
  raw: number;
  caps: Record<Vertical, number>;
  ignore?: SlotKey | null;
  prev?: Pick<Drop, 'minute' | 'snappedTo'> | null;
  ready?: { taken: (minute: number) => boolean } | null;
}): Drop {
  const { ctx, vertical, series } = input;
  let snap = snapMinute(input.raw, vertical);
  if (input.prev?.snappedTo && Math.abs(input.raw - input.prev.minute) <= 10) snap = { minute: input.prev.minute, snappedTo: input.prev.snappedTo };
  const refused = (reason: string): Drop => ({ minute: snap.minute, snappedTo: snap.snappedTo, tone: 'refused', tag: reason, reason });

  let minute: number;
  if (input.ready) {
    const existing = ctx.slots.find((s) => sameSlotKey(s, { vertical, startMinute: snap.minute, series }));
    if (existing) {
      if (ctx.nyDate !== null && ctx.nyDate < ctx.today) return refused(PAST_DAY);
      if (isLocked(ctx, existing)) return refused(ALREADY_STARTED);
      if (input.ready.taken(snap.minute)) return refused(TAKEN);
      minute = snap.minute;
    } else if (vertical === 'stories') {
      return refused(`${clockLabel(snap.minute)} isn’t a ${series ? SERIES_NAME[series].one : 'Stories'} slot.`);
    } else {
      const r = canPlace(ctx, { vertical, startMinute: snap.minute, series });
      if (!r.ok) return refused(r.reason);
      // A booking kept at that time after its slot left the calendar still holds it (the place action's rule).
      if (input.ready.taken(r.minute)) return refused(TAKEN);
      minute = r.minute;
    }
  } else {
    const r = canPlace(ctx, { vertical, startMinute: snap.minute, series, ...(input.ignore ? { ignore: input.ignore } : {}) });
    if (!r.ok) {
      if (r.confirm) return { minute: snap.minute, snappedTo: snap.snappedTo, tone: 'confirm', tag: `${clockLabel(snap.minute)} · Carousels come off that day`, reason: r.reason, confirm: r.confirm };
      return refused(r.reason);
    }
    minute = r.minute;
  }

  const time = clockLabel(minute);
  const cap = input.caps[vertical];
  const count = ctx.slots.filter((s) => s.vertical === vertical && (vertical !== 'stories' || s.series === series) && !(input.ignore && sameSlotKey(s, input.ignore))).length;
  const fills = input.ready && ctx.slots.some((s) => sameSlotKey(s, { vertical, startMinute: minute, series }));
  const snappedTo = minute === snap.minute ? snap.snappedTo : null;
  if (!fills && count >= cap) return { minute, snappedTo, tone: 'cap', tag: `${time} · At the daily limit for ${capName(vertical, series)} (${cap})`, reason: null };
  if (!isUsual(vertical, minute)) return { minute, snappedTo, tone: 'outside', tag: `${time} · outside usual window`, reason: null };
  return { minute, snappedTo, tone: 'usual', tag: snappedTo ? `${time} · usual ${snappedTo.toLowerCase()}` : time, reason: null };
}

// ── Plans ──

const withDays = <P extends BoardPost>(state: BoardState<P>, days: WeekDayInput[], posts: P[] = state.posts): BoardState<P> => ({ ...state, days, posts });

const noop = <P extends BoardPost>(state: BoardState<P>, minute: number | null): Plan<P> => ({ ok: true, noop: true, minute, label: '', changes: [], inverse: [], next: state });

/** The edit's changes, undo and the board after it, through the rules. Booked posts on a moved slot move with it on screen. */
export function planEdit<P extends BoardPost>(state: BoardState<P>, edit: Edit, clock: Clock): Plan<P> | Refusal {
  const days = state.days.map((d) => ({ ...d, slots: [...d.slots] }));
  const set = (i: number, slots: readonly ResolvedSlot[], keys: readonly SlotKey[]) => { days[i] = { ...days[i]!, slots: sortSlots([...slots]), personKeys: withPerson(days[i]!.personKeys, keys) }; };
  const where = dayName(state, edit.day);

  if (edit.op === 'place') {
    const feedMode = isReelType(edit.vertical) ? (edit.feedMode ?? DEFAULT_FEED_MODE[edit.vertical]) : null;
    const asked: SlotKey = { vertical: edit.vertical, startMinute: edit.minute, series: edit.series };
    const r = applyPlace(dayCtx(state, edit.day, clock), { ...asked, feedMode }, { clearCarousels: edit.clearCarousels });
    if (!r.ok) return r;
    const placed = { ...asked, startMinute: r.minute };
    set(edit.day, r.slots, [placed, ...r.removed]);
    const lfd = r.removed.length ? '; its Carousels are off' : '';
    return {
      ok: true, noop: false, minute: r.minute,
      label: `${nameOf(placed)} added to ${where} at ${clockLabel(r.minute)}${lfd}`,
      changes: [putAdd(state, edit.day, placed, feedMode, edit.clearCarousels)],
      inverse: [putRemove(state, edit.day, placed), ...r.removed.map((c) => putAdd(state, edit.day, c, c.feedMode))],
      next: withDays(state, days),
    };
  }

  if (edit.op === 'move') {
    const from = dayCtx(state, edit.day, clock);
    const to = edit.to === edit.day ? from : dayCtx(state, edit.to, clock);
    const r = applyMove(from, to, edit.key, edit.minute, { clearCarousels: edit.clearCarousels });
    if (!r.ok) return r;
    if (r.noop) return noop(state, r.minute);
    const moved = { ...edit.key, startMinute: r.minute };
    if (edit.to === edit.day) set(edit.day, r.from, [edit.key, moved, ...r.removed]);
    else { set(edit.day, r.from, [edit.key]); set(edit.to, r.to, [moved, ...r.removed]); }
    const a = state.days[edit.day]!;
    const b = state.days[edit.to]!;
    const oldId = slotId(edit.key.startMinute, edit.key.series);
    const posts = state.posts.map((p) =>
      p.vertical === edit.key.vertical && p.nyDate === a.nyDate && p.slot?.id === oldId && HOLDING.has(p.status)
        ? { ...p, nyDate: b.nyDate, slot: { id: slotId(r.minute, edit.key.series), label: clockLabel(r.minute) } }
        : p);
    const time = clockLabel(r.minute);
    return {
      ok: true, noop: false, minute: r.minute,
      label: edit.to === edit.day ? `${nameOf(edit.key)} moved to ${time} on ${where}` : `${nameOf(edit.key)} moved to ${dayName(state, edit.to)} at ${time}`,
      changes: [moveChange(state, edit.day, edit.key, edit.to, r.minute, edit.clearCarousels)],
      inverse: [moveChange(state, edit.to, moved, edit.day, edit.key.startMinute), ...r.removed.map((c) => putAdd(state, edit.to, c, c.feedMode))],
      next: withDays(state, days, posts),
    };
  }

  const ctx = dayCtx(state, edit.day, clock);
  if (edit.op === 'remove') {
    const r = applyRemove(ctx, edit.key);
    if (!r.ok) return r;
    set(edit.day, r.slots, [edit.key]);
    return {
      ok: true, noop: false, minute: null,
      label: `${nameOf(edit.key)} removed from ${where}`,
      changes: [putRemove(state, edit.day, edit.key)],
      inverse: [putAdd(state, edit.day, edit.key, r.removed.feedMode)],
      next: withDays(state, days),
    };
  }

  // Trial / Main.
  const slot = ctx.slots.find((s) => sameSlotKey(s, edit.key));
  if (!slot) return { ok: false, reason: 'That slot isn’t on this day.' };
  if (!isReelType(slot.vertical)) return { ok: false, reason: 'Only reels post as Trial or Main feed.' };
  if (ctx.nyDate !== null && ctx.nyDate < ctx.today) return { ok: false, reason: PAST_DAY };
  if (isLocked(ctx, slot)) return { ok: false, reason: ALREADY_STARTED };
  if (slot.feedMode === edit.feedMode) return noop(state, slot.startMinute);
  set(edit.day, ctx.slots.map((s) => (sameSlotKey(s, edit.key) ? { ...s, feedMode: edit.feedMode } : s)), [edit.key]);
  return {
    ok: true, noop: false, minute: slot.startMinute,
    label: `${nameOf(edit.key)} on ${where} now posts ${edit.feedMode === 'trial' ? 'as a Trial reel' : 'to the main feed'}`,
    changes: [putAdd(state, edit.day, edit.key, edit.feedMode)],
    inverse: [putAdd(state, edit.day, edit.key, slot.feedMode)],
    next: withDays(state, days),
  };
}

export type Hit<P extends BoardPost = BoardPost> = { post: P; why: 'removed' | 'feed-mode' | 'cannot-move' };

/**
 * Waiting posts an edit would leave without their slot (spec decision 14): the
 * slot is gone, its Trial / Main changed, or it moved and the post can't move
 * from here (Stories, ruling R8). A non-Stories post on a moved slot moves
 * with it, so it isn't a hit. Same reading as the slot writer's 409.
 */
export function bookedHits<P extends BoardPost>(before: BoardState<P>, after: BoardState<P>): Hit<P>[] {
  const slotAt = (s: BoardState<P>, nyDate: string | null, id: string | undefined, vertical: Vertical) => {
    const k = id ? parseSlotId(id) : null;
    const d = s.days.find((x) => x.nyDate === nyDate);
    return k && d ? d.slots.find((x) => sameSlotKey(x, { vertical, ...k })) : undefined;
  };
  const hits: Hit<P>[] = [];
  for (const post of before.posts) {
    if (post.status !== 'scheduled' || !post.nyDate || !post.slot) continue;
    const was = slotAt(before, post.nyDate, post.slot.id, post.vertical);
    if (!was) continue;
    const now = after.posts.find((p) => p.id === post.id) ?? post;
    const carried = now.nyDate !== post.nyDate || now.slot?.id !== post.slot.id;
    const is = slotAt(after, now.nyDate, now.slot?.id, post.vertical);
    if (!is) hits.push({ post, why: 'removed' });
    else if (carried && post.vertical === 'stories') hits.push({ post, why: 'cannot-move' });
    else if (!carried && isReelType(post.vertical) && was.feedMode !== is.feedMode) hits.push({ post, why: 'feed-mode' });
  }
  return hits;
}

/**
 * Reset day (spec 2026-10-21 §3): the date's own edits go, one `delete` per
 * key the person set, so those keys go back to the schedule. A system pin
 * (today's started slot held, a pin a schedule save wrote) stays, and so does
 * a key that has started or posted. Deletes that take a slot off go first,
 * so a slot coming back never meets the one it replaced halfway (Last Few
 * Days and Carousels). The inverse puts the person's edits back, in reverse.
 */
export function planReset<P extends BoardPost>(state: BoardState<P>, day: number, clock: Clock): Plan<P> | Refusal {
  const ctx = dayCtx(state, day, clock);
  const nyDate = state.days[day]!.nyDate;
  if (nyDate < ctx.today) return { ok: false, reason: PAST_DAY };
  const std = state.standard[ctx.weekday] ?? [];
  const posted = new Set(state.posts.filter((p) => p.status === 'published' && p.nyDate === nyDate && p.slot).map((p) => `${p.vertical}|${p.slot!.id}`));
  const kept: SlotKey[] = [];
  const off: Array<{ key: SlotKey; cur: ResolvedSlot | undefined }> = [];
  const back: Array<{ key: SlotKey; cur: ResolvedSlot | undefined }> = [];
  let slots = [...ctx.slots];
  for (const key of state.days[day]!.personKeys) {
    if (isLocked(ctx, key) || posted.has(`${key.vertical}|${slotId(key.startMinute, key.series)}`)) { kept.push(key); continue; }
    const cur = ctx.slots.find((s) => sameSlotKey(s, key));
    const base = std.find((s) => sameSlotKey(s, key));
    (cur && !base ? off : back).push({ key, cur });
    slots = slots.filter((s) => !sameSlotKey(s, key));
    if (base) slots.push({ ...base, origin: 'template' });
  }
  const resets = [...off, ...back];
  if (!resets.length) return noop(state, null);
  const changes: SlotChange[] = resets.map(({ key }) => ({ scope: 'date', op: 'delete', nyDate, ...keyOf(key) }));
  const inverse: SlotChange[] = resets.map(({ key, cur }) => (cur ? putAdd(state, day, key, cur.feedMode) : putRemove(state, day, key))).reverse();
  const days = state.days.map((d, i) => (i === day ? { ...d, slots: sortSlots(slots), personKeys: kept } : d));
  return { ok: true, noop: false, minute: null, label: `${dayName(state, day)} is back to its schedule`, changes, inverse, next: withDays(state, days) };
}

/**
 * A Ready to place post dropped on a day and time (decision 16): it fills an
 * empty slot there, or makes a new one (never for Stories, whose sets take one
 * of the day's Stories slots). It still needs approval. The place action books it.
 */
export function planReady<P extends BoardPost>(
  state: BoardState<P>,
  post: P & { name: string },
  series: StorySeries | null,
  day: number,
  minute: number,
  clock: Clock,
): { ok: true; minute: number; slot: string; label: string; next: BoardState<P> } | Refusal {
  const ctx = dayCtx(state, day, clock);
  const nyDate = state.days[day]!.nyDate;
  const taken = readyTakenAt(state, post, series, nyDate);
  const d = dropState({ ctx, vertical: post.vertical, series, raw: minute, caps: { reels: 99, explainers: 99, carousels: 99, last_few_days: 99, stories: 99 }, ready: { taken } });
  if (d.tone === 'refused' || d.tone === 'confirm') return { ok: false, reason: d.reason ?? TAKEN };
  const at = d.minute;
  const key: SlotKey = { vertical: post.vertical, startMinute: at, series };
  const slots = ctx.slots.some((s) => sameSlotKey(s, key))
    ? ctx.slots
    : sortSlots([...ctx.slots, { ...key, feedMode: isReelType(post.vertical) ? DEFAULT_FEED_MODE[post.vertical] : null, origin: 'override' as const }]);
  // A placement is the person's (placement.ts writes set_by 'person').
  const days = state.days.map((x, i) => (i === day ? { ...x, slots, personKeys: withPerson(x.personKeys, [key]) } : x));
  const id = slotId(at, series);
  const placed = { ...post, nyDate, slot: { id, label: clockLabel(at) }, status: 'scheduled' as const, approval: { ...post.approval, approvedAt: null } };
  const posts = [...state.posts.filter((p) => p.id !== post.id), placed];
  return { ok: true, minute: at, slot: id, label: `“${post.name}” placed on ${dayName(state, day)} at ${clockLabel(at)}. It still needs approval.`, next: withDays(state, days, posts) };
}

/**
 * The start times a day can still take, on the 15-minute grid from 8:00 AM to
 * 8:45 PM: today only after now (a slot at now has started), none on a past
 * day. The place picker's Time menu.
 */
export function openMinutes(ctx: DayCtx): number[] {
  if (ctx.nyDate !== null && ctx.nyDate < ctx.today) return [];
  const from = ctx.nyDate !== null && ctx.nyDate === ctx.today ? Math.max(DAY_START, nextOpenMinute(ctx.nowMinute)) : DAY_START;
  const out: number[] = [];
  for (let m = from; m <= LAST_START; m += GRID) out.push(m);
  return out;
}

/** The picker's first time: today the next open mark; another day the type's first usual start, else its first open time. Null when the day has none. */
export function defaultPlaceMinute(ctx: DayCtx, vertical: Vertical): number | null {
  const open = openMinutes(ctx);
  if (!open.length) return null;
  if (ctx.nyDate !== null && ctx.nyDate === ctx.today) return open[0]!;
  return USUAL[vertical].map((w) => w.start).find((m) => open.includes(m)) ?? open[0]!;
}

/**
 * The times a Ready to place post can take on a day: a Story only its
 * series' open Stories slots (a set never adds a slot); anything else every
 * open time (openMinutes).
 */
export function readyMinutes(ctx: DayCtx, vertical: Vertical, series: StorySeries | null): number[] {
  const open = openMinutes(ctx);
  if (vertical !== 'stories') return open;
  return ctx.slots.filter((s) => s.vertical === 'stories' && s.series === series && open.includes(s.startMinute)).map((s) => s.startMinute).sort((a, b) => a - b);
}

// ── Batch select (spec 2026-10-21 §2) ──

/** One action for every selected card. */
export type BatchAction = { op: 'time'; minute: number } | { op: 'mode'; feedMode: FeedMode } | { op: 'remove' };

/** Set time's skip when the picked minute has passed today: the time is exact, so the card never moves to another one. */
export const TIME_PASSED = 'That time has passed today.';

/** A batch is sent as saves of at most MAX_CHANGES (the slot writer's per-call limit). */
export function chunked<T>(list: readonly T[], size = MAX_CHANGES): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export type Batch<P extends BoardPost = BoardPost> = {
  label: string;
  /** The changes as saves of at most MAX_CHANGES, sent in order. */
  chunks: SlotChange[][];
  /** `inverse[i]` undoes `chunks[i]`; undo sends them last chunk first. */
  inverse: SlotChange[][];
  next: BoardState<P>;
  /** Cards the rules turned away; the rest of the batch still goes. */
  skipped: Array<{ key: SlotKey; day: number; reason: string }>;
  /** Waiting posts the batch would leave without their slot (one ask for all of them). */
  booked: Hit<P>[];
};

const nOf = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * The same action on several cards, each on its own date. Every card goes
 * through planEdit, on the board as the cards before it left it, so a batch
 * follows the single-edit rules exactly: a locked card, a duplicate minute or
 * a Trial / Main on a type that has none is skipped with its reason, and the
 * rest still applies. Set time keeps each card on its date at the exact
 * minute picked (no snap): a minute already passed today skips that card
 * (TIME_PASSED) rather than moving it to the next open time. Every change is a date change (the slot writer
 * marks it the person's).
 */
export function planBatch<P extends BoardPost>(state: BoardState<P>, keys: ReadonlyArray<{ day: number; key: SlotKey }>, action: BatchAction, clock: Clock): Batch<P> {
  let cur = state;
  const changes: SlotChange[][] = [];
  const inverses: SlotChange[][] = [];
  const skipped: Batch<P>['skipped'] = [];
  for (const { day, key } of keys) {
    if (action.op === 'mode' && !isReelType(key.vertical)) {
      skipped.push({ key, day, reason: `No Trial / Main for ${key.series ? SERIES_NAME[key.series].many : TYPE_NAME[key.vertical].many}.` });
      continue;
    }
    if (action.op === 'time' && state.days[day]!.nyDate === clock.today && action.minute <= clock.nowMinute) {
      skipped.push({ key, day, reason: TIME_PASSED });
      continue;
    }
    const edit: Edit = action.op === 'time'
      ? { op: 'move', day, key, to: day, minute: action.minute }
      : action.op === 'mode' ? { op: 'mode', day, key, feedMode: action.feedMode } : { op: 'remove', day, key };
    const p = planEdit(cur, edit, clock);
    if (!p.ok) { skipped.push({ key, day, reason: p.reason }); continue; }
    // The rules never land Set time elsewhere once the passed-minute check is done; if they ever did, skip rather than misreport.
    if (action.op === 'time' && p.minute !== action.minute) { skipped.push({ key, day, reason: TIME_PASSED }); continue; }
    if (p.noop) continue;
    cur = p.next;
    changes.push(p.changes);
    inverses.push(p.inverse);
  }
  // Chunk by edit so an edit's changes and its inverse stay in the same save; each chunk's inverse runs newest edit first.
  const chunks: SlotChange[][] = [];
  const inverse: SlotChange[][] = [];
  let at = 0;
  while (at < changes.length) {
    let size = 0;
    let end = at;
    while (end < changes.length && size + Math.max(changes[end]!.length, inverses[end]!.length) <= MAX_CHANGES) { size += Math.max(changes[end]!.length, inverses[end]!.length); end++; }
    if (end === at) end = at + 1;
    chunks.push(changes.slice(at, end).flat());
    inverse.push(inverses.slice(at, end).reverse().flat());
    at = end;
  }
  const n = changes.length;
  const label = !n ? ''
    : action.op === 'time' ? `${nOf(n, 'slot')} moved to ${clockLabel(action.minute)}`
      : action.op === 'mode' ? `${nOf(n, 'slot')} now post${n === 1 ? 's' : ''} ${action.feedMode === 'trial' ? (n === 1 ? 'as a Trial reel' : 'as Trial reels') : 'to the main feed'}`
        : `${nOf(n, 'slot')} removed`;
  return { label, chunks, inverse, next: cur, skipped, booked: bookedHits(state, cur) };
}

/** Select mode's state: the week it belongs to, whether it is on, and the selected cards' keys. */
export type Selection = { monday: string; on: boolean; picked: readonly string[] };

/**
 * The selection that still applies to the board on screen. A new week clears
 * it and leaves select mode (card keys are day index and slot, so they would
 * name next week's dates). Otherwise only keys of cards still on the board
 * stay (an Undo or a refresh can take a selected card away, and its key must
 * not come back selected on another card later). The same object when
 * nothing changes.
 */
export function syncSelection(sel: Selection, monday: string, cards: ReadonlyArray<{ key: string }>): Selection {
  if (sel.monday !== monday) return { monday, on: false, picked: [] };
  const live = sel.picked.filter((k) => cards.some((c) => c.key === k));
  return live.length === sel.picked.length ? sel : { ...sel, picked: live };
}

/** The batch toast: what was done ("3 slots moved to 11:30 AM. Just these dates.") and each skipped part ("1 skipped: No Trial / Main for Carousels."). */
export function batchToast(b: Pick<Batch, 'label' | 'skipped'>): string {
  const by = new Map<string, number>();
  for (const s of b.skipped) by.set(s.reason, (by.get(s.reason) ?? 0) + 1);
  const skipped = [...by].map(([reason, n]) => `${n} skipped: ${reason}`);
  return [b.label ? `${b.label}. Just these dates.` : 'Nothing changed.', ...skipped].join(' ');
}
