/**
 * Candidate ranking (photo spec §4 step 3; Tommy, 2026-10-07):
 *
 *   person, company, event, product   the photo dated closest to the story
 *                                     wins; an undated photo ranks below a
 *                                     dated one. Two photos within 12 days of
 *                                     each other (cover: 35 days) → the bigger
 *                                     image wins.
 *   thematic, setting, logo           the bigger image wins.
 *
 * Size is the pixel area; a side the source doesn't give counts as the other
 * side (a square), an unknown size as 0. Ties keep the sources' order.
 */
import type { VisualKind } from '@/lib/social/writer/draft';

import type { Candidate } from './find';

/** Kinds where a photo's date matters (Tommy, 2026-10-07: "date only where it matters"). */
export const DATED_KINDS = new Set<VisualKind>(['person', 'company', 'event', 'product']);
/** Within this many days of each other, size decides (Tommy, 2026-10-07). */
export const SAME_TIME_DAYS = 12;
export const SAME_TIME_DAYS_COVER = 35;

const DAY_MS = 86_400_000;

/** A YYYY-MM-DD or YYYY date as a time; a bare year counts as 1 July. Null when unparseable. */
export function dateMs(date: string | null | undefined): number | null {
  if (!date) return null;
  const m = /^(\d{4})(?:-(\d{2})-(\d{2}))?/.exec(date.trim());
  if (!m) return null;
  return Date.UTC(Number(m[1]), m[2] ? Number(m[2]) - 1 : 6, m[3] ? Number(m[3]) : 1);
}

const area = (c: Candidate) => (c.width ?? c.height ?? 0) * (c.height ?? c.width ?? 0);

/** Negative: a ranks first. */
export function compareCandidates(a: Candidate, b: Candidate, kind: VisualKind, storyDate: string | null, cover: boolean): number {
  const story = dateMs(storyDate);
  if (DATED_KINDS.has(kind) && story !== null) {
    const da = dateMs(a.date);
    const db = dateMs(b.date);
    if (da !== null && db === null) return -1;
    if (da === null && db !== null) return 1;
    if (da !== null && db !== null) {
      const window = (cover ? SAME_TIME_DAYS_COVER : SAME_TIME_DAYS) * DAY_MS;
      if (Math.abs(da - db) > window) return Math.abs(da - story) - Math.abs(db - story);
    }
  }
  return area(b) - area(a);
}

export function rankCandidates(cands: Candidate[], kind: VisualKind, storyDate: string | null, cover: boolean): Candidate[] {
  return cands
    .map((c, i) => ({ c, i }))
    .sort((x, y) => compareCandidates(x.c, y.c, kind, storyDate, cover) || x.i - y.i)
    .map((x) => x.c);
}
