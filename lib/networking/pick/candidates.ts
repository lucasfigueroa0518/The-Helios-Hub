/**
 * Candidates for the weekly ranking (plan M2 step 1): per metro, the events starting in the
 * coming week (week.ts) that are scheduled, in the tech or both bucket, and in person or hybrid
 * (the events table holds no online-only rows). Each city is capped at CANDIDATE_CAP by a
 * cheap prior so a busy week never fans out into hundreds of Jev calls; pinned and excluded
 * pool rows are always kept so a person's call stays visible.
 */
import { listKeptEvents, type NetworkingQuery } from '@/lib/networking/repository';
import type { Metro, StoredNetworkingEvent } from '@/lib/networking/types';

import { ATTENDANCE_POINTS, attendanceTerm, rosterTerm } from './terms';
import { metroWindow, type ComingWeek, type MetroWindow } from './week';

export const CANDIDATE_CAP = 30;

/** Prior weights. A description matters most: without one Jev has only the title to read. */
export const PRIOR_WEIGHTS = { attendance: 1, roster: 1, requiresApproval: 0.2, description: 0.5 } as const;

export type WeekEvents = { metro: Metro; window: MetroWindow; events: StoredNetworkingEvent[] };

/** Every scheduled tech or both event starting in `metro`'s window, by start. */
export async function loadWeekEvents(query: NetworkingQuery, week: ComingWeek, metros: readonly Metro[]): Promise<WeekEvents[]> {
  const out: WeekEvents[] = [];
  for (const metro of metros) {
    const window = metroWindow(metro, week);
    // listKeptEvents bounds are inclusive; the window's end is exclusive.
    const events = await listKeptEvents(
      { metros: [metro], bucket: 'tech', from: window.from, to: new Date(window.to.getTime() - 1) },
      query,
    );
    out.push({
      metro,
      window,
      events: events.filter((e) => e.attendance === 'in_person' || e.attendance === 'hybrid'),
    });
  }
  return out;
}

/** The cheap prior: attendance, roster, requires approval, a description to read. */
export function priorScore(event: StoredNetworkingEvent): number {
  return (
    (PRIOR_WEIGHTS.attendance * attendanceTerm(event.guestCount)) / ATTENDANCE_POINTS +
    PRIOR_WEIGHTS.roster * (rosterTerm(event).points > 0 ? 1 : 0) +
    (event.requiresApproval ? PRIOR_WEIGHTS.requiresApproval : 0) +
    (event.description?.trim() ? PRIOR_WEIGHTS.description : 0)
  );
}

/** The top `cap` by prior (earlier start on a tie), plus every event in `keep`. Returned by start. */
export function capCandidates(
  events: readonly StoredNetworkingEvent[],
  keep: ReadonlySet<string> = new Set(),
  cap = CANDIDATE_CAP,
): StoredNetworkingEvent[] {
  const byPrior = events
    .map((event) => ({ event, prior: priorScore(event) }))
    .sort((a, b) => b.prior - a.prior || Date.parse(a.event.startAt) - Date.parse(b.event.startAt) || a.event.id.localeCompare(b.event.id));
  const chosen = new Set(byPrior.slice(0, cap).map((c) => c.event.id));
  for (const id of keep) chosen.add(id);
  return events.filter((e) => chosen.has(e.id)).sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
}
