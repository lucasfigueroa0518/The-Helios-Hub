import { explainersDb } from '@/lib/explainers/connection';
import { saveSetting as saveExplainersSetting } from '@/lib/explainers/settings';
import { getSetting as getReelsSetting, setSetting as setReelsSetting } from '@/lib/reels/music/store';
import { PASSING_REELS_PER_NIGHT } from '@/lib/reels/config';
import { getSocialSetting, setSocialSetting } from '@/lib/social/overnight/settings';
import * as carouselCfg from '@/lib/social/overnight/config';
import { EXPLAINER_WINDOWS, DEFAULT_POSTS_PER_DAY as EXPLAINER_DEFAULT_PER_DAY } from '@/lib/explainers/publish/config';
import { liveStoriesDb } from '@/lib/stories/db';
import { loadSettings as loadStories, saveSeriesSetting, saveTypeSetting, typeSettings } from '@/lib/stories/settings';
import type { Series } from '@/lib/stories/render/types';
import { isStoryVertical, SERIES_OF_VERTICAL } from '@/lib/social-hub/story-types';
import { PLAN } from '@/lib/social-hub/views/plan';
import { dbQuery } from '@/lib/db';
import { readLfdSettings } from '@/lib/lfd/settings';
import { readAiEventsSettings } from '@/lib/ai-events/settings';
import { readFieldNotesSettings } from '@/lib/field-notes/settings';
import { slotPlan, slotsWithinCap, type SlotPlan } from '@/lib/social-hub/slots';
import { readCaps, readSlotSource } from '@/lib/social-hub/slots/load';
import type { ResolvedSlot, SlotQuery } from '@/lib/social-hub/slots/types';
import { writeCaps } from '@/lib/social-hub/slots/write';
import type { HubPost } from '@/lib/social-hub/types';
import { addDays, nyDateOf, weekdayOf } from '@/lib/social-hub/time';
import { MAX_CAP, maxCapFor } from '@/lib/content-type/caps';
import { DRAMA_WINDOWS, readDramaPosting, writeDramaPosting } from '@/lib/reel-ai-drama/hub';
import { isTypeState, keysOf, refillCapUsd, stateOf, type TypeState } from '@/lib/content-type/state';
import { scheduledAhead, unslotType, type UnslotQuery } from '@/lib/content-type/unslot';

/**
 * How each content type makes and posts (settings standard, planning/settings-standard/CONTRACT.md): one control
 * with three states, Paused | Approval | Live (D16; lib/content-type/state.ts). Every post needs a person's
 * approval: there is no Auto-publish, and require_approval is never written false or read as false.
 *
 * The state is stored in the two keys each type already has (D7, contract §3): its Generate key (auto_run /
 * auto_render / auto / the series' auto) and publishing_live, read with stateOf and written with keysOf through each
 * type's existing writer. A missing key is off (D6). Generate off with Live on reads as Paused, flagged
 * `stateMismatch`. Pausing also takes the type's scheduled posts out of their slots and back to the Made tab, still
 * approved (D17, D18; lib/content-type/unslot.ts).
 *
 * Each type also has a refill spend cap (D14): pool_refill_cap_usd in its settings table (the Stories-format
 * types: stories.settings types[<type>].refill_cap_usd), read with refillCapUsd for the default.
 *
 * The quota (`perDay`) is how many a day are made; it can't pass the type's posting windows. The days-based types
 * (Last Few Days, AI Events, Field Notes and the three Stories-format types) have no quota: they post on their days.
 * With the calendar (slot_source 'template') the calendar owns when: the quota can't be set here, `schedule` shows
 * this week's slots for the type instead, and perDay / days are read from those slots so older readers keep working.
 * The type's daily limit (`cap`, week board spec §Safety cap) is set here, a person's decision, never automatic.
 */
export type ContentType = 'reels' | 'carousels' | 'explainers' | 'stories' | 'ai_trivia' | 'real_or_ai' | 'last_few_days' | 'ai_events' | 'field_notes' | 'reel_ai_drama';

export const POSTING_TYPES: readonly ContentType[] = ['reels', 'carousels', 'explainers', 'stories', 'ai_trivia', 'real_or_ai', 'last_few_days', 'ai_events', 'field_notes', 'reel_ai_drama'];
export const isPostingType = (v: unknown): v is ContentType => POSTING_TYPES.includes(v as ContentType);

