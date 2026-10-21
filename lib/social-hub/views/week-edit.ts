import { sortSlots } from '@/lib/social-hub/slots/resolve';
import { ALREADY_STARTED, applyMove, applyPlace, applyRemove, canPlace, isLocked, PAST_DAY, type DayCtx, type Refusal } from '@/lib/social-hub/slots/rules';
import { clockLabel, DAY_START, DEFAULT_FEED_MODE, GRID, isUsual, LAST_START, nextOpenMinute, nyMinuteOf, SERIES_NAME, snapMinute, TYPE_NAME, USUAL } from '@/lib/social-hub/slots/times';
import { isReelType, parseSlotId, sameSlotKey, slotId, type FeedMode, type ResolvedSlot, type SlotKey, type StorySeries } from '@/lib/social-hub/slots/types';
import type { SlotChange } from '@/lib/social-hub/slots/write';
import { nyDateOf } from '@/lib/social-hub/time';
import type { Vertical } from '@/lib/social-hub/types';
import { dayShortLabel, WEEKDAY_LONG, type BoardPost, type WeekDayInput } from '@/lib/social-hub/views/week';

/**
 * The week board's edits (spec 2026-10-20-calendar-week-board-redesign), as
 * pure plans: what a drop would do (the ghost's tag and tone), the slot
 * changes an edit sends, the changes that undo it, "Make it every
 * <weekday>", and which booked posts an edit would leave without a slot.
 * Every plan goes through slots/rules.ts, the same rules the server applies;
 * the server stays the judge. The board applies a plan's `next` on screen
 * while it saves (and for good on the preview, which saves nothing).
 */

export { WEEKDAY_LONG };

export type BoardState<P extends BoardPost = BoardPost> = {
  mode: 'week' | 'template';
  days: WeekDayInput[];
  /** Each weekday's Standard week slots (0 = Sunday). */
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
  return { nyDate: state.mode === 'week' ? d.nyDate : null, weekday: d.weekday, slots: [...d.slots], today: clock.today, nowMinute: clock.nowMinute };
}

/** "Wed Oct 21", or "every Wednesday" on the Standard week tab. */
export function dayName(state: BoardState<BoardPost>, day: number): string {
  const d = state.days[day]!;
  return state.mode === 'week' && d.nyDate ? dayShortLabel(d.nyDate) : `every ${WEEKDAY_LONG[d.weekday]}`;
}

/** The toast: a date edit is "Just this date."; a Standard week edit holds every week. */
export const toastText = (label: string, mode: BoardState['mode']): string => `${label}. ${mode === 'week' ? 'Just this date.' : 'Every week from now on.'}`;

// ── Slot changes in the writer's shape ──

const clearOf = (clear?: boolean) => (clear ? { clearCarousels: true as const } : {});

function putAdd(state: BoardState<BoardPost>, day: number, key: SlotKey, feedMode: FeedMode | null, clear?: boolean): SlotChange {
  const d = state.days[day]!;
  const k = keyOf(key);
  return state.mode === 'week'
    ? { scope: 'date', op: 'put', nyDate: d.nyDate!, action: 'add', ...k, feedMode, ...clearOf(clear) }
    : { scope: 'template', op: 'put', weekday: d.weekday, ...k, feedMode, ...clearOf(clear) };
}

function putRemove(state: BoardState<BoardPost>, day: number, key: SlotKey): SlotChange {
  const d = state.days[day]!;
  const k = keyOf(key);
  return state.mode === 'week' ? { scope: 'date', op: 'put', nyDate: d.nyDate!, action: 'remove', ...k } : { scope: 'template', op: 'delete', weekday: d.weekday, ...k };
}

