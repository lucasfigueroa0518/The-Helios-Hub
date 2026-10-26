/**
 * Placing content on the calendar from the hub (Schedule here / move, D50).
 * Every type's own rules, checked in one place, against the lifecycle spine.
 * Legacy mode (slot_source 'legacy', the windows before the calendar):
 *
 *   - the slot is one of the type's windows (the values schedule_slot_check
 *     allows), on a day that window runs (Stories' series days);
 *   - the minute is drawn the way each scheduler draws it (lib/instagram/window.ts):
 *     uniform over the window's minutes still ahead, so never in the past;
 *   - one item per window per day per type (the spine's unique slot index);
 *   - Carousels and Explainers keep FEED_GAP_MINUTES from every other feed
 *     post; Trial Reels and Stories are exempt (D33);
 *   - rejected content, content posting right now and content already
 *     posted are refused.
 *
 * With the calendar (template mode, week board spec) a slot is a free time:
 * `slot` is a slot id (`t0780`, Stories `t0510:morning_download`; a window id
 * or a bare series reads as its start). A free slot of that day at that time
 * takes the content; any other time is a new slot checked by
 * slots/rules.ts canPlace (the one placement rule set: duplicates, LFD /
 * Carousels, 8 AM–9 PM, a time already passed today moves to the next
 * 15-minute mark), put on that date's calendar in the same statement as the
 * booking (R16). A move to a new time moves the post's slot with it, as the
 * board does: its old slot leaves its date and the new one keeps its Trial /
 * Main, so a move never leaves an empty slot behind for the night to fill.
 * The minute is the slot's drift minute in [slot, slot + 15] (slots/book.ts
 * driftMinute), 30 minutes from other feed posts when it is one. Stories
 * never add a slot here (their time lives in stories.sets).
 *
 * `place` books a new slot (source 'user': it takes one of that day's
 * windows, so the daily fill counts it); `reschedule` moves a waiting slot in
 * place (same row: its source and Trial Reels' slot approval stay). Placing
 * never approves: approval belongs to the content (D36), and the hub's
 * Approve is its own verb. Stories are moved through their own repository
 * (stories.sets is their source of truth); they use `planPlacement` only.
 *
 * Writes go to social_hub only (the hub scope rule); each type's wiring
 * (lib/publishing/actions) resolves its content to an item first.
 */
import { calendarDateKey, SOCIAL_TIMEZONE } from '@/lib/instagram/clock';
import { busyFeedTimes } from '@/lib/instagram/feed-spacing';
import {
  addCalendarDays,
  FEED_GAP_MINUTES,
  openWindowRange,
  spacedOffsets,
  uniformIndex,
  windowMinuteInstant,
  type PostingWindow,
} from '@/lib/instagram/window';
import { EXPLAINER_WINDOWS } from '@/lib/explainers/publish/config';
import { POSTING_SLOTS } from '@/lib/reels/publish/slots';
import { CAROUSEL_SLOTS } from '@/lib/social/overnight/config';
import { DEFAULT_LFD_DAYS, LFD_WINDOW } from '@/lib/lfd/config';
import { carouselOffDays, readLfdSettings } from '@/lib/lfd/settings';
import { AI_EVENTS_NIGHT_WINDOW, AI_EVENTS_WINDOW, DEFAULT_AI_EVENTS_DAYS } from '@/lib/ai-events/config';
import { readAiEventsSettings } from '@/lib/ai-events/settings';
import { bookSlotStatement, type SpineQuery, type SpineVertical } from '@/lib/social-hub/spine';
import { legacyFeedMode, slotPlan, slotsOn, type SlotPlan } from '@/lib/social-hub/slots';
import { driftMinute } from '@/lib/social-hub/slots/book';
import { readTemplate } from '@/lib/social-hub/slots/load';
import { OVERRIDE_INSERT, OVERRIDE_UPSERT, overrideFor, overrideKeyWhere, type OverrideOp } from '@/lib/social-hub/slots/override';
import { sortSlots } from '@/lib/social-hub/slots/resolve';
import { canPlace, isLocked, type DayCtx } from '@/lib/social-hub/slots/rules';
import { clockLabel, DEFAULT_FEED_MODE, DRIFT, isFeedSlot, nyMinuteOf, SERIES_NAME } from '@/lib/social-hub/slots/times';
import { asSlotId } from '@/lib/social-hub/slots/legacy';
import { isReelType, isStorySeries, parseSlotId, slotId, type FeedMode, type ResolvedSlot, type SlotQuery, type StorySeries } from '@/lib/social-hub/slots/types';
import { isDayKey } from '@/lib/social-hub/time';
import { SERIES_LABEL } from '@/lib/stories/render/copy';

/** A posting window as the picker shows it; `days` (0 = Sunday) when it doesn't run every day. */
export type SlotWindow = PostingWindow & { name: string; days?: readonly number[] };

export type PlacementRules = {
  vertical: SpineVertical;
  /** The windows a day offers this type, in day order. */
  windows: readonly SlotWindow[];
  /** Feed posts keep FEED_GAP_MINUTES apart (SH-47); Trial Reels and Stories don't (D33). */
  spaced: boolean;
};