/** One day of a type's week on the calendar: its slot count, Trial / Main split (reel types), a Stories-format type's series, and whether a date override touched it. */
export type ScheduleDay = { nyDate: string; count: number; trial: number; main: number; series: string[]; override: boolean };

/** @deprecated Stories Split (SS-24): every type now reads `series: null`; kept so older readers still compile. */
export type SeriesState = { id: Series; label: string; enabled: boolean; generate: boolean; days: number[] };

export type PostingState = {
  type: ContentType;
  /** Paused | Approval | Live (D16). */
  state: TypeState;
  /** The stored Generate key is off while publishing_live is on: not a state, read as paused (contract §3). */
  stateMismatch: boolean;
  /** The spend cap of one pool refill, in USD (D14): stored, else the type's default. */
  refillCapUsd: number;
  /** The type's slots scheduled ahead: what Pause sends back to the Made tab (D17). */
  scheduledAhead: number;
  /** @deprecated read-only, derived from state; kept for health/scoreboard readers. */
  live: boolean;
  /** @deprecated read-only, derived from state. */
  generate: boolean | null;
  perDay: number | null;
  maxPerDay: number | null;
  /** Always null since the Stories split (SS-24): each Stories-format type reads like the other days-based types. */
  series: SeriesState[] | null;
  /** Last Few Days, AI Events and the Stories-format types: the weekdays it posts (0 = Sunday); Field Notes null. Absent for the other types. */
  days?: number[] | null;
  /** Template mode: this Monday–Sunday week's slots for the type. Null while legacy (the controls above decide). */
  schedule: ScheduleDay[] | null;
  /**
   * Template mode: the type's slots on each of the last NIGHT_DAYS dates
   * through today, so the health reports (the morning one and the 30-night
   * backfill) check each night against its own day. Null while legacy.
   */
  nights: ScheduleDay[] | null;
  /** Template mode: the daily limit, the most the overnight run makes a day. Null while legacy. */
  cap: number | null;
  /** What one more post a night costs: the average cost of the type's posts over the last COST_DAYS days; null when unknown. */
  costPerPostMicros: number | null;
};

/** The days costPerPost averages over. */
export const COST_DAYS = 14;


/** How many dates through today `nights` covers: every night the Health page can ask about (historyNights ≤ 31). */
export const NIGHT_DAYS = 31;

/** The most a refill cap can be set to, in USD: a guard against a typo, well above the D14 defaults. */
export const MAX_REFILL_CAP_USD = 5;

/** What a person can change. live / generate / autoPublish are no longer patchable: `state` replaces them (D16). */
export type PostingPatch = {
  /** Writes both stored keys (keysOf). 'paused' also unslots the type's scheduled posts (D17). */
  state?: TypeState;
  perDay?: number;
  /** The daily limit (template mode), a whole number from 0 to 10 (Last Few Days, Field Notes and the Stories-format types 0–1). */
  cap?: number;
  /** The refill spend cap in USD (D14), above zero and at most MAX_REFILL_CAP_USD. */
  refillCapUsd?: number;
};

/** A calendar slot that belongs to a type: a Stories-format type's slot by its series (SS-24), any other by its vertical. */
function slotOfType(s: ResolvedSlot, type: ContentType): boolean {
  if (!isStoryVertical(type)) return s.vertical === type;
  return isStoryVertical(s.vertical) && (s.series ?? SERIES_OF_VERTICAL[s.vertical]) === SERIES_OF_VERTICAL[type];
}

type Row = { query: (t: string, p?: unknown[]) => Promise<{ rows: any[] }> };
const rowOf = async (db: Row, table: string, key: string) => (await db.query(`SELECT value FROM ${table} WHERE key = $1`, [key])).rows[0]?.value;

const windows = (type: ContentType) => PLAN[type].length;

/** A stored count, or NaN when the row is missing (Number(null) would read as zero). */
const count = (raw: unknown) => (raw == null ? NaN : Number(raw));

async function exDb() {
  return explainersDb();
}

type TypeFields = Omit<PostingState, 'schedule' | 'nights' | 'cap' | 'costPerPostMicros'>;

/** What each type has stored, before it is read as a state: the raw Generate and Live keys and the refill cap. */
export type Stored = Omit<TypeFields, 'state' | 'stateMismatch' | 'refillCapUsd' | 'scheduledAhead' | 'live' | 'generate'> & {
  generate: unknown;
  live: unknown;
  refill: unknown;
};

