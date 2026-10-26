/**
 * Dated anchors for the `satellite` term of event-pick (plan M2 step 2): conferences, tech
 * weeks and flagship ecosystem moments that side events cluster around. The curated list below
 * comes from the research audit (c), 2026-10-21; at read time it is merged with the
 * `networking.anchors` rows the conferences adapter stores (source `developers.events`).
 *
 * An event is a satellite when its local calendar day falls within SATELLITE_DAYS of a
 * same-city anchor's first or last day (inclusive).
 */
import type { NetworkingQuery } from '@/lib/networking/repository';
import type { EventAnchor, Metro } from '@/lib/networking/types';

import { normalizeOrgName } from './anchors-roster';

export const SATELLITE_DAYS = 3;
export const CURATED_ANCHOR_SOURCE = 'curated';

const curated = (name: string, metro: Metro, startsOn: string, endsOn: string | null = null): EventAnchor => ({
  name,
  metro,
  startsOn,
  endsOn,
  url: null,
  source: CURATED_ANCHOR_SOURCE,
});

export const TECH_WEEKS: readonly EventAnchor[] = [
  curated('Tough Tech Week', 'boston', '2026-10-26', '2026-10-30'),
  curated('AI DevCon NYC', 'nyc', '2026-11-02'),
  curated('AI Engineer Code', 'sf', '2026-11-10', '2026-11-12'),
  curated('Miami Art Week', 'miami', '2026-11-30', '2026-12-06'),
  curated('YC Demo Day', 'sf', '2026-12-02'),
  curated('Fortune Brainstorm AI', 'sf', '2026-12-07', '2026-12-08'),
  curated('The AI Summit New York', 'nyc', '2026-12-09', '2026-12-10'),
  curated('Miami Tech Week', 'miami', '2027-02-28', '2027-03-07'),
  curated('eMerge Americas', 'miami', '2027-03-02', '2027-03-04'),
  curated('NVIDIA GTC', 'sf', '2027-03-14', '2027-03-18'),
  curated('RSAC', 'sf', '2027-04-05', '2027-04-08'),
  curated('AI Engineer Miami', 'miami', '2027-04-26', '2027-04-27'),
  curated('ODSC AI East', 'boston', '2027-05-10', '2027-05-12'),
  curated('EmTech AI', 'boston', '2027-05-11', '2027-05-13'),
  curated('Snowflake Summit', 'sf', '2027-06-07', '2027-06-10'),
  curated('Data+AI Summit', 'sf', '2027-06-21', '2027-06-24'),
  curated("AI Engineer World's Fair", 'sf', '2027-06-29', '2027-07-01'),
];

/** Whole days from `a` to `b`, both "YYYY-MM-DD". */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** "YYYY-MM-DD" shifted by `days`. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Curated anchors plus stored ones, one per (metro, normalized name, first day). A stored row
 * fills in a curated row's missing end date or URL; otherwise the curated row wins.
 */
export function mergeAnchors(curatedRows: readonly EventAnchor[], stored: readonly EventAnchor[]): EventAnchor[] {
  const byKey = new Map<string, EventAnchor>();
  const key = (a: EventAnchor) => `${a.metro}|${normalizeOrgName(a.name)}|${a.startsOn}`;
  for (const anchor of curatedRows) byKey.set(key(anchor), { ...anchor });
  for (const anchor of stored) {
    const existing = byKey.get(key(anchor));
    if (existing) {
      existing.endsOn ??= anchor.endsOn;
      existing.url ??= anchor.url;
    } else {
      byKey.set(key(anchor), { ...anchor });
    }
  }
  return [...byKey.values()].sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.name.localeCompare(b.name));
}

/**
 * The anchors that can make an event between `fromDate` and `toDate` (local days, inclusive)
 * a satellite: stored rows read here, merged with TECH_WEEKS.
 */
export async function loadAnchors(
  query: NetworkingQuery,
  fromDate: string,
  toDate: string,
  curatedRows: readonly EventAnchor[] = TECH_WEEKS,
): Promise<EventAnchor[]> {
  const lo = addDays(fromDate, -SATELLITE_DAYS);
  const hi = addDays(toDate, SATELLITE_DAYS);
  const { rows } = await query<{ name: string; metro: Metro; starts_on: string | Date; ends_on: string | Date | null; url: string | null; source: string }>(
    `SELECT name, metro, starts_on::text AS starts_on, ends_on::text AS ends_on, url, source
       FROM networking.anchors
      WHERE starts_on <= $2::date AND COALESCE(ends_on, starts_on) >= $1::date`,
    [lo, hi],
  );
  const day = (value: string | Date) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));
  const stored = rows.map((row) => ({
    name: row.name,
    metro: row.metro,
    startsOn: day(row.starts_on),
    endsOn: row.ends_on == null ? null : day(row.ends_on),
    url: row.url,
    source: row.source,
  }));
  const inRange = curatedRows.filter((a) => a.startsOn <= hi && (a.endsOn ?? a.startsOn) >= lo);
  return mergeAnchors(inRange, stored);
}

/**
 * The same-city anchor `localDay` sits within SATELLITE_DAYS of, nearest first (an anchor the
 * day falls inside is distance 0), or null.
 */
export function nearbyAnchor(metro: Metro, localDay: string, anchors: readonly EventAnchor[]): EventAnchor | null {
  let best: { anchor: EventAnchor; distance: number } | null = null;
  for (const anchor of anchors) {
    if (anchor.metro !== metro) continue;
    const end = anchor.endsOn ?? anchor.startsOn;
    const distance = localDay < anchor.startsOn ? dayDiff(localDay, anchor.startsOn) : localDay > end ? dayDiff(end, localDay) : 0;
    if (distance > SATELLITE_DAYS) continue;
    if (!best || distance < best.distance) best = { anchor, distance };
  }
  return best?.anchor ?? null;
}