export type Placement = { nyDate: string; slot: string };

export type PlacementOutcome =
  | { ok: true; note: string; scheduleId: string | null; publishAt: string }
  | { ok: false; note: string };

const TYPE_NAME: Record<SpineVertical, string> = {
  carousels: 'Carousels',
  explainers: 'Explainers',
  reels: 'Text on Screen',
  stories: 'Stories',
  last_few_days: 'Last Few Days posts',
  ai_events: 'AI Events posts',
};

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** How far ahead a day can be picked: the schedulers' horizon (and the reach of busyFeedTimes). */
export const PLACEMENT_DAYS_AHEAD = 13;

const ACTIVE = `('scheduled', 'publishing', 'published')`;
const IN_FLIGHT = `('requested', 'creating', 'processing', 'publishing')`;

const isUniqueViolation = (error: unknown) => (error as { code?: string } | null)?.code === '23505';

const named = (windows: ReadonlyArray<PostingWindow>, names: Record<string, string>): SlotWindow[] =>
  windows.map((w) => ({ id: w.id, label: w.label, startMinute: w.startMinute, endMinute: w.endMinute, name: names[w.id] ?? w.id }));

/**
 * Stories' default window per series (lib/stories/settings.ts DEFAULT_SETTINGS,
 * copied: that module also writes stories.settings, which hub code may not
 * reach). tests/social-hub-placement.test.ts pins the copy to the original;
 * a stories.settings `series` row overrides it, as in loadSettings.
 */
export const STORY_WINDOW_DEFAULTS: Record<keyof typeof SERIES_LABEL, { start: string; end: string; days: number[] }> = {
  morning_download: { start: '08:30', end: '10:00', days: [0, 1, 2, 3, 4, 5, 6] },
  guess_the_number: { start: '08:30', end: '10:00', days: [1, 4] },
  free_vs_paid: { start: '08:30', end: '10:00', days: [2, 6] },
};

const minuteOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};

async function storyWindows(query: SpineQuery): Promise<SlotWindow[]> {
  let override: Record<string, { window?: Partial<{ start: string; end: string; days: number[] }> }> = {};
  try {
    const { rows } = await query(`SELECT value FROM stories.settings WHERE key = 'series'`);
    if (rows[0]?.value && typeof rows[0].value === 'object') override = rows[0].value;
  } catch {
    // No stories schema on this handle: the defaults stand.
  }
  return (Object.keys(STORY_WINDOW_DEFAULTS) as Array<keyof typeof STORY_WINDOW_DEFAULTS>).map((series) => {
    const w = { ...STORY_WINDOW_DEFAULTS[series], ...(override[series]?.window ?? {}) };
    const startMinute = minuteOf(w.start);
    const endMinute = minuteOf(w.end);
    return { id: series, name: SERIES_LABEL[series], label: `${clockLabel(startMinute)}–${clockLabel(endMinute)}`, startMinute, endMinute, days: w.days };
  });
}

/**
 * Each type's windows, from its own config. Their `days` are the legacy rule:
 * planPlacement and openSlots ignore them on a day whose calendar slots load
 * (the slots decide), and fall back to them when that read fails.
 */
export async function placementRules(query: SpineQuery, vertical: SpineVertical): Promise<PlacementRules> {
  switch (vertical) {
    case 'carousels': {
      // LFD-02: while Last Few Days' auto_run is on, its days have no carousel windows.
      const off = await carouselOffDays(query);
      const windows = named(CAROUSEL_SLOTS, { morning: 'Morning', afternoon: 'Afternoon' });
      return { vertical, spaced: true, windows: off.length ? windows.map((w) => ({ ...w, days: EVERY_DAY.filter((d) => !off.includes(d)) })) : windows };
    }
    case 'last_few_days': {
      // One 9:00–10:00 AM window on its days (spec §7.4); a feed post, so spaced.
      const days = await readLfdSettings(query).then((s) => s.days).catch(() => [...DEFAULT_LFD_DAYS]);
      return { vertical, spaced: true, windows: [{ ...LFD_WINDOW, name: 'Morning', days }] };
    }
    case 'ai_events': {
      // Miami 6:00–7:00 PM and Boston 7:00–8:00 PM on its days (Sunday, AE-29); feed posts, so spaced.
      const days = await readAiEventsSettings(query).then((s) => s.days).catch(() => [...DEFAULT_AI_EVENTS_DAYS]);
      return {
        vertical,
        spaced: true,
        windows: [
          { ...AI_EVENTS_WINDOW, name: 'Evening', days },
          { ...AI_EVENTS_NIGHT_WINDOW, name: 'Night', days },
        ],
      };
    }
    case 'explainers':
      return { vertical, spaced: true, windows: named(EXPLAINER_WINDOWS, { afternoon: 'Afternoon', late: 'Late afternoon' }) };
    case 'reels':
      return { vertical, spaced: false, windows: named(POSTING_SLOTS, { morning: 'Morning', midday: 'Midday', evening: 'Evening' }) };
    case 'stories':
      return { vertical, spaced: false, windows: await storyWindows(query) };
  }
}

