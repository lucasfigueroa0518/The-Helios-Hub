/**
 * Placing content on the calendar from the hub (Schedule here / move, D50).
 * Every type's own rules, checked in one place, against the lifecycle spine:
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
import { bookSlot, type SpineQuery, type SpineVertical } from '@/lib/social-hub/spine';
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
};

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** How far ahead a day can be picked: the schedulers' horizon (and the reach of busyFeedTimes). */
export const PLACEMENT_DAYS_AHEAD = 13;

const ACTIVE = `('scheduled', 'publishing', 'published')`;
const IN_FLIGHT = `('requested', 'creating', 'processing', 'publishing')`;

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

function clockLabel(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

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

/** Each type's windows, from its own config. */
export async function placementRules(query: SpineQuery, vertical: SpineVertical): Promise<PlacementRules> {
  switch (vertical) {
    case 'carousels':
      return { vertical, spaced: true, windows: named(CAROUSEL_SLOTS, { morning: 'Morning', afternoon: 'Afternoon' }) };
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

export type Planned = { ok: true; nyDate: string; slot: string; publishAt: Date; window: SlotWindow } | { ok: false; note: string };

/**
 * The minute this content would post at in (nyDate, slot), or why it can't go
 * there. Reads only. `moving` is the slot being moved: it is not "taken" by
 * itself, and its own time doesn't count against the spacing.
 */
export async function planPlacement(
  query: SpineQuery,
  input: Placement & {
    vertical: SpineVertical;
    now?: Date;
    rng?: (count: number) => number;
    rules?: PlacementRules;
    moving?: { scheduleId: string; publishAt: Date } | null;
  },
): Promise<Planned> {
  const now = input.now ?? new Date();
  if (!isDayKey(input.nyDate)) return { ok: false, note: 'Pick a day as YYYY-MM-DD.' };
  const rules = input.rules ?? (await placementRules(query, input.vertical));
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
  return { ok: true, nyDate: input.nyDate, slot: input.slot, publishAt: windowMinuteInstant(window, input.nyDate, offsets[drawn]!), window };
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

const isUniqueViolation = (error: unknown) => (error as { code?: string } | null)?.code === '23505';

type PlaceInput = PlacementTarget & Placement & { now?: Date; rng?: (count: number) => number; rules?: PlacementRules };

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
  try {
    const booked = await bookSlot(query, {
      vertical: input.vertical,
      itemId: input.itemId,
      ideaRef: input.vertical === 'reels' ? input.ideaRef : null,
      nyDate: plan.nyDate,
      slot: plan.slot,
      publishAt: plan.publishAt,
      source: 'user',
    });
    return { ok: true, note: `Scheduled for ${formatPlacement(plan.publishAt)}.`, scheduleId: booked.id, publishAt: booked.publishAt };
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
  const plan = await planPlacement(query, { ...input, moving: { scheduleId: active.id, publishAt: active.publishAt } });
  if (!plan.ok) return plan;
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
   *  off: the window doesn't run that weekday. crowded: every minute left is within the feed gap of another post. */
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
  const busy = rules.spaced ? (await busyFeedTimes(query, now)).filter((b) => b.getTime() !== movingAt) : [];
  const today = calendarDateKey(now, SOCIAL_TIMEZONE);
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
