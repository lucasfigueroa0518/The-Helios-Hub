// lib/social-hub/slots/write.ts
import { calendarDateKey, SOCIAL_TIMEZONE } from '@/lib/instagram/clock';
import { addCalendarDays, windowMinuteInstant } from '@/lib/instagram/window';
import { isDayKey, weekdayOf } from '@/lib/social-hub/time';
import type { Vertical } from '@/lib/social-hub/types';
import { isVertical } from '@/lib/social-hub/verticals';
import { PLAN } from '@/lib/social-hub/views/plan';

import { legacyFeedMode } from './index';
import { readOverrides, readTemplate } from './load';
import { resolveDay, validateDay } from './resolve';
import { readSeedInputs, seedTemplate, type SeedInputs } from './seed';
import type { FeedMode, OverrideRow, ResolvedSlot, SlotQuery, SlotSource, TemplateRow } from './types';

/**
 * The calendar's writes (spec §4). Writes only social_hub.slot_template,
 * social_hub.slot_override and social_hub.settings. Never unschedules: a
 * booked post in the way comes back as a 409 with its action refs, and the
 * client uses the existing unschedule action (or says keep).
 */

export type SlotChange =
  | { scope: 'template'; op: 'put'; weekday: number; vertical: Vertical; windowId: string; feedMode: FeedMode | null }
  | { scope: 'template'; op: 'delete'; weekday: number; vertical: Vertical; windowId: string }
  | { scope: 'date'; op: 'put'; nyDate: string; vertical: Vertical; windowId: string; action: 'add' | 'remove'; feedMode: FeedMode | null }
  | { scope: 'date'; op: 'delete'; nyDate: string; vertical: Vertical; windowId: string };

export type BookedPost = { scheduleId: string; vertical: Vertical; nyDate: string; windowId: string; feedMode: FeedMode | null; publishAt: string; refs: Record<string, string> };

export type ApplyResult = { ok: true } | { ok: false; status: 400 | 422; errors: string[] } | { ok: false; status: 409; booked: BookedPost[] };

const MAX_CHANGES = 20;
const hasWindow = (v: Vertical, id: unknown) => typeof id === 'string' && PLAN[v].some((w) => w.id === id);
const isMode = (m: unknown): m is FeedMode | null => m === null || m === 'trial' || m === 'main';

export function parseChanges(body: unknown): SlotChange[] | string {
  const list = (body as { changes?: unknown } | null)?.changes;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_CHANGES) return `Send 1 to ${MAX_CHANGES} changes.`;
  const out: SlotChange[] = [];
  for (const c of list as Array<Record<string, unknown> | null>) {
    if (typeof c !== 'object' || c === null) return 'Each change must be an object.';
    if (!isVertical(c.vertical) || !hasWindow(c.vertical, c.windowId)) return 'Pick a content type and one of its windows.';
    const base = { vertical: c.vertical, windowId: c.windowId as string };
    if (c.scope === 'template') {
      if (!Number.isInteger(c.weekday) || (c.weekday as number) < 0 || (c.weekday as number) > 6) return 'Pick a weekday.';
      if (c.op === 'delete') out.push({ scope: 'template', op: 'delete', weekday: c.weekday as number, ...base });
      else if (c.op === 'put' && isMode(c.feedMode)) out.push({ scope: 'template', op: 'put', weekday: c.weekday as number, ...base, feedMode: c.feedMode });
      else return 'Unknown template change.';
    } else if (c.scope === 'date') {
      if (!isDayKey(c.nyDate)) return 'Pick a day as YYYY-MM-DD.';
      if (c.op === 'delete') out.push({ scope: 'date', op: 'delete', nyDate: c.nyDate, ...base });
      else if (c.op === 'put' && (c.action === 'add' || c.action === 'remove') && isMode(c.feedMode)) out.push({ scope: 'date', op: 'put', nyDate: c.nyDate, ...base, action: c.action, feedMode: c.action === 'remove' ? null : c.feedMode });
      else return 'Unknown date change.';
    } else return 'Each change is for the template or for a date.';
  }
  return out;
}

