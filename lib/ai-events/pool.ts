/**
 * The weekly pool's person actions (AE-04): pin an event into its city's picks, exclude it, or
 * clear either, and queue "Rebuild post", all for the week the hub's pool shows (the newest
 * pooled week up to the coming one: the week in progress until the Sunday run pools the next).
 * Only ai_events.pool's pinned_* and excluded_* columns are written here; the ranking run owns
 * the rest of the row (lib/networking/pick/rank.ts). Pin and exclude take effect on the next
 * build or rebuild. No model, no network.
 */
import { comingWeek, metroWindow, weekFromKey } from '@/lib/networking/pick/week';
import type { Metro } from '@/lib/networking/types';
import type { HubQuery } from '@/lib/social-hub/db';

import { queueAiEventsRun } from './manual';
import { SHOWN_POOL_WEEK_SQL } from './pool-week';
import { AI_EVENTS_METROS } from './types';

export type PoolActionResult = { ok: boolean; note: string };

/** The coming week: the one the next Sunday run makes. */
export function poolWeekKey(now = new Date()): string {
  return comingWeek(now).weekKey;
}

/** The hub's pool week (lib/social-hub/queries/ai-events.ts AI_EVENTS_POOL_WEEK_SQL): the newest pooled week up to the coming one. */
export { SHOWN_POOL_WEEK_SQL } from './pool-week';

/**
 * The week the pool actions change: the week the hub shows, so a click acts on the row the
 * person sees. From Monday to the Sunday run that is the week in progress, not the coming week
 * (a pin there would land in a week the event is not in, and flip the hub's pool to it).
 */
export async function shownPoolWeekKey(q: HubQuery, now = new Date()): Promise<string> {
  const coming = poolWeekKey(now);
  const { rows } = await q<{ week_key: string | null }>(SHOWN_POOL_WEEK_SQL, [coming]);
  return rows[0]?.week_key ?? coming;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The event's metro and start when it is a kept event in one of the four cities, else null. */
async function eventOf(q: HubQuery, eventId: string): Promise<{ metro: Metro; startAt: Date } | null> {
  if (!UUID.test(eventId)) return null;
  const { rows } = await q<{ metro: string; start_at: Date | string }>(`SELECT metro, start_at FROM networking.events WHERE id = $1::uuid`, [eventId]);
  const row = rows[0];
  return row && (AI_EVENTS_METROS as readonly string[]).includes(row.metro) ? { metro: row.metro as Metro, startAt: new Date(row.start_at) } : null;
}

async function mark(q: HubQuery, eventId: string, by: string, what: 'pin' | 'exclude', now: Date): Promise<PoolActionResult> {
  const event = await eventOf(q, eventId);
  if (!event) return { ok: false, note: 'That event is not in the AI Events cities.' };
  const weekKey = await shownPoolWeekKey(q, now);
  // An event outside the week would never rank in it: the row would only sit in the pool as noise.
  const window = metroWindow(event.metro, weekFromKey(weekKey));
  if (!(event.startAt >= window.from && event.startAt < window.to)) {
    return { ok: false, note: `That event is not in the pool's week (${window.startDate} to ${window.endDate}).` };
  }
  const metro = event.metro;
  const [setBy, setAt, clearBy, clearAt] =
    what === 'pin' ? ['pinned_by', 'pinned_at', 'excluded_by', 'excluded_at'] : ['excluded_by', 'excluded_at', 'pinned_by', 'pinned_at'];
  // A pin and an exclude never stand together: the newer click wins.
  await q(
    `INSERT INTO ai_events.pool (week_key, event_id, metro, ${setBy}, ${setAt}, updated_at)
     VALUES ($1, $2::uuid, $3, $4, $5::timestamptz, now())
     ON CONFLICT (week_key, event_id) DO UPDATE SET
       ${setBy} = EXCLUDED.${setBy}, ${setAt} = EXCLUDED.${setAt}, ${clearBy} = NULL, ${clearAt} = NULL, updated_at = now()`,
    [weekKey, eventId, metro, by, now.toISOString()],
  );
  return what === 'pin'
    ? { ok: true, note: 'Pinned. It goes into its city on the next build or Rebuild post.' }
    : { ok: true, note: 'Excluded. It stays out of the post from the next build or Rebuild post.' };
}

export function pinPoolEvent(q: HubQuery, eventId: string, by: string, now = new Date()): Promise<PoolActionResult> {
  return mark(q, eventId, by, 'pin', now);
}

export function excludePoolEvent(q: HubQuery, eventId: string, by: string, now = new Date()): Promise<PoolActionResult> {
  return mark(q, eventId, by, 'exclude', now);
}

/** Back to the ranking's call: the pin or exclude is removed. */
export async function clearPoolEvent(q: HubQuery, eventId: string, now = new Date()): Promise<PoolActionResult> {
  if (!UUID.test(eventId)) return { ok: false, note: 'That event is not in this week’s pool.' };
  const { rows } = await q(
    `UPDATE ai_events.pool SET pinned_by = NULL, pinned_at = NULL, excluded_by = NULL, excluded_at = NULL, updated_at = now()
      WHERE week_key = $1 AND event_id = $2::uuid RETURNING event_id`,
    [await shownPoolWeekKey(q, now), eventId],
  );
  return rows.length ? { ok: true, note: 'Cleared. The ranking decides again on the next build or Rebuild post.' } : { ok: false, note: 'That event is not in this week’s pool.' };
}

/** Rebuild post: re-render the week's post from the pool and the cached scores, keeping its hook and look. */
export async function queueRebuild(q: HubQuery, by: string, now = new Date()): Promise<PoolActionResult> {
  return queueAiEventsRun(q, { kind: 'rebuild', requestedBy: by, weekKey: await shownPoolWeekKey(q, now) });
}