function moveChange(state: BoardState<BoardPost>, from: number, key: SlotKey, to: number, minute: number, clear?: boolean): SlotChange {
  const a = state.days[from]!;
  const b = state.days[to]!;
  const k = keyOf(key);
  return state.mode === 'week'
    ? { scope: 'date', op: 'move', from: { nyDate: a.nyDate!, ...k }, to: { nyDate: b.nyDate!, startMinute: minute }, ...clearOf(clear) }
    : { scope: 'template', op: 'move', from: { weekday: a.weekday, ...k }, to: { weekday: b.weekday, startMinute: minute }, ...clearOf(clear) };
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
  const set = (i: number, slots: readonly ResolvedSlot[]) => { days[i] = { ...days[i]!, slots: sortSlots([...slots]) }; };
  const where = dayName(state, edit.day);

  if (edit.op === 'place') {
    const feedMode = isReelType(edit.vertical) ? (edit.feedMode ?? DEFAULT_FEED_MODE[edit.vertical]) : null;
    const asked: SlotKey = { vertical: edit.vertical, startMinute: edit.minute, series: edit.series };
    const r = applyPlace(dayCtx(state, edit.day, clock), { ...asked, feedMode }, { clearCarousels: edit.clearCarousels });
    if (!r.ok) return r;
    set(edit.day, r.slots);
    const placed = { ...asked, startMinute: r.minute };
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
    set(edit.day, r.from);
    if (edit.to !== edit.day) set(edit.to, r.to);
    const moved = { ...edit.key, startMinute: r.minute };
    const a = state.days[edit.day]!;
    const b = state.days[edit.to]!;
    const oldId = slotId(edit.key.startMinute, edit.key.series);
    const posts = state.mode !== 'week' ? state.posts : state.posts.map((p) =>
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
    set(edit.day, r.slots);
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
  set(edit.day, ctx.slots.map((s) => (sameSlotKey(s, edit.key) ? { ...s, feedMode: edit.feedMode } : s)));
  return {
    ok: true, noop: false, minute: slot.startMinute,
    label: `${nameOf(edit.key)} on ${where} now posts ${edit.feedMode === 'trial' ? 'as a Trial reel' : 'to the main feed'}`,
    changes: [putAdd(state, edit.day, edit.key, edit.feedMode)],
    inverse: [putAdd(state, edit.day, edit.key, slot.feedMode)],
    next: withDays(state, days),
  };
}

export type Every = Omit<Plan<BoardPost>, 'next'> & { button: string; standard: Record<number, readonly ResolvedSlot[]> };

/**
 * "Make it every <weekday>" (spec, Calls I made): the change just made, on the
 * Standard week only. A move between days applies both halves (a template
 * move); a change the Standard week already matches, or can't take, has
 * nothing to save (null). `edit` carries the minute the change landed on.
 */
export function everyFor(state: BoardState<BoardPost>, edit: Edit, clock: Clock): Every | null {
  if (state.mode !== 'week') return null;
  const t: BoardState<BoardPost> = {
    mode: 'template',
    days: state.days.map((d) => ({ nyDate: null, weekday: d.weekday, slots: [...(state.standard[d.weekday] ?? [])] })),
    standard: state.standard,
    posts: [],
  };
  const has = (day: number, key: SlotKey) => t.days[day]!.slots.find((s) => sameSlotKey(s, key));
  const dateSlot = (day: number, key: SlotKey) => state.days[day]!.slots.find((s) => sameSlotKey(s, key));
  let e: Edit | null = null;
  if (edit.op === 'place') {
    const key: SlotKey = { vertical: edit.vertical, startMinute: edit.minute, series: edit.series };
    const there = has(edit.day, key);
    const mode = isReelType(edit.vertical) ? (edit.feedMode ?? DEFAULT_FEED_MODE[edit.vertical]) : null;
    e = !there ? edit : mode && there.feedMode !== mode ? { op: 'mode', day: edit.day, key, feedMode: mode } : null;
  } else if (edit.op === 'move') {
    const moved = { ...edit.key, startMinute: edit.minute };
    e = has(edit.day, edit.key)
      ? edit
      : { op: 'place', day: edit.to, vertical: edit.key.vertical, series: edit.key.series, minute: edit.minute, feedMode: dateSlot(edit.to, moved)?.feedMode ?? null, clearCarousels: edit.clearCarousels };
  } else if (edit.op === 'remove') {
    e = has(edit.day, edit.key) ? edit : null;
  } else {
    const there = has(edit.day, edit.key);
    e = !there ? { op: 'place', day: edit.day, vertical: edit.key.vertical, series: edit.key.series, minute: edit.key.startMinute, feedMode: edit.feedMode } : there.feedMode === edit.feedMode ? null : edit;
  }
  if (!e) return null;
  const r = planEdit(t, e, clock);
  if (!r.ok || r.noop) return null;
  // The days the saved change touches: a move that became a place on the target names only the target.
  const touched = [...new Set([e.day, e.op === 'move' ? e.to : e.day])];
  const standard: Record<number, readonly ResolvedSlot[]> = { ...state.standard };
  for (const i of touched) standard[t.days[i]!.weekday] = r.next.days[i]!.slots;
  const names = touched.map((i) => WEEKDAY_LONG[state.days[i]!.weekday]).join(' and ');
  return { ok: true, noop: false, minute: r.minute, label: `Saved: every ${names} now has this change`, changes: r.changes, inverse: r.inverse, button: `Make it every ${names}`, standard };
}

export type Hit<P extends BoardPost = BoardPost> = { post: P; why: 'removed' | 'feed-mode' | 'cannot-move' };

/**
 * Waiting posts an edit would leave without their slot (spec decision 14): the
 * slot is gone, its Trial / Main changed, or it moved and the post can't move
 * from here (Stories, ruling R8). A non-Stories post on a moved slot moves
 * with it, so it isn't a hit. Same reading as the slot writer's 409.
 */
export function bookedHits<P extends BoardPost>(before: BoardState<P>, after: BoardState<P>): Hit<P>[] {
  if (before.mode !== 'week') return [];
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
 * Reset day (decision 11, Must handle §2): every key of the date that differs
 * from the Standard week goes back to it, one `delete` each, except slots that
 * have started or posted, which stay as they are. The inverse rebuilds the day.
 */
export function planReset<P extends BoardPost>(state: BoardState<P>, day: number, clock: Clock): Plan<P> | Refusal {
  const ctx = dayCtx(state, day, clock);
  if (state.mode !== 'week' || ctx.nyDate === null) return { ok: false, reason: 'The Standard week has nothing to reset.' };
  if (ctx.nyDate < ctx.today) return { ok: false, reason: PAST_DAY };
  const std = state.standard[ctx.weekday] ?? [];
  const keys = new Map<string, SlotKey>();
  for (const s of [...ctx.slots, ...std]) keys.set(`${s.vertical}|${slotId(s.startMinute, s.series)}`, keyOf(s));
  const posted = new Set(state.posts.filter((p) => p.status === 'published' && p.nyDate === ctx.nyDate && p.slot).map((p) => `${p.vertical}|${p.slot!.id}`));
  const slots: ResolvedSlot[] = [];
  const changes: SlotChange[] = [];
  const inverse: SlotChange[] = [];
  for (const [id, key] of keys) {
    const cur = ctx.slots.find((s) => sameSlotKey(s, key));
    const base = std.find((s) => sameSlotKey(s, key));
    if (isLocked(ctx, key) || posted.has(id)) {
      if (cur) slots.push(cur);
      continue;
    }
    if (base) slots.push({ ...base, origin: 'template' });
    if ((!cur && !base) || (cur && base && cur.feedMode === base.feedMode)) continue;
    changes.push({ scope: 'date', op: 'delete', nyDate: ctx.nyDate, ...key });
    inverse.push(cur ? putAdd(state, day, key, cur.feedMode) : putRemove(state, day, key));
  }
  if (!changes.length) return noop(state, null);
  const days = state.days.map((d, i) => (i === day ? { ...d, slots: sortSlots(slots) } : d));
  return { ok: true, noop: false, minute: null, label: `${dayName(state, day)} is back to the standard week`, changes, inverse, next: withDays(state, days) };
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
  if (state.mode !== 'week') return { ok: false, reason: 'A post needs a real date. Place it on This week.' };
  const ctx = dayCtx(state, day, clock);
  const nyDate = ctx.nyDate!;
  const taken = readyTakenAt(state, post, series, nyDate);
  const d = dropState({ ctx, vertical: post.vertical, series, raw: minute, caps: { reels: 99, explainers: 99, carousels: 99, last_few_days: 99, stories: 99 }, ready: { taken } });
  if (d.tone === 'refused' || d.tone === 'confirm') return { ok: false, reason: d.reason ?? TAKEN };
  const at = d.minute;
  const key: SlotKey = { vertical: post.vertical, startMinute: at, series };
  const slots = ctx.slots.some((s) => sameSlotKey(s, key))
    ? ctx.slots
    : sortSlots([...ctx.slots, { ...key, feedMode: isReelType(post.vertical) ? DEFAULT_FEED_MODE[post.vertical] : null, origin: 'override' as const }]);
  const days = state.days.map((x, i) => (i === day ? { ...x, slots } : x));
  const id = slotId(at, series);
  const placed = { ...post, nyDate, slot: { id, label: clockLabel(at) }, status: 'scheduled' as const, approval: { ...post.approval, approvedAt: null } };
  const posts = [...state.posts.filter((p) => p.id !== post.id), placed];
  return { ok: true, minute: at, slot: id, label: `“${post.name}” placed on ${dayName(state, day)} at ${clockLabel(at)}. It still needs approval.`, next: withDays(state, days, posts) };
}

/**
 * "Make this every <weekday>" from the details panel (decision 9): the
 * Standard week's weekday becomes this date's slots, as template changes
 * (deletes first, so Last Few Days and Carousels never meet halfway).
 */
export function planCopyDay(state: BoardState<BoardPost>, day: number): (Omit<Plan<BoardPost>, 'next'> & { standard: Record<number, readonly ResolvedSlot[]> }) | Refusal {
  const d = state.days[day]!;
  if (state.mode !== 'week' || !d.nyDate) return { ok: false, reason: 'This is already the Standard week.' };
  const weekday = d.weekday;
  const std = sortSlots([...(state.standard[weekday] ?? [])]);
  const date = sortSlots([...d.slots]);
  const del = (s: SlotKey): SlotChange => ({ scope: 'template', op: 'delete', weekday, ...keyOf(s) });
  const put = (s: ResolvedSlot): SlotChange => ({ scope: 'template', op: 'put', weekday, ...keyOf(s), feedMode: s.feedMode });
  const gone = std.filter((s) => !date.some((x) => sameSlotKey(x, s)));
  const added = date.filter((s) => !std.some((x) => sameSlotKey(x, s) && x.feedMode === s.feedMode));
  const fresh = added.filter((s) => !std.some((x) => sameSlotKey(x, s)));
  const changes = [...gone.map(del), ...added.map(put)];
  const inverse = [...fresh.map(del), ...gone.map(put), ...added.filter((s) => !fresh.includes(s)).map((s) => put(std.find((x) => sameSlotKey(x, s))!))];
  const standard: Record<number, readonly ResolvedSlot[]> = { ...state.standard, [weekday]: date.map((s) => ({ ...s, origin: 'template' as const })) };
  if (!changes.length) return { ok: true, noop: true, minute: null, label: '', changes: [], inverse: [], standard: state.standard as Record<number, readonly ResolvedSlot[]> };
  return { ok: true, noop: false, minute: null, label: `Saved: every ${WEEKDAY_LONG[weekday]} now looks like ${dayShortLabel(d.nyDate)}`, changes, inverse, standard };
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