const keyOf = (v: string, w: string) => `${v}|${w}`;

/** Apply changes to in-memory copies, so validation sees the result before anything is written. */
function applyInMemory(template: TemplateRow[], overrides: OverrideRow[], changes: readonly SlotChange[]): { template: TemplateRow[]; overrides: OverrideRow[] } {
  let t = [...template];
  let o = [...overrides];
  for (const c of changes) {
    if (c.scope === 'template') {
      t = t.filter((r) => !(r.weekday === c.weekday && keyOf(r.vertical, r.windowId) === keyOf(c.vertical, c.windowId)));
      if (c.op === 'put') t.push({ weekday: c.weekday, vertical: c.vertical, windowId: c.windowId, feedMode: c.feedMode });
    } else {
      o = o.filter((r) => !(r.nyDate === c.nyDate && keyOf(r.vertical, r.windowId) === keyOf(c.vertical, c.windowId)));
      if (c.op === 'put') o.push({ nyDate: c.nyDate, vertical: c.vertical, windowId: c.windowId, action: c.action, feedMode: c.feedMode });
    }
  }
  return { template: t, overrides: o };
}

/** A window that has begun (or a past day) can't be edited: something may already be posting. */
function startedNote(c: SlotChange, today: string, now: Date): string | null {
  if (c.scope !== 'date') return null;
  if (c.nyDate < today) return 'That day has passed.';
  if (c.nyDate > today) return null;
  const w = PLAN[c.vertical].find((p) => p.id === c.windowId)!;
  return windowMinuteInstant({ ...w, label: w.label }, c.nyDate, 0).getTime() <= now.getTime() ? `Today’s ${w.label.toLowerCase()} window has started, so it can’t change now.` : null;
}

/** Where bookings can sit: the next two weeks, plus any override date. */
function bookedDates(today: string, overrideDates: ReadonlySet<string>): string[] {
  const out = new Set<string>(overrideDates);
  for (let i = 0; i < 14; i += 1) out.add(addCalendarDays(today, i));
  return [...out].sort();
}

const REF_KEY: Record<Vertical, string> = { carousels: 'postId', explainers: 'jobId', last_few_days: 'lfdPostId', stories: 'setId', reels: 'postIdeaId' };

async function bookedIn(q: SlotQuery, dates: readonly string[]): Promise<BookedPost[]> {
  if (!dates.length) return [];
  const { rows } = await q(
    `SELECT s.id::text AS id, s.vertical, s.ny_date::text AS ny_date, s.slot, s.feed_mode, s.publish_at, s.idea_ref, ci.native_ref
       FROM social_hub.schedule s LEFT JOIN social_hub.content_items ci ON ci.id = s.content_item_id
      WHERE s.status = 'scheduled' AND s.ny_date = ANY($1::date[])`,
    [dates],
  );
  return rows.map((r) => {
    const v = r.vertical as Vertical;
    const ref = v === 'reels' ? r.idea_ref : r.native_ref;
    return {
      scheduleId: r.id, vertical: v, nyDate: String(r.ny_date).slice(0, 10), windowId: r.slot, feedMode: r.feed_mode ?? null,
      publishAt: new Date(r.publish_at).toISOString(), refs: ref ? { [REF_KEY[v]]: String(ref) } : {},
    };
  });
}

/**
 * A booking is in the way when its slot is gone, or its slot's Trial/Main no
 * longer matches the booking. A booking with no feed_mode (made before the
 * cutover) posts as its type always did, so that is its mode here.
 */
function inTheWay(b: BookedPost, slots: readonly ResolvedSlot[]): boolean {
  const s = slots.find((x) => x.vertical === b.vertical && x.windowId === b.windowId);
  if (!s) return true;
  const mode = b.feedMode ?? legacyFeedMode(b.vertical);
  return s.feedMode != null && mode != null && s.feedMode !== mode;
}