/** The spine handle for a type's slots: Explainers and AI Drama book on the explainers handle, the rest on the app's. */
async function spineQuery(type: ContentType): Promise<UnslotQuery> {
  if (type === 'explainers' || type === 'reel_ai_drama') {
    const db = await exDb();
    return (text, params) => db.query(text, params) as Promise<{ rows: any[] }>;
  }
  return appQuery as UnslotQuery;
}

/** The stored keys read as the standard fields (D16, D14). A key that isn't a boolean reads as off (D6). */
export function fieldsOf(stored: Stored, scheduled: number): TypeFields {
  const { generate, live, refill, ...rest } = stored;
  const { state, mismatch } = stateOf(generate === true, live === true);
  return { ...rest, state, stateMismatch: mismatch, refillCapUsd: refillCapUsd(stored.type, refill), scheduledAhead: scheduled, live: state === 'live', generate: state !== 'paused' };
}

const appQuery: SlotQuery = (text, params) => dbQuery(text, params);

/** The dates from..to of a plan, as a plan of their own. */
function slice(plan: SlotPlan, from: string, to: string): SlotPlan {
  return { from, to, byDate: new Map([...plan.byDate].filter(([d]) => d >= from && d <= to)) };
}

/**
 * The calendar from NIGHT_DAYS back through this Monday–Sunday week (New
 * York), in one read, split into this week and the recent nights. Null while
 * legacy or when the slots can't be read. SELECT only.
 */
async function calendarPlan(now: Date): Promise<{ today: string; week: SlotPlan; nights: SlotPlan } | null> {
  const today = nyDateOf(now)!;
  const monday = addDays(today, -((weekdayOf(today) + 6) % 7));
  const sunday = addDays(monday, 6);
  const first = addDays(today, -(NIGHT_DAYS - 1));
  const plan = await slotPlan(appQuery, first, NIGHT_DAYS + (6 - ((weekdayOf(today) + 6) % 7))).catch(() => null);
  return plan ? { today, week: slice(plan, monday, sunday), nights: slice(plan, first, today) } : null;
}

/** A plan's calendar slots for a type, one entry per date. */
function weekSchedule(type: ContentType, plan: SlotPlan): ScheduleDay[] {
  return [...plan.byDate].map(([nyDate, all]) => {
    const slots = all.filter((s) => slotOfType(s, type));
    return {
      nyDate,
      count: slots.length,
      trial: slots.filter((s) => s.feedMode === 'trial').length,
      main: slots.filter((s) => s.feedMode === 'main').length,
      series: isStoryVertical(type) ? slots.map(() => SERIES_OF_VERTICAL[type]) : [],
      override: slots.some((s) => s.origin === 'override'),
    };
  });
}

/** The weekdays (0 = Sunday) of this week that have a slot matching `has`, in order. */
function weekdaysWith(plan: SlotPlan, has: (s: ResolvedSlot) => boolean): number[] {
  const days = [...plan.byDate].filter(([, slots]) => slots.some(has)).map(([nyDate]) => weekdayOf(nyDate));
  return [...new Set(days)].sort((a, b) => a - b);
}

/**
 * Template mode (spec §4): the cadence fields come from the calendar, so
 * every reader that still uses them sees the slots. perDay is today's slot
 * count under the daily limit (what the night makes); the days-based types'
 * days (Last Few Days, AI Events, Field Notes, the Stories-format types) are
 * this week's weekdays with their slot.
 */
function withCalendar(state: TypeFields, plan: SlotPlan, today: string, cap: number): TypeFields {
  const type = state.type;
  if (type === 'last_few_days' || type === 'ai_events' || type === 'field_notes' || isStoryVertical(type)) return { ...state, days: weekdaysWith(plan, (s) => slotOfType(s, type)) };
  return { ...state, perDay: slotsWithinCap(plan, type, today, cap).made.length };
}

/**
 * The average cost of one of the type's posts made in the last COST_DAYS
 * days (the day it was made; its posting day only when that is unknown),
 * each content item once (posts sharing an item share its cost). Null with
 * none. Pure.
 */
export function costPerPost(posts: readonly HubPost[], type: ContentType, now: Date): number | null {
  const today = nyDateOf(now)!;
  const from = addDays(today, -(COST_DAYS - 1));
  const seen = new Map<string, number>();
  for (const p of posts) {
    if (p.vertical !== type || p.costMicros == null) continue;
    const day = nyDateOf(p.generatedAt) ?? p.nyDate;
    if (!day || day < from || day > today) continue;
    seen.set(p.costItemKey ?? p.id, p.costMicros);
  }
  if (!seen.size) return null;
  return Math.round([...seen.values()].reduce((a, b) => a + b, 0) / seen.size);
}

