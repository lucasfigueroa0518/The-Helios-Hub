const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

/** A stamp at exactly 00:00:00.000 UTC. Dated feeds use that for "this calendar day". */
export function isUtcDateOnly(date: Date): boolean {
  return (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  );
}

/**
 * New since the last successful run (D-032).
 *
 * A UTC-midnight stamp means sometime that calendar day, not an instant before
 * the 1:00 AM Eastern run (05:00 UTC). It stays eligible until a run has
 * succeeded after that UTC day ends. A stamp with a real time compares exactly.
 */
export function publishedSince(publishedAt: Date, since: Date): boolean {
  if (isUtcDateOnly(publishedAt)) {
    const end = new Date(publishedAt.getTime());
    end.setUTCHours(23, 59, 59, 999);
    return end >= since;
  }
  return publishedAt >= since;
}

/**
 * "September 28, 2026" as UTC midnight. `new Date(heading)` is local midnight,
 * which would move the day on a machine that is not UTC.
 */
export function parseUtcDateHeading(heading: string): Date | null {
  const match = heading.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  if (month == null) return null;
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}