export async function applySlotChanges(q: SlotQuery, changes: readonly SlotChange[], opts: { by: string; now: Date; keepBooked: boolean }): Promise<ApplyResult> {
  const today = calendarDateKey(opts.now, SOCIAL_TIMEZONE);
  const started = changes.map((c) => startedNote(c, today, opts.now)).filter((n): n is string => Boolean(n));
  if (started.length) return { ok: false, status: 422, errors: [...new Set(started)] };

  const [template, overridesAll] = await Promise.all([readTemplate(q), readOverrides(q, today, '9999-12-31')]);
  const next = applyInMemory(template, overridesAll, changes);

  const errors = new Set<string>();
  // The template alone, per weekday that changed (dates without overrides are just the template).
  for (const c of changes) {
    if (c.scope !== 'template') continue;
    for (const e of validateDay(resolveDay(next.template, [], probeDate(today, c.weekday)))) errors.add(e);
  }
  // Resolved days only where an override exists (already ahead, or in this change set).
  const overrideDates = new Set<string>(next.overrides.filter((o) => o.nyDate >= today).map((o) => o.nyDate));
  for (const c of changes) if (c.scope === 'date') overrideDates.add(c.nyDate);
  for (const d of [...overrideDates].sort()) for (const e of validateDay(resolveDay(next.template, next.overrides, d))) errors.add(`${d}: ${e}`);
  if (errors.size) return { ok: false, status: 422, errors: [...errors] };

  if (!opts.keepBooked) {
    const dates = bookedDates(today, overrideDates);
    const rows = await bookedIn(q, dates);
    // Only bookings this change set puts in the way, not ones already out of step before it.
    const fresh = rows.filter((b) => inTheWay(b, resolveDay(next.template, next.overrides, b.nyDate)) && !inTheWay(b, resolveDay(template, overridesAll, b.nyDate)));
    if (fresh.length) return { ok: false, status: 409, booked: fresh };
  }

  for (const c of changes) {
    if (c.scope === 'template') {
      if (c.op === 'delete') await q(`DELETE FROM social_hub.slot_template WHERE weekday = $1 AND vertical = $2 AND window_id = $3`, [c.weekday, c.vertical, c.windowId]);
      else await q(
        `INSERT INTO social_hub.slot_template (weekday, vertical, window_id, feed_mode, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (weekday, vertical, window_id) DO UPDATE SET feed_mode = EXCLUDED.feed_mode, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [c.weekday, c.vertical, c.windowId, c.feedMode, opts.by],
      );
    } else if (c.op === 'delete') {
      await q(`DELETE FROM social_hub.slot_override WHERE ny_date = $1::date AND vertical = $2 AND window_id = $3`, [c.nyDate, c.vertical, c.windowId]);
    } else {
      await q(
        `INSERT INTO social_hub.slot_override (ny_date, vertical, window_id, action, feed_mode, updated_by, updated_at) VALUES ($1::date, $2, $3, $4, $5, $6, now())
         ON CONFLICT (ny_date, vertical, window_id) DO UPDATE SET action = EXCLUDED.action, feed_mode = EXCLUDED.feed_mode, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [c.nyDate, c.vertical, c.windowId, c.action, c.feedMode, opts.by],
      );
    }
  }
  return { ok: true };
}

/** The next date on or after `today` that falls on `weekday`. */
function probeDate(today: string, weekday: number): string {
  let d = today;
  while (weekdayOf(d) !== weekday) d = addCalendarDays(d, 1);
  return d;
}

/** Flip the switch. Inside a transaction pass `seed` read beforehand: readSeedInputs swallows query errors, which would abort it. The first flip to 'template' seeds the week from today's settings (spec §1 Seed). */
export async function setSlotSource(q: SlotQuery, source: SlotSource, by: string, seed?: SeedInputs): Promise<{ seeded: number }> {
  let seeded = 0;
  if (source === 'template') {
    const { rows } = await q(`SELECT count(*)::int AS n FROM social_hub.slot_template`);
    if (Number(rows[0]?.n ?? 0) === 0) {
      for (const r of seedTemplate(seed ?? (await readSeedInputs(q)))) {
        await q(
          `INSERT INTO social_hub.slot_template (weekday, vertical, window_id, feed_mode, updated_by) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [r.weekday, r.vertical, r.windowId, r.feedMode, by],
        );
        seeded += 1;
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
