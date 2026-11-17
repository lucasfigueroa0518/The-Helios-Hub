import { TYPE_CONFIG } from '@/lib/content-type/config';
import { isStoryVertical } from '@/lib/social-hub/story-types';
import type { TypeHubModel } from '@/lib/content-type/model';
import { madeRowState, poolRowState, POOL_STATE_WORDS, storySeriesOf, type PoolRowState } from '@/lib/content-type/pool-rules';
import { leadDaysFor } from '@/lib/social-hub/lead';
import { clockLabel } from '@/lib/social-hub/slots/times';
import { addDays, nyDateOf, nyDayStart, weekdayOf } from '@/lib/social-hub/time';
import type { HubIdea, HubPost, Vertical } from '@/lib/social-hub/types';
import { ideaOwns, type DayQuotas } from '@/lib/social-hub/views/day-rank';
import type { IdeaAdjustment } from '@/lib/social-hub/views/moves';
import { capacityWindows, type PlanWindow } from '@/lib/social-hub/views/plan';
import { isRejected } from '@/lib/social-hub/views/state';

/**
 * The pool screen's lists (pool UI contract 2026-11-15 §4): the Ideas tab, the Made tab, the next-three-days
 * board and the runway, built on the type page's model (lib/content-type/model.ts) so the queue order is the
 * model's (dayRanking → queueOrder), never re-derived. Pure: the page and the tests draw the same rows.
 *
 * The model alone has no calendar slots and only the posts the type page shows. Pass the dataset's pieces in
 * `source` (posts, dayQuotas, adjustments) for the full picture; without them the board uses the default plan
 * windows and the Made tab sees only the posts the model holds.
 */

/** What the dataset adds to the model: every post, the calendar's slots and quotas, and a person's moves (archives). */
export type PoolSource = {
  posts?: readonly HubPost[] | null;
  dayQuotas?: DayQuotas | null;
  adjustments?: readonly IdeaAdjustment[] | null;
};

export const MADE_WINDOW_DAYS = 30;
/** How far ahead the board fills (the calendar covers today + 21). */
const HORIZON_DAYS = 21;
const UP_NEXT = 3;
const DAY_MS = 86_400_000;

export type IdeaSource = 'Written by the night' | 'Seeded by you';

/** The slot an Up next idea fills, from the same fill as the board. */
export type PoolSlotRef = {
  date: string;
  /** The board slot's id (the plan window id). */
  slotId: string;
  /** "Today 12:00 PM", "Tue 7:00 PM". */
  label: string;
  /** "not made yet", "makes tonight", "makes Mon night" (lead days); "making now" while it is being made. */
  makes: string;
};

export type PoolIdeaRow = {
  idea: HubIdea;
  /** 1-based place in the Ideas list. */
  position: number;
  /** The model's queue rank (within its series or city where the type groups). */
  rank: number;
  pinned: boolean;
  /** A person dragged it to where it sits. */
  placed: boolean;
  state: PoolRowState;
  /** POOL_STATE_WORDS[state]. Never an error. */
  stateWord: string;
  source: IdeaSource;
  /** Whole New York days since it entered the pool; null when the pool has no date for it. */
  addedDaysAgo: number | null;
  /** The number column per `pool.order`: the score to 2 decimals, the rank, or null. */
  number: string | null;
  /** In the first three rows. */
  upNext: boolean;
  /** Up next only: the slot it fills on the board, or null when no open slot in the next 21 days takes it. */
  slot: PoolSlotRef | null;
  /** The meta line's pieces, in order: slot label · when it gets made (Up next), source, "added N d ago". */
  meta: string[];
};

export type PoolMadeRow = {
  post: HubPost;
  state: PoolRowState;
  stateWord: string;
  /** "Posted today, 12:00 PM", "Posts Tue, 7:00 PM", "Waiting for your approval", "Not booked yet", "Didn't post". */
  when: string;
  /** Whole New York days since it was made (generatedAt). */
  madeDaysAgo: number;
  /** 30 − madeDaysAgo: it leaves the Made tab (archived, computed on read) after this many days. */
  daysLeft: number;
  /** when · "made today" / "made N d ago" · "archives in N d". */
  meta: string[];
};