/** "Thu Oct 9, 9:23 AM" in New York time. */
export function formatPlacement(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SOCIAL_TIMEZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('weekday')} ${part('month')} ${part('day')}, ${part('hour')}:${part('minute')} ${part('dayPeriod')}`;
}

const weekdayOf = (nyDate: string) => new Date(`${nyDate}T12:00:00Z`).getUTCDay();

function windowList(rules: PlacementRules): string {
  const each = rules.windows.map((w) => `${w.id} (${w.name}, ${w.label})`);
  return each.length > 1 ? `${each.slice(0, -1).join(', ')} or ${each.at(-1)}` : each[0] ?? 'none';
}

/**
 * `feedMode`: the calendar slot's Trial / Main for a reel type in template
 * mode; null while legacy (and for other types), so bookings keep the old SQL.
 * `calendar`: planned on the calendar's free times (template mode); the
 * booking then moves with rebookSlot. `slotOps`: the calendar overrides the
 * booking writes with it, in one statement (a new slot at that time, and on
 * a move the post's old slot leaving its date); empty when it takes a slot
 * the calendar already has.
 */
export type Planned =
  | { ok: true; nyDate: string; slot: string; publishAt: Date; window: SlotWindow; feedMode: FeedMode | null; calendar?: boolean; slotOps?: OverrideOp[] }
  | { ok: false; note: string };

/** The booking being moved: its row and minute, and where it sits now (nyDate, slot id) when known. */
export type Moving = { scheduleId: string; publishAt: Date; nyDate?: string; slot?: string };

/** The day's calendar slots, or null while legacy. A failed read falls back to legacy. */
const daySlotPlan = (query: SpineQuery, nyDate: string): Promise<SlotPlan | null> =>
  slotPlan(query as SlotQuery, nyDate, 1).catch(() => null);

/**
 * The minute this content would post at in (nyDate, slot), or why it can't go
 * there. Reads only. `moving` is the slot being moved: it is not "taken" by
 * itself, and its own time doesn't count against the spacing. With its date
 * and slot id (rescheduleItem), a move to a new time takes its slot along.
 */
export async function planPlacement(
  query: SpineQuery,
  input: Placement & {
    vertical: SpineVertical;
    now?: Date;
    rng?: (count: number) => number;
    rules?: PlacementRules;
    moving?: Moving | null;
  },
): Promise<Planned> {
  const now = input.now ?? new Date();
  if (!isDayKey(input.nyDate)) return { ok: false, note: 'Pick a day as YYYY-MM-DD.' };
  const rules = input.rules ?? (await placementRules(query, input.vertical));
  const calendar = await daySlotPlan(query, input.nyDate);
  if (calendar) return planOnCalendar(query, calendar, rules, input, now);
  const window = rules.windows.find((w) => w.id === input.slot);
  if (!window) return { ok: false, note: `${TYPE_NAME[input.vertical]} have no “${input.slot}” slot. Pick ${windowList(rules)}.` };

  const today = calendarDateKey(now, SOCIAL_TIMEZONE);
  if (input.nyDate < today) return { ok: false, note: 'That day has passed.' };
  if (input.nyDate > addCalendarDays(today, PLACEMENT_DAYS_AHEAD)) return { ok: false, note: 'Pick a day in the next two weeks.' };
  if (window.days && !window.days.includes(weekdayOf(input.nyDate))) {
    return { ok: false, note: `${window.name} doesn’t post on ${WEEKDAY[weekdayOf(input.nyDate)]}s (it posts ${window.days.map((d) => WEEKDAY_SHORT[d]).join(', ')}).` };
  }
  const open = openWindowRange(window, input.nyDate, now);
  if (!open) return { ok: false, note: `Today’s ${window.name.toLowerCase()} window (${window.label}) is over.` };

  const { rows: taken } = await query(
    `SELECT id FROM social_hub.schedule
      WHERE vertical = $1 AND ny_date = $2::date AND slot = $3 AND status IN ${ACTIVE}
        AND id IS DISTINCT FROM $4::uuid
      LIMIT 1`,
    [input.vertical, input.nyDate, input.slot, input.moving?.scheduleId ?? null],
  );
  if (taken[0]) return { ok: false, note: 'That slot is taken.' };

  let busy: Date[] = [];
  if (rules.spaced) {
    busy = await busyFeedTimes(query, now);
    // The slot being moved doesn't space against itself.
    const own = input.moving ? busy.findIndex((b) => b.getTime() === input.moving!.publishAt.getTime()) : -1;
    if (own >= 0) busy.splice(own, 1);
  }
  const offsets = spacedOffsets((o) => windowMinuteInstant(window, input.nyDate, o), open.startOffset, open.count, busy);
  if (offsets.length === 0) {
    return { ok: false, note: `Every minute left in that window is within ${FEED_GAP_MINUTES} minutes of another feed post.` };
  }
  const drawn = (input.rng ?? uniformIndex)(offsets.length);
  if (!Number.isInteger(drawn) || drawn < 0 || drawn >= offsets.length) {
    throw new Error(`Slot draw returned ${drawn} for ${offsets.length} open minutes.`);
  }
  return { ok: true, nyDate: input.nyDate, slot: input.slot, publishAt: windowMinuteInstant(window, input.nyDate, offsets[drawn]!), window, feedMode: null };
}

// ── Template mode: the calendar's free times ──

/** "8:45–9:00 AM", "11:45 AM–12:00 PM". */
function minuteRange(start: number, end: number): string {
  const [a, b] = [clockLabel(start), clockLabel(end)];
  const same = (start < 720) === (end < 720);
  return same ? `${a.replace(/ (AM|PM)$/, '')}–${b}` : `${a}–${b}`;
}

/** A calendar slot as the picker shows it: its drift window [slot, slot + DRIFT]. */
function slotWindow(s: ResolvedSlot): SlotWindow {
  const endMinute = s.startMinute + DRIFT;
  const id = slotId(s.startMinute, s.series);
  return { id, label: minuteRange(s.startMinute, endMinute), startMinute: s.startMinute, endMinute, name: s.series ? SERIES_NAME[s.series].one : clockLabel(s.startMinute) };
}

const driftOpen = (s: ResolvedSlot, nyDate: string, now: Date) => openWindowRange(slotWindow(s), nyDate, now) !== null;



/** The free-time slot ids of the type's bookings on a date (waiting, posting, posted), but `except`. */
async function heldSlots(query: SpineQuery, rules: PlacementRules, nyDate: string, except: string | null): Promise<Map<string, { id: string; publish_at: string }>> {
  const { rows } = await query(
    `SELECT id, slot, publish_at FROM social_hub.schedule
      WHERE vertical = $1 AND ny_date = $2::date AND status IN ${ACTIVE} AND id IS DISTINCT FROM $3::uuid`,
    [rules.vertical, nyDate, except],
  );
  const out = new Map<string, { id: string; publish_at: string }>();
  for (const r of rows) {
    const id = asSlotId(rules.vertical, String(r.slot));
    if (id && !out.has(id)) out.set(id, { id: r.id as string, publish_at: r.publish_at as string });
  }
  return out;
}

/** What `slot` asks for: a start minute (and Stories' series). A bare series takes its first free slot that day. */
function askedKey(rules: PlacementRules, slot: string, mine: readonly ResolvedSlot[], free: (s: ResolvedSlot) => boolean): { startMinute: number; series: StorySeries | null } | null {
  const parsed = parseSlotId(slot);
  if (parsed) return (parsed.series !== null) === (rules.vertical === 'stories') ? parsed : null;
  if (rules.vertical === 'stories') {
    if (!isStorySeries(slot)) return null;
    const of = mine.filter((s) => s.series === slot);
    const pick = of.find(free) ?? of[0];
    if (pick) return { startMinute: pick.startMinute, series: slot };
  }
  const w = rules.windows.find((x) => x.id === slot);
  return w ? { startMinute: w.startMinute, series: rules.vertical === 'stories' && isStorySeries(slot) ? slot : null } : null;
}

async function planOnCalendar(
  query: SpineQuery,
  plan: SlotPlan,
  rules: PlacementRules,
  input: Placement & { vertical: SpineVertical; rng?: (count: number) => number; moving?: Moving | null },
  now: Date,
): Promise<Planned> {
  const vertical = input.vertical;
  const today = calendarDateKey(now, SOCIAL_TIMEZONE);
  if (input.nyDate < today) return { ok: false, note: 'That day has passed.' };
  if (input.nyDate > addCalendarDays(today, PLACEMENT_DAYS_AHEAD)) return { ok: false, note: 'Pick a day in the next two weeks.' };
  const day = sortSlots([...(plan.byDate.get(input.nyDate) ?? [])]);
  const mine = day.filter((s) => s.vertical === vertical);
  const held = await heldSlots(query, rules, input.nyDate, input.moving?.scheduleId ?? null);
  const free = (s: ResolvedSlot) => !held.has(slotId(s.startMinute, s.series)) && driftOpen(s, input.nyDate, now);
  const key = askedKey(rules, input.slot, mine, free);
  if (!key) return { ok: false, note: `${TYPE_NAME[vertical]} have no “${input.slot}” slot. Pick a time on the calendar.` };

  const existing = mine.find((s) => s.startMinute === key.startMinute && s.series === key.series);
  let slot: ResolvedSlot;
  const slotOps: OverrideOp[] = [];
  if (existing && free(existing)) {
    slot = existing;
  } else if (vertical === 'stories') {
    // A Story set's time lives in stories.sets: it takes one of the day's Stories slots, never a new one.
    if (existing) return { ok: false, note: held.has(slotId(existing.startMinute, existing.series)) ? 'That slot is taken.' : `Today’s ${clockLabel(existing.startMinute)} slot is over.` };
    return { ok: false, note: `${clockLabel(key.startMinute)} isn’t a ${key.series ? SERIES_NAME[key.series].one : 'Stories'} slot on ${WEEKDAY[weekdayOf(input.nyDate)]}, ${input.nyDate}. Add it on the calendar first.` };
  } else {
    const template = await readTemplate(query as SlotQuery);
    const baseOf = (nyDate: string, k: { startMinute: number }) =>
      template.find((r) => r.weekday === weekdayOf(nyDate) && r.vertical === vertical && r.startMinute === k.startMinute && r.series === null);
    // A move takes its slot along: the slot it leaves (on its own date, not started, held by nobody else).
    const source = await movingSlot(query, rules, input.moving ?? null, input.nyDate, day, today, now);
    const ctx: DayCtx = { nyDate: input.nyDate, weekday: weekdayOf(input.nyDate), slots: day, today, nowMinute: nyMinuteOf(now) };
    const r = canPlace(ctx, { vertical, startMinute: key.startMinute, series: null, ...(source && source.nyDate === input.nyDate ? { ignore: source.slot } : {}) });
    if (!r.ok) return { ok: false, note: r.reason };
    const feedMode = isReelType(vertical) ? (source?.slot.feedMode ?? baseOf(input.nyDate, { startMinute: r.minute })?.feedMode ?? DEFAULT_FEED_MODE[vertical]) : null;
    slot = { vertical, startMinute: r.minute, series: null, feedMode, origin: 'override' };
    // A booking kept at that time after its slot left the calendar still holds it.
    if (held.has(slotId(slot.startMinute, null))) return { ok: false, note: 'That slot is taken.' };
    slotOps.push(overrideFor(input.nyDate, slot, baseOf(input.nyDate, slot), { feedMode }));
    if (source) slotOps.push(overrideFor(source.nyDate, source.slot, baseOf(source.nyDate, source.slot), null));
  }

  let busy: Date[] = [];
  if (isFeedSlot(slot)) {
    busy = await busyFeedTimes(query, now);
    // The slot being moved doesn't space against itself.
    const own = input.moving ? busy.findIndex((b) => b.getTime() === input.moving!.publishAt.getTime()) : -1;
    if (own >= 0) busy.splice(own, 1);
  }
  const publishAt = driftMinute(input.nyDate, slot, now, busy, input.rng ?? uniformIndex);
  if (!publishAt) return { ok: false, note: `Every minute left after ${clockLabel(slot.startMinute)} is within ${FEED_GAP_MINUTES} minutes of another feed post.` };
  const mode = isReelType(vertical) ? (slot.feedMode ?? legacyFeedMode(vertical)) : null;
  return { ok: true, nyDate: input.nyDate, slot: slotId(slot.startMinute, slot.series), publishAt, window: slotWindow(slot), feedMode: mode, calendar: true, slotOps };
}

/**
 * The calendar slot a moved booking leaves, or null: its slot id read on its
 * date, a slot the calendar has there that hasn't started and no other
 * booking holds. Pre-calendar window ids read as their window's start.
 */
async function movingSlot(
  query: SpineQuery,
  rules: PlacementRules,
  moving: Moving | null,
  nyDate: string,
  day: readonly ResolvedSlot[],
  today: string,
  now: Date,
): Promise<{ nyDate: string; slot: ResolvedSlot } | null> {
  if (!moving?.nyDate || !moving.slot || moving.nyDate < today) return null;
  const id = asSlotId(rules.vertical, moving.slot);
  const key = id ? parseSlotId(id) : null;
  if (!key) return null;
  const slots = moving.nyDate === nyDate ? day : ((await daySlotPlan(query, moving.nyDate))?.byDate.get(moving.nyDate) ?? []);
  const slot = slots.find((s) => s.vertical === rules.vertical && s.startMinute === key.startMinute && s.series === key.series);
  if (!slot) return null;
  if (isLocked({ nyDate: moving.nyDate, weekday: weekdayOf(moving.nyDate), slots: [...slots], today, nowMinute: nyMinuteOf(now) }, slot)) return null;
  const others = await heldSlots(query, rules, moving.nyDate, moving.scheduleId);
  return others.has(slotId(slot.startMinute, slot.series)) ? null : { nyDate: moving.nyDate, slot };
}

/**
 * Run a booking's write (`main`, RETURNING id, publish_at) and its calendar
 * overrides as ONE statement (R16), so neither lands without the other: a
 * failed override rolls the booking back, and a booking that wrote no row
 * (it started posting) writes no override. Callers hand a bare query, not a
 * transaction, so this is the atomic unit. Overrides use write.ts's SQL.
 */
async function withSlotOps(query: SpineQuery | SlotQuery, main: { text: string; params: unknown[] }, ops: readonly OverrideOp[], by: string): Promise<any[]> {
  const run = query as SlotQuery;
  if (!ops.length) return (await run(main.text, main.params)).rows;
  const params = [...main.params];
  const parts = [`main AS (${main.text})`];
  ops.forEach((o, i) => {
    const n = params.length + 1;
    if (o.op === 'upsert') {
      params.push(o.nyDate, o.vertical, o.startMinute, o.series, o.action, o.feedMode, by);
      parts.push(`o${i} AS (${OVERRIDE_INSERT} SELECT $${n}::date, $${n + 1}::text, $${n + 2}::smallint, $${n + 3}::text, $${n + 4}::text, $${n + 5}::text, $${n + 6}::text, now() FROM main ${OVERRIDE_UPSERT} RETURNING 1)`);
    } else {
      params.push(o.nyDate, o.vertical, o.startMinute, o.series);
      parts.push(`o${i} AS (DELETE FROM social_hub.slot_override WHERE EXISTS (SELECT 1 FROM main) AND ${overrideKeyWhere(n)} RETURNING 1)`);
    }
  });
  return (await run(`WITH ${parts.join(',\n')}\nSELECT id, publish_at FROM main`, params)).rows;
}

export type Rebooked = { ok: true; id: string; publishAt: string } | { ok: false; why: 'taken' | 'started' };

/**
 * Move a waiting booking to another free-time slot: the one booking-move
 * UPDATE (rescheduleItem in template mode, and the calendar's slot moves in
 * slots/write.ts). The row stays (source, approval); a reel slot's Trial /
 * Main moves with it, other types keep theirs. `taken`: another booking holds
 * that slot (the unique index); `started`: it began posting first. `ops`:
 * calendar overrides written in the same statement (withSlotOps).
 */
export async function rebookSlot(
  query: SpineQuery | SlotQuery,
  b: { scheduleId: string; nyDate: string; slot: string; publishAt: Date; feedMode: FeedMode | null },
  opts: { ops?: readonly OverrideOp[]; by?: string } = {},
): Promise<Rebooked> {
  try {
    const rows = await withSlotOps(
      query,
      {
        text: `UPDATE social_hub.schedule SET ny_date = $2::date, slot = $3, publish_at = $4::timestamptz, error = NULL, feed_mode = coalesce($5, feed_mode)
        WHERE id = $1::uuid AND status = 'scheduled'
        RETURNING id, publish_at`,
        params: [b.scheduleId, b.nyDate, b.slot, b.publishAt.toISOString(), b.feedMode],
      },
      opts.ops ?? [],
      opts.by ?? 'placement',
    );
    if (!rows[0]) return { ok: false, why: 'started' };
    return { ok: true, id: String(rows[0].id), publishAt: new Date(rows[0].publish_at).toISOString() };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, why: 'taken' };
    throw error;
  }
}

/** What a placement acts on: the item, and for Trial Reels the idea that owns the slot. */
export type PlacementTarget = { vertical: SpineVertical; itemId: string | null; ideaRef?: string | null };

/** The content's waiting or posting slot, if any. A Trial Reels slot is found by its idea. */
export async function activeSlot(
  query: SpineQuery,
  target: PlacementTarget,
): Promise<{ id: string; status: 'scheduled' | 'publishing'; publishAt: Date; nyDate: string; slot: string } | null> {
  const { rows } = await query(
    `SELECT id, status, publish_at, ny_date::text AS ny_date, slot FROM social_hub.schedule
      WHERE status IN ('scheduled', 'publishing')
        AND (content_item_id = $1::uuid OR ($2::text = 'reels' AND vertical = 'reels' AND idea_ref = $3::text))
      ORDER BY created_at DESC
      LIMIT 1`,
    [target.itemId, target.vertical, target.ideaRef ?? null],
  );
  const row = rows[0];
  return row ? { id: row.id, status: row.status, publishAt: new Date(row.publish_at), nyDate: row.ny_date, slot: row.slot } : null;
}

/** The waiting or posting slot of the content a type knows by its own id (Stories: the set id). */
export async function activeSlotByRef(
  query: SpineQuery,
  vertical: SpineVertical,
  nativeRef: string,
): Promise<{ id: string; status: 'scheduled' | 'publishing'; publishAt: Date } | null> {
  const { rows } = await query(
    `SELECT s.id, s.status, s.publish_at FROM social_hub.schedule s
       JOIN social_hub.content_items ci ON ci.id = s.content_item_id
      WHERE ci.vertical = $1 AND ci.native_ref = $2 AND s.status IN ('scheduled', 'publishing')
      ORDER BY s.created_at DESC
      LIMIT 1`,
    [vertical, nativeRef],
  );
  const row = rows[0];
  return row ? { id: row.id, status: row.status, publishAt: new Date(row.publish_at) } : null;
}

/**
 * Why this content can't go on the calendar, or null: rejected (it never
 * posts), a try in flight, or already posted. A Trial Reels idea counts
 * every video made for it.
 */
export async function itemRefusal(query: SpineQuery, target: PlacementTarget): Promise<string | null> {
  if (target.itemId) {
    const { rows } = await query(`SELECT decision FROM social_hub.approvals WHERE content_item_id = $1::uuid`, [target.itemId]);
    if (rows[0]?.decision === 'rejected') return 'It was rejected, so it can’t be scheduled.';
  }
  const { rows } = await query(
    `SELECT pa.status FROM social_hub.publish_attempts pa
      WHERE (pa.content_item_id = $1::uuid
             OR ($2::text = 'reels' AND pa.content_item_id IN (
                   SELECT id FROM social_hub.content_items WHERE vertical = 'reels' AND idea_ref = $3::text)))
        AND (pa.status IN ${IN_FLIGHT} OR (pa.status = 'published' AND pa.trigger <> 'mix_test'))
      ORDER BY pa.status = 'published'
      LIMIT 1`,
    [target.itemId, target.vertical, target.ideaRef ?? null],
  );
  if (!rows[0]) return null;
  return rows[0].status === 'published' ? 'It has already posted.' : 'It is posting right now. Wait for that try to finish.';
}

/**
 * AI Events: a post lists one week's events (the Monday after its Sunday, ai_events.posts.ny_date,
 * through the Sunday after), so it never goes out after its own Sunday: by then its week has
 * started. The engine books only its own Sunday too (lib/ai-events/schedule.ts throughDate).
 * Null when the date is fine or the post can't be read (the other checks still stand).
 */
export async function aiEventsDateRefusal(query: SpineQuery, target: PlacementTarget, nyDate: string): Promise<string | null> {
  if (target.vertical !== 'ai_events' || !target.itemId) return null;
  const { rows } = await query(
    `SELECT p.ny_date::text AS ny_date FROM social_hub.content_items ci JOIN ai_events.posts p ON p.id::text = ci.native_ref
      WHERE ci.id = $1::uuid`,
    [target.itemId],
  ).catch(() => ({ rows: [] as any[] }));
  const own = rows[0]?.ny_date ? String(rows[0].ny_date).slice(0, 10) : null;
  if (!own || nyDate <= own) return null;
  return `This AI Events post is for the week after ${formatDay(own)}, so it can’t post after that day. Generate makes the post for a later week.`;
}

const formatDay = (nyDate: string) => new Date(`${nyDate}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