/** costPerPostMicros is null here: the posting route works it out from the hub's posts (costPerPost). */
export async function readPosting(type: ContentType, now = new Date()): Promise<PostingState> {
  const [state, cal] = await Promise.all([readTypePosting(type), calendarPlan(now)]);
  if (!cal) return { ...state, schedule: null, nights: null, cap: null, costPerPostMicros: null };
  const cap = (await readCaps(appQuery))[type];
  return { ...withCalendar(state, cal.week, cal.today, cap), schedule: weekSchedule(type, cal.week), nights: weekSchedule(type, cal.nights), cap, costPerPostMicros: null };
}

async function readTypePosting(type: ContentType): Promise<TypeFields> {
  const [stored, ahead] = await Promise.all([readStored(type), spineQuery(type).then((q) => scheduledAhead(q, type))]);
  return fieldsOf(stored, ahead);
}

async function readStored(type: ContentType): Promise<Stored> {
  if (type === 'carousels') {
    const [generate, live, per, refill] = await Promise.all(['auto_run', 'publishing_live', 'posts_per_day', 'pool_refill_cap_usd'].map((k) => getSocialSetting<unknown>(k)));
    const per2 = count(per);
    return { type, generate, live, refill, perDay: Number.isInteger(per2) && per2 >= 0 ? per2 : carouselCfg.DEFAULT_POSTS_PER_DAY, maxPerDay: carouselCfg.CAROUSEL_SLOTS.length, series: null };
  }
  if (type === 'explainers') {
    const db = await exDb();
    const [generate, live, per, refill] = await Promise.all(['auto_render', 'publishing_live', 'posts_per_day', 'pool_refill_cap_usd'].map((k) => rowOf(db, 'explainers.settings', k)));
    const per2 = count(per);
    return { type, generate, live, refill, perDay: Number.isInteger(per2) && per2 >= 1 ? per2 : EXPLAINER_DEFAULT_PER_DAY, maxPerDay: EXPLAINER_WINDOWS.length, series: null };
  }
  if (type === 'reel_ai_drama') {
    // AI Drama Reels (lib/reel-ai-drama/hub.ts): Generate is `auto`, Live is publishing_live. Its refill cap is a
    // reel_ai_drama.settings row the drama settings don't model, so it is read here.
    const db = await exDb();
    const [p, refill] = await Promise.all([readDramaPosting(db), rowOf(db, 'reel_ai_drama.settings', 'pool_refill_cap_usd')]);
    return { type, generate: p.generate, live: p.live, refill, perDay: p.perDay, maxPerDay: p.maxPerDay, series: null };
  }
  if (type === 'reels') {
    // A missing auto_run is off (D6), no longer on: the migration writes Text on Screen's explicit row.
    const [generate, live, per, refill] = await Promise.all(['auto_run', 'publishing_live', 'posts_per_day', 'pool_refill_cap_usd'].map((k) => getReelsSetting<unknown>(k)));
    const per2 = count(per);
    return { type, generate, live, refill, perDay: Number.isInteger(per2) && per2 >= 0 ? per2 : PASSING_REELS_PER_NIGHT, maxPerDay: windows('reels'), series: null };
  }
  if (type === 'last_few_days') {
    const s = await readLfdSettings((text, params) => dbQuery(text, params));
    // One post on each of its days (spec §7.4): no per-day quota to set.
    return { type, generate: s.autoRun, live: s.publishingLive, refill: s.refillCapUsd, perDay: null, maxPerDay: null, series: null, days: s.days };
  }
  if (type === 'ai_events') {
    const s = await readAiEventsSettings((text, params) => dbQuery(text, params));
    // Two carousels on each of its days, Miami and Boston (Sunday, AE-29): no per-day quota to set.
    return { type, generate: s.autoRun, live: s.publishingLive, refill: s.refillCapUsd, perDay: null, maxPerDay: null, series: null, days: s.days };
  }
  if (type === 'field_notes') {
    const s = await readFieldNotesSettings((text, params) => dbQuery(text, params));
    // One post on each calendar day it holds a slot (1-2 a week): no per-day quota to set.
    return { type, generate: s.autoRun, live: s.publishingLive, refill: s.refillCapUsd, perDay: null, maxPerDay: null, series: null, days: null };
  }
  // A Stories-format type (SS-24): Generate is its one series' auto switch; Live and the refill cap are the type's own.
  const s = await loadStories(liveStoriesDb);
  const own = typeSettings(s, type);
  const series = s.series[SERIES_OF_VERTICAL[type] as Series];
  return { type, generate: series.auto, live: own.publishingLive, refill: own.refillCapUsd, perDay: null, maxPerDay: null, series: null, days: [...series.window.days].sort((a, b) => a - b) };
}