export type BoardSlot = {
  /** The plan window id (a calendar slot id such as `t0780`, or the legacy window id). */
  id: string;
  date: string;
  startMinute: number;
  /** "7:00 PM". */
  time: string;
  /** "Today 7:00 PM", "Tue 7:00 PM". */
  label: string;
  /** Stories: the series this slot is for. */
  series: string | null;
  /** Its start time has passed. */
  past: boolean;
  kind: 'post' | 'idea' | 'open';
  post: HubPost | null;
  idea: HubIdea | null;
  /** The made post's state, or the queued idea's. */
  state: PoolRowState | null;
  stateWord: string | null;
  /** A queued idea: when it gets made. */
  makes: string | null;
  /** A queued idea: its place in the Ideas list. */
  position: number | null;
};

export type BoardDay = {
  date: string;
  /** "Sun". */
  weekday: string;
  /** "Nov 15". */
  dayLabel: string;
  isToday: boolean;
  slots: BoardSlot[];
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const weekdayName = (date: string) => WEEKDAYS[weekdayOf(date)]!;
const dayLabelOf = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
/** Whole days from `a` to `b` (New York dates). */
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
/** Today, a weekday within the week ahead, else the weekday and date (two Thursdays never read the same). */
const dayShort = (date: string, today: string) => (date === today ? 'Today' : daysBetween(today, date) >= 7 ? `${weekdayName(date)} ${dayLabelOf(date)}` : weekdayName(date));

/** Ideas whose posts are built from the whole list (each post uses many), so no one idea fills a slot. */
const WHOLE_LIST_TYPES: ReadonlySet<Vertical> = new Set(['last_few_days', 'ai_events']);

const IDEA_STATES: ReadonlySet<PoolRowState> = new Set(['idea', 'making', 'failed']);
/** Statuses that put a post on a board slot. Failed, cancelled and skipped give the slot back. */
const ON_BOARD = new Set(['scheduled', 'publishing', 'published', 'generating', 'ready']);

/** Every post the model holds (days, bench, slots, content, versions), once each. */
function modelPosts(model: TypeHubModel): HubPost[] {
  const seen = new Map<string, HubPost>();
  const add = (p: HubPost | null | undefined) => { if (p && p.vertical === model.vertical && !seen.has(p.id)) seen.set(p.id, p); };
  for (const d of model.days) for (const c of d.cards) add(c.post);
  for (const b of model.bench) add(b.card?.post);
  for (const s of model.slots) add(s.card?.post);
  for (const c of Object.values(model.content)) add(c.post);
  for (const list of Object.values(model.versions)) for (const c of list) add(c.post);
  return [...seen.values()];
}

const postsOf = (model: TypeHubModel, source?: PoolSource) =>
  source?.posts ? source.posts.filter((p) => p.vertical === model.vertical) : modelPosts(model);

/**
 * When an unmade idea on a slot gets made: the night with run day = slot day − lead. A run day already gone is
 * "not made yet" (Make it by hand); tomorrow's run is "makes tonight"; a later run is named for the evening before.
 */
export function makesText(vertical: Vertical, slotDate: string, today: string, group?: string | null): string {
  const runDay = addDays(slotDate, -leadDaysFor(vertical, isStoryVertical(vertical) ? storySeriesOf(group) : null));
  const ahead = daysBetween(today, runDay);
  if (ahead <= 0) return 'not made yet';
  if (ahead === 1) return 'makes tonight';
  return `makes ${weekdayName(addDays(runDay, -1))} night`;
}

/** Post statuses that mean the idea is made: it has content (ready), is booked, posting or posted. */
const MADE_STATUSES: ReadonlySet<string> = new Set(['ready', 'scheduled', 'publishing', 'published']);

/** The Ideas list before slots are attached: open, unarchived ideas in the model's queue order. */
function ideaBase(model: TypeHubModel, now: Date, source?: PoolSource): Array<Omit<PoolIdeaRow, 'upNext' | 'slot' | 'meta' | 'position' | 'number'>> {
  const archived = new Set((source?.adjustments ?? []).filter((a) => a.vertical === model.vertical && a.kind === 'archive').map((a) => a.ideaId));
  const today = model.today;
  // Ideas lists only what is not made yet: an idea that owns a made post (ready, booked, posting or posted) lives on the board and in Made.
  // Last Few Days and AI Events build each post from the whole list: an item in the post stays listed (pin, drag, archive, Rebuild).
  const wholeList = WHOLE_LIST_TYPES.has(model.vertical);
  const made = wholeList ? [] : postsOf(model, source).filter((p) => MADE_STATUSES.has(p.status) && !isRejected(p));
  const hasMade = (idea: HubIdea) => made.some((p) => ideaOwns(idea, p));
  return model.bench
    .filter((b) => !b.card && !archived.has(b.idea.id) && b.idea.hold !== 'excluded' && b.idea.state !== 'retired' && b.idea.state !== 'skipped' && !hasMade(b.idea))
    .map((b) => {
      let state = poolRowState(b.idea);
      if (wholeList && (state === 'ready' || state === 'scheduled')) state = 'idea';
      // Being made with no run row yet (a night's render): the model's content for it says so.
      if (state === 'idea' && model.content[b.idea.id]?.post.status === 'generating') state = 'making';
      const added = nyDateOf(b.idea.createdAt);
      return {
        idea: b.idea,
        rank: b.rank,
        pinned: Boolean(b.pinned),
        placed: Boolean(b.placed),
        state,
        stateWord: POOL_STATE_WORDS[state],
        source: b.idea.yours ? ('Seeded by you' as const) : ('Written by the night' as const),
        addedDaysAgo: added ? Math.max(0, daysBetween(added, today)) : null,
      };
    })
    .filter((r) => IDEA_STATES.has(r.state));
}

type Fill = { days: BoardDay[]; slotOf: Map<string, PoolSlotRef> };

/** A day's posting windows for the type, cut to its daily limit (a day keeps a window for each post already on it). The board and the runway both count these. */
function dayWindows(vertical: Vertical, date: string, today: string, onDay: number, quotas: DayQuotas | null): PlanWindow[] {
  const windows = capacityWindows(vertical, date, quotas?.lfdDays ?? [], onDay, today, quotas?.slots ?? null);
  // With the calendar (template mode) a type's quota is TODAY's slot count under its daily limit (readDayQuotas), so it
  // cuts today only; other days show their calendar slots. Without the calendar (legacy) it is posts per day, every day.
  const quotaApplies = !quotas?.slots || date === today;
  const quota = isStoryVertical(vertical) || !quotaApplies ? undefined : quotas?.[vertical as keyof DayQuotas];
  return typeof quota === 'number' ? windows.slice(0, Math.max(quota, Math.min(onDay, windows.length))) : windows;
}

/** A post's minute of its New York day (posted, else booked), or null. */
function minuteOf(post: HubPost, date: string): number | null {
  const at = post.postedAt ?? post.publishAt;
  if (!at) return null;
  return Math.round((Date.parse(at) - nyDayStart(date).getTime()) / 60_000);
}

/** The made posts on a day's windows: by the time each posts, else its slot id or series, else the next free window. */
function seat(posts: readonly HubPost[], windows: readonly PlanWindow[], date: string, vertical: Vertical): Map<string, HubPost> {
  const seated = new Map<string, HubPost>();
  const left: HubPost[] = [];
  const order = [...posts].sort((a, b) => (a.postedAt ?? a.publishAt ?? '￿').localeCompare(b.postedAt ?? b.publishAt ?? '￿') || a.id.localeCompare(b.id));
  for (const p of order) {
    const m = minuteOf(p, date);
    const hit = windows.find((w) => !seated.has(w.id) && (
      (m != null && m >= w.startMinute && m <= w.endMinute)
      || p.slot?.id === w.id
      || (isStoryVertical(vertical) && p.idea?.label != null && p.idea.label === w.label)
    ));
    if (hit) seated.set(hit.id, p);
    else left.push(p);
  }
  for (const p of left) {
    const free = windows.find((w) => !seated.has(w.id));
    if (free) seated.set(free.id, p);
  }
  return seated;
}

/**
 * The board from `from` through `through`, filled from today forward: each slot holds its made post; otherwise
 * the next idea in the Ideas order takes the earliest open slot still ahead (Stories: the next idea of the slot's
 * series). Days before today show their posts only. The Up next labels come from this same fill.
 */
function fillBoard(model: TypeHubModel, now: Date, rows: ReadonlyArray<{ idea: HubIdea; state: PoolRowState }>, from: string, through: string, source?: PoolSource): Fill {
  const vertical = model.vertical;
  const today = model.today;
  // A made post not booked yet has no nyDate of its own; it sits on the day the model put it (today's quota, its target day).
  const dayOf = new Map<string, string>();
  for (const d of model.days) for (const c of d.cards) dayOf.set(c.post.id, d.date);
  const posts = postsOf(model, source)
    .map((p) => (p.nyDate || !dayOf.has(p.id) ? p : { ...p, nyDate: dayOf.get(p.id)! }))
    .filter((p) => p.nyDate && ON_BOARD.has(p.status) && !isRejected(p));
  const quotas = source?.dayQuotas ?? null;
  const fills = !WHOLE_LIST_TYPES.has(vertical);
  const queue = fills ? rows.map((r, i) => ({ ...r, position: i + 1 })) : [];
  const used = new Set<string>();
  const slotOf = new Map<string, PoolSlotRef>();
  const days: BoardDay[] = [];
  const start = from < today ? from : today;
  // An idea whose made post is already on the board does not take a second slot.
  const onBoard = posts.filter((p) => p.nyDate! >= today);
  for (const r of queue) if (onBoard.some((p) => ideaOwns(r.idea, p))) used.add(r.idea.id);
  for (let date = start; date <= through; date = addDays(date, 1)) {
    const mine = posts.filter((p) => p.nyDate === date);
    const windows = dayWindows(vertical, date, today, mine.length, quotas);
    const seated = seat(mine, windows, date, vertical);
    const slots: BoardSlot[] = windows.map((w) => {
      const time = clockLabel(w.startMinute);
      const base = { id: w.id, date, startMinute: w.startMinute, time, label: `${dayShort(date, today)} ${time}`, series: isStoryVertical(vertical) ? w.label : null };
      const past = nyDayStart(date).getTime() + w.startMinute * 60_000 <= now.getTime();
      const post = seated.get(w.id) ?? null;
      if (post) {
        const state = madeRowState(post, now);
        return { ...base, past, kind: 'post', post, idea: null, state, stateWord: POOL_STATE_WORDS[state], makes: null, position: null };
      }
      const next = date >= today && !past
        ? queue.find((r) => !used.has(r.idea.id) && (!isStoryVertical(vertical) || (r.idea.group ?? null) === w.label))
        : undefined;
      if (!next) return { ...base, past, kind: 'open', post: null, idea: null, state: null, stateWord: null, makes: null, position: null };
      used.add(next.idea.id);
      const makes = next.state === 'making' ? 'making now' : makesText(vertical, date, today, next.idea.group);
      slotOf.set(next.idea.id, { date, slotId: w.id, label: base.label, makes });
      return { ...base, past, kind: 'idea', post: null, idea: next.idea, state: next.state, stateWord: POOL_STATE_WORDS[next.state], makes, position: next.position };
    });
    if (date >= from) days.push({ date, weekday: weekdayName(date), dayLabel: dayLabelOf(date), isToday: date === today, slots });
  }
  return { days, slotOf };
}

const numberOf = (vertical: Vertical, idea: HubIdea, groupPosition: number): string | null => {
  const order = TYPE_CONFIG[vertical].pool.order;
  if (order === 'score') return idea.score == null || !Number.isFinite(idea.score) ? null : idea.score.toFixed(2);
  if (order === 'rank') return String(groupPosition);
  return null;
};

/**
 * The Ideas tab: open ideas (Idea, Making, Failed), not archived, in the model's queue order. The first three are
 * Up next, each with the slot it fills on the board and when it gets made. The header count is the length.
 */
export function poolIdeas(model: TypeHubModel, now: Date, source?: PoolSource): PoolIdeaRow[] {
  const base = ideaBase(model, now, source);
  const grouped = isStoryVertical(model.vertical) || model.vertical === 'ai_events';
  const inGroup = new Map<string, number>();
  const through = addDays(model.today, HORIZON_DAYS);
  const { slotOf } = base.length ? fillBoard(model, now, base, model.today, through, source) : { slotOf: new Map<string, PoolSlotRef>() };
  return base.map((r, i) => {
    const g = grouped ? r.idea.group ?? '' : '';
    inGroup.set(g, (inGroup.get(g) ?? 0) + 1);
    const upNext = i < UP_NEXT;
    const slot = upNext ? slotOf.get(r.idea.id) ?? null : null;
    const meta = [
      ...(slot ? [`${slot.label} · ${slot.makes}`] : []),
      r.source,
      ...(r.addedDaysAgo != null ? [r.addedDaysAgo === 0 ? 'added today' : `added ${r.addedDaysAgo} d ago`] : []),
    ];
    return { ...r, position: i + 1, number: numberOf(model.vertical, r.idea, inGroup.get(g)!), upNext, slot, meta };
  });
}

/** "today", "tomorrow", "yesterday", else "Tue Nov 17". */
function dayWord(date: string, today: string): string {
  const d = daysBetween(today, date);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  return `${weekdayName(date)} ${dayLabelOf(date)}`;
}

function whenText(post: HubPost, state: PoolRowState, today: string): string {
  const at = state === 'posted' ? post.postedAt ?? post.publishAt : post.publishAt;
  const date = nyDateOf(at);
  const clock = at && date ? clockLabel(Math.round((Date.parse(at) - nyDayStart(date).getTime()) / 60_000)) : null;
  const on = date && clock ? `${dayWord(date, today)}, ${clock}` : null;
  switch (state) {
    case 'posted':
      return on ? `Posted ${on}` : 'Posted';
    case 'scheduled':
      return on ? `Posts ${on}` : 'Booked';
    case 'needs_you':
      return on ? `Posts ${on} once approved` : 'Waiting for your approval';
    case 'failed':
      return 'Didn’t post';
    case 'making':
      return 'Being made';
    default:
      return post.nyDate ? `For ${dayWord(post.nyDate, today)}` : 'Not booked yet';
  }
}

/**
 * The Made tab: the type's posts made in the last 30 days (generatedAt), any state, newest first. A post leaves
 * the tab 30 days after it was made (archived on read: nothing is written). Each row says when it goes out and
 * how many days it has left.
 */
export function poolMade(model: TypeHubModel, now: Date, source?: PoolSource): PoolMadeRow[] {
  const today = model.today;
  return postsOf(model, source)
    .flatMap((post) => {
      const made = nyDateOf(post.generatedAt);
      if (!made) return [];
      const age = Math.max(0, daysBetween(made, today));
      if (age >= MADE_WINDOW_DAYS) return [];
      const state = madeRowState(post, now);
      const when = whenText(post, state, today);
      const daysLeft = MADE_WINDOW_DAYS - age;
      return [{ post, state, stateWord: POOL_STATE_WORDS[state], when, madeDaysAgo: age, daysLeft, meta: [when, age === 0 ? 'made today' : `made ${age} d ago`, `archives in ${daysLeft} d`] }];
    })
    .sort((a, b) => (b.post.generatedAt ?? '').localeCompare(a.post.generatedAt ?? '') || a.post.id.localeCompare(b.post.id));
}

/**
 * The board: `days` consecutive New York dates from `startDay`, each with the type's slots. A slot shows its made
 * post; otherwise the next idea in the Ideas order fills the earliest open slot still ahead; otherwise it is open.
 * The fill always starts at today, so ‹ › never changes which idea lands where, and it agrees with poolIdeas' Up next.
 */
export function poolBoard(model: TypeHubModel, startDay: string, days = 3, source?: PoolSource & { now?: Date }): BoardDay[] {
  const now = source?.now ?? nyDayStart(model.today);
  const through = addDays(startDay, Math.max(1, days) - 1);
  const base = ideaBase(model, now, source);
  return fillBoard(model, now, base, startDay, through, source).days;
}

/** Whole days of posts the pool covers: open ideas over slots a day. No slots: 0. */
export function poolRunway(ideaCount: number, slotsPerDay: number): number {
  if (!(slotsPerDay > 0) || !(ideaCount > 0)) return 0;
  return Math.floor(ideaCount / slotsPerDay + 1e-9);
}

/** The type's slots a day, averaged over the coming week (Field Notes posts twice a week: 2/7), for poolRunway. */
export function poolSlotsPerDay(model: TypeHubModel, source?: PoolSource): number {
  const quotas = source?.dayQuotas ?? null;
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const date = addDays(model.today, i);
    total += dayWindows(model.vertical, date, model.today, 0, quotas).length;
  }
  return total / 7;
}