/** `by`: who placed it, recorded on a calendar slot the placement adds (template mode). */
type PlaceInput = PlacementTarget & Placement & { now?: Date; rng?: (count: number) => number; rules?: PlacementRules; by?: string };

/** Put content with no waiting slot into (nyDate, slot), as a person's slot (source 'user'). */
export async function placeItem(query: SpineQuery, input: PlaceInput): Promise<PlacementOutcome> {
  if (!input.itemId && !(input.vertical === 'reels' && input.ideaRef)) return { ok: false, note: 'The content is gone.' };
  const refusal = await itemRefusal(query, input);
  if (refusal) return { ok: false, note: refusal };
  const active = await activeSlot(query, input);
  if (active) {
    return active.status === 'publishing'
      ? { ok: false, note: 'It is posting right now. Wait for that try to finish.' }
      : { ok: false, note: `It already has a slot (${formatPlacement(active.publishAt)}). Move it instead.` };
  }
  const plan = await planPlacement(query, input);
  if (!plan.ok) return plan;
  const late = await aiEventsDateRefusal(query, input, plan.nyDate);
  if (late) return { ok: false, note: late };
  try {
    const statement = bookSlotStatement({
      vertical: input.vertical,
      itemId: input.itemId,
      ideaRef: input.vertical === 'reels' ? input.ideaRef : null,
      nyDate: plan.nyDate,
      slot: plan.slot,
      publishAt: plan.publishAt,
      source: 'user',
      // Template mode only (R3): legacy books with the old INSERT.
      ...(plan.feedMode ? { feedMode: plan.feedMode } : {}),
    });
    // The booking and a new slot at its time land together (R16).
    const [booked] = await withSlotOps(query, statement, plan.slotOps ?? [], input.by ?? 'placement');
    return { ok: true, note: `Scheduled for ${formatPlacement(plan.publishAt)}.`, scheduleId: booked.id as string, publishAt: new Date(booked.publish_at).toISOString() };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, note: 'That slot is taken.' };
    throw error;
  }
}