/** AI Trivia and Real or AI? post at most once a day (SS-24); Morning Download keeps its two-a-day slots (R25). */
const STORY_MAX_CAP = 1;

function quota(patch: PostingPatch, max: number | null, min: number): number | null {
  if (patch.perDay === undefined) return null;
  const n = patch.perDay;
  if (!Number.isInteger(n) || n < min || (max != null && n > max)) throw new Error(`Posts per day must be a whole number from ${min} to ${max}.`);
  return n;
}

/** Everything a patch can get wrong, checked before any connection is opened. */
function validate(type: ContentType, patch: PostingPatch): void {
  // D16: one state replaces the Generate, Auto-publish and Live switches; approval is always required.
  for (const k of ['live', 'generate', 'autoPublish'] as const) {
    if (k in (patch as Record<string, unknown>)) throw new Error(`${k} is no longer a setting: set the state (Paused, Approval or Live).`);
  }
  if (patch.state !== undefined && !isTypeState(patch.state)) throw new Error('The state is Paused, Approval or Live.');
  if (patch.refillCapUsd !== undefined) {
    const n = patch.refillCapUsd;
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > MAX_REFILL_CAP_USD) throw new Error(`A refill cap is a dollar amount above $0 and at most $${MAX_REFILL_CAP_USD}.`);
  }
  if (patch.perDay !== undefined) {
    if (isStoryVertical(type)) throw new Error('This type has no daily quota; it posts once on each of its days.');
    if (type === 'last_few_days') throw new Error('Last Few Days has no daily quota; it posts once on each of its days.');
    if (type === 'ai_events') throw new Error('AI Events has no daily quota; it posts Miami and Boston on each of its days.');
    if (type === 'field_notes') throw new Error('Field Notes has no daily quota; it posts once on each day the calendar gives it.');
    if (type === 'reel_ai_drama') quota(patch, DRAMA_WINDOWS.length, 1);
    else quota(patch, type === 'carousels' ? carouselCfg.CAROUSEL_SLOTS.length : type === 'explainers' ? EXPLAINER_WINDOWS.length : windows('reels'), type === 'explainers' ? 1 : 0);
  }
  if ('series' in (patch as Record<string, unknown>)) throw new Error('Series settings moved: each Stories-format type has its own state.');
  if (patch.cap !== undefined) {
    if (!Number.isInteger(patch.cap) || patch.cap < 0 || patch.cap > MAX_CAP) throw new Error(`A daily limit is a whole number from 0 to ${MAX_CAP}.`);
    if (isStoryVertical(type) && type !== 'stories' && patch.cap > STORY_MAX_CAP) throw new Error('This type posts once a day, so its daily limit is 0 or 1.');
    if (patch.cap > maxCapFor(type)) {
      throw new Error(type === 'ai_events' ? 'AI Events posts Miami and Boston, so its daily limit is 0 to 2.' : type === 'field_notes' ? 'Field Notes posts once a day, so its daily limit is 0 or 1.' : type === 'reel_ai_drama' ? 'AI Drama reels are costly to make, so the daily limit is 0 to 3.' : 'Last Few Days runs once a day, so its daily limit is 0 or 1.');
    }
  }
}

/**
 * Write a person's change. `state` writes both stored keys (keysOf) through the type's own writer, in the order that
 * never leaves Generate off with Live on in between. Pausing then unslots the type's scheduled posts (D17).
 */
export async function writePosting(type: ContentType, patch: PostingPatch, by: string): Promise<PostingState> {
  validate(type, patch);
  // The calendar owns when in template mode; legacy keeps these controls, since they still drive the workers.
  if (patch.perDay !== undefined || patch.cap !== undefined) {
    const template = (await readSlotSource(appQuery)) === 'template';
    if (template && patch.perDay !== undefined) throw new Error('Cadence moved to the calendar.');
    // The daily limit caps the calendar's slots, so it means something only once the calendar is on.
    if (!template && patch.cap !== undefined) throw new Error('The daily limit applies once the calendar is on.');
  }
  if (patch.cap !== undefined) await writeCaps(appQuery, { [type]: patch.cap });
  const keys = patch.state !== undefined ? keysOf(patch.state) : null;
  // Live off before Generate off; Generate on before Live on.
  const order = (generate: () => Promise<unknown>, live: () => Promise<unknown>) => (keys ? (keys.live ? [generate, live] : [live, generate]) : []);
  const run = async (steps: Array<() => Promise<unknown>>) => {
    for (const step of steps) await step();
  };
  const refill = patch.refillCapUsd;
  if (type === 'carousels') {
    await run(order(() => setSocialSetting('auto_run', keys!.generate), () => setSocialSetting('publishing_live', keys!.live)));
    if (refill !== undefined) await setSocialSetting('pool_refill_cap_usd', refill);
    const n = quota(patch, carouselCfg.CAROUSEL_SLOTS.length, 0);
    if (n != null) {
      await setSocialSetting('posts_per_day', n);
      // The run makes as many stories as the day posts (its own spend knob, run_stories); zero skips the run.
      await setSocialSetting('run_stories', n);
    }
  } else if (type === 'explainers') {
    const db = await exDb();
    const raw = async (key: string, value: unknown) => {
      await db.query(`INSERT INTO explainers.settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [key, JSON.stringify(value)]);
    };
    await run(order(() => saveExplainersSetting(db, 'auto_render', keys!.generate), () => raw('publishing_live', keys!.live)));
    if (refill !== undefined) await saveExplainersSetting(db, 'pool_refill_cap_usd', refill);
    const n = quota(patch, EXPLAINER_WINDOWS.length, 1);
    if (n != null) {
      await raw('posts_per_day', n);
      // The daily render cap can't sit under the quota, or the quota could never be made.
      const cap = Number(await rowOf(db, 'explainers.settings', 'daily_render_cap'));
      if (!Number.isFinite(cap) || cap < n) await saveExplainersSetting(db, 'daily_render_cap', n);
    }
  } else if (type === 'reel_ai_drama') {
    // One transaction in the drama code for both keys and perDay (which also raises daily_render_cap).
    const db = await exDb();
    const n = quota(patch, DRAMA_WINDOWS.length, 1);
    const change = { ...(keys ? { generate: keys.generate, live: keys.live } : {}), ...(n != null ? { perDay: n } : {}) };
    if (Object.keys(change).length) await writeDramaPosting(db, change);
    if (refill !== undefined) {
      await db.query(
        `INSERT INTO reel_ai_drama.settings (key, value, updated_at) VALUES ('pool_refill_cap_usd', $1::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [JSON.stringify(refill)],
      );
    }
  } else if (type === 'reels') {
    await run(order(() => setReelsSetting('auto_run', keys!.generate), () => setReelsSetting('publishing_live', keys!.live)));
    if (keys?.live) {
      // Live after the night already ran: today's selected reels take today's open windows (as /api/reels/settings does).
      const { scheduleLatestToday } = await import('@/lib/reels/publish/schedule');
      await scheduleLatestToday();
    }
    if (refill !== undefined) await setReelsSetting('pool_refill_cap_usd', refill);
    const n = quota(patch, windows('reels'), 0);
    if (n != null) await setReelsSetting('posts_per_day', n);
  } else if (type === 'last_few_days' || type === 'ai_events' || type === 'field_notes') {
    const table = type === 'last_few_days' ? 'lfd.settings' : type === 'ai_events' ? 'ai_events.settings' : 'field_notes.settings';
    const set = (key: string, value: unknown) =>
      dbQuery(
        `INSERT INTO ${table} (key, value, updated_at) VALUES ($1, $2::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, JSON.stringify(value)],
      );
    await run(order(() => set('auto_run', keys!.generate), () => set('publishing_live', keys!.live)));
    if (refill !== undefined) await set('pool_refill_cap_usd', refill);
  } else if (isStoryVertical(type)) {
    // A Stories-format type (SS-24): Generate is its series' auto switch; Live and the refill cap are the type's own.
    const series = SERIES_OF_VERTICAL[type] as Series;
    await run(order(() => saveSeriesSetting(liveStoriesDb, series, { auto: keys!.generate }, by), () => saveTypeSetting(liveStoriesDb, type, { publishingLive: keys!.live }, by)));
    if (refill !== undefined) await saveTypeSetting(liveStoriesDb, type, { refillCapUsd: refill }, by);
  }
  // D17: a paused type holds no slots. Its scheduled posts go back to the Made tab, still approved (D18).
  if (patch.state === 'paused') await unslotType(await spineQuery(type), type, 'paused');
  return readPosting(type);
}