/** Move content's waiting slot to (nyDate, slot). The row stays the same: source and slot approval are kept. */
export async function rescheduleItem(query: SpineQuery, input: PlaceInput): Promise<PlacementOutcome> {
  const active = await activeSlot(query, input);
  if (!active) return { ok: false, note: 'It isn’t scheduled, so there is nothing to move.' };
  if (active.status === 'publishing') return { ok: false, note: 'It is posting right now, so it can’t move.' };
  const refusal = await itemRefusal(query, input);
  if (refusal) return { ok: false, note: refusal };
  const plan = await planPlacement(query, { ...input, moving: { scheduleId: active.id, publishAt: active.publishAt, nyDate: active.nyDate, slot: active.slot } });
  if (!plan.ok) return plan;
  const late = await aiEventsDateRefusal(query, input, plan.nyDate);
  if (late) return { ok: false, note: late };
  if (plan.calendar) {
    // Template mode: the one booking-move UPDATE, with its slot moving along in the same statement (R16).
    const moved = await rebookSlot(query, { scheduleId: active.id, nyDate: plan.nyDate, slot: plan.slot, publishAt: plan.publishAt, feedMode: plan.feedMode }, { ops: plan.slotOps ?? [], by: input.by ?? 'placement' });
    if (!moved.ok) return { ok: false, note: moved.why === 'taken' ? 'That slot is taken.' : 'It started posting before it could move.' };
    return { ok: true, note: `Moved to ${formatPlacement(plan.publishAt)}.`, scheduleId: moved.id, publishAt: moved.publishAt };
  }
  try {
    const { rows } = await query(
      `UPDATE social_hub.schedule SET ny_date = $2::date, slot = $3, publish_at = $4::timestamptz, error = NULL
            WHERE id = $1 AND status = 'scheduled'
            RETURNING id, publish_at`,
      [active.id, plan.nyDate, plan.slot, plan.publishAt.toISOString()],
    );
    if (!rows[0]) return { ok: false, note: 'It started posting before it could move.' };
    return { ok: true, note: `Moved to ${formatPlacement(plan.publishAt)}.`, scheduleId: rows[0].id, publishAt: new Date(rows[0].publish_at).toISOString() };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, note: 'That slot is taken.' };
    throw error;
  }
}

export type OpenSlot = {
  slot: string;
  name: string;
  /** The window, e.g. "9:00–10:00 AM" (New York). */
  window: string;
  /** free: a person can place content here. taken: one item already holds it. over: the window has passed.
   *  off: the window doesn't run that weekday (never with the calendar: it lists only that day's slot times). crowded: every minute left is within the feed gap of another post. */
  state: 'free' | 'taken' | 'over' | 'off' | 'crowded';
  free: boolean;
  /** The slot holding it, when taken. */
  scheduleId: string | null;
  publishAt: string | null;
};

/**
 * A type's slots on one day for the "Schedule here" picker, each free or why
 * not. `moving` is the slot being moved: it shows as free. Reads only.
 */
export async function openSlots(
  query: SpineQuery,
  vertical: SpineVertical,
  nyDate: string,
  opts: { now?: Date; rules?: PlacementRules; moving?: string | null } = {},
): Promise<OpenSlot[]> {
  const now = opts.now ?? new Date();
  const rules = opts.rules ?? (await placementRules(query, vertical));
  if (!isDayKey(nyDate)) return [];
  const { rows } = await query(
    `SELECT id, slot, publish_at FROM social_hub.schedule
      WHERE vertical = $1 AND ny_date = $2::date AND status IN ${ACTIVE} AND id IS DISTINCT FROM $3::uuid`,
    [vertical, nyDate, opts.moving ?? null],
  );
  const holder = new Map(rows.map((r) => [r.slot as string, r]));
  let movingAt: number | null = null;
  if (opts.moving) {
    const own = (await query(`SELECT publish_at FROM social_hub.schedule WHERE id = $1::uuid`, [opts.moving])).rows[0];
    if (own) movingAt = new Date(own.publish_at).getTime();
  }
  const today = calendarDateKey(now, SOCIAL_TIMEZONE);
  const calendar = await daySlotPlan(query, nyDate);
  if (calendar) {
    // Template mode: the day's slot times for the type; a booking from before the calendar holds its window's start.
    const mine = sortSlots(slotsOn(calendar, vertical, nyDate));
    const held = new Map<string, Record<string, any>>();
    for (const r of rows) {
      const id = asSlotId(rules.vertical, String(r.slot));
      if (id && !held.has(id)) held.set(id, r);
    }
    const busy = mine.some(isFeedSlot) ? (await busyFeedTimes(query, now)).filter((b) => b.getTime() !== movingAt) : [];
    return mine.map((s): OpenSlot => {
      const w = slotWindow(s);
      const hold = held.get(w.id);
      const base = { slot: w.id, name: w.name, window: w.label, scheduleId: hold ? (hold.id as string) : null, publishAt: hold ? new Date(hold.publish_at).toISOString() : null };
      const state = ((): OpenSlot['state'] => {
        if (hold) return 'taken';
        if (nyDate < today || nyDate > addCalendarDays(today, PLACEMENT_DAYS_AHEAD) || !driftOpen(s, nyDate, now)) return 'over';
        return driftMinute(nyDate, s, now, isFeedSlot(s) ? busy : [], () => 0) ? 'free' : 'crowded';
      })();
      return { ...base, state, free: state === 'free' };
    });
  }
  const busy = rules.spaced ? (await busyFeedTimes(query, now)).filter((b) => b.getTime() !== movingAt) : [];
  return rules.windows.map((w): OpenSlot => {
    const held = holder.get(w.id);
    const base = { slot: w.id, name: w.name, window: w.label, scheduleId: held ? (held.id as string) : null, publishAt: held ? new Date(held.publish_at).toISOString() : null };
    const state = ((): OpenSlot['state'] => {
      if (held) return 'taken';
      if (nyDate < today || nyDate > addCalendarDays(today, PLACEMENT_DAYS_AHEAD)) return 'over';
      if (w.days && !w.days.includes(weekdayOf(nyDate))) return 'off';
      const open = openWindowRange(w, nyDate, now);
      if (!open) return 'over';
      return spacedOffsets((o) => windowMinuteInstant(w, nyDate, o), open.startOffset, open.count, busy).length ? 'free' : 'crowded';
    })();
    return { ...base, state, free: state === 'free' };
  });
}
