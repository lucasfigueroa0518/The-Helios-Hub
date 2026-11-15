/**
 * What every series builder shares: its dependencies, its result, backdrop
 * and layout rotation, and photo helpers.
 */
import { leadDaysFor } from '@/lib/social-hub/lead';
import type { StoriesDb } from '@/lib/stories/db';
import type { StoriesJev } from '@/lib/stories/jev';
import type { PhotoFinder, PhotoRequest } from '@/lib/stories/photos';
import type { OpenPool } from '@/lib/stories/pool';
import { BACKDROPS, type Backdrop, type FrameData, type Photo, type Series } from '@/lib/stories/render/types';
import { nyDate, recentKeys, sameDayKeys, type NewCandidate, type NewFrame } from '@/lib/stories/repository';
import type { StoriesSettings } from '@/lib/stories/settings';
import type { SourcePage } from '@/lib/stories/source-page';
import type { WriterCreate } from '@/lib/stories/writer';

export type BuildDeps = {
  db: StoriesDb;
  /** Where reels.* and social.* are read (the shared database live; PGlite in tests). */
  sourceDb: StoriesDb;
  jev: StoriesJev;
  write: WriterCreate;
  photos: PhotoFinder;
  settings: StoriesSettings;
  now: Date;
  setId: string;
  nyDate: string;
  /** The series' open ideas from stories.pool. Null only when the pool could not be read: the build then reads its sources directly. */
  pool?: OpenPool | null;
  /** The series reads the central intake (consumer switch 'intake'): Morning Download ranks by the stored scores and the lead queue. */
  intake?: boolean;
  /** Reads a cited page (Guess the Number gates). Defaults to readSourcePage; tests stub it by URL. */
  readSource?: (url: string, figure?: string) => Promise<SourcePage>;
};

/**
 * Keys a build must not use: what the series showed in the last `days` days
 * (stories.history, written at publish) and what its other live sets of the
 * same New York date already hold (ruling R13: two sets of one day never
 * repeat a story, even before either posts).
 *
 * A series made ahead (Bald-Eagle D4, lib/social-hub/lead.ts: Guess the
 * Number, Free vs. Paid) also avoids what its live sets within `lead` days of
 * this set's date hold: a set built tonight for day + 2 and last night's set
 * for day + 1 are both built before either posts, so neither is in the
 * history yet. Morning Download (lead 0) keeps the same-date rule only.
 */
export async function keysToAvoid(deps: Pick<BuildDeps, 'db' | 'now' | 'nyDate' | 'setId'>, series: Series, days: number): Promise<Set<string>> {
  const shown = await recentKeys(deps.db, series, days, deps.now);
  const span = leadDaysFor('stories', series);
  const held = span > 0 ? await nearbyKeys(deps.db, series, deps.nyDate, deps.setId, span) : await sameDayKeys(deps.db, series, deps.nyDate, deps.setId);
  for (const k of held) shown.add(k);
  return shown;
}

/**
 * Keys other live sets of this series hold on dates within `span` days of
 * `nyDate` (their build's `payload.historyKeys`), posted or not. Rejected,
 * failed and skipped sets free their keys (sameDayKeys' rule over a range).
 */
export async function nearbyKeys(db: StoriesDb, series: Series, nyDate: string, exceptSetId: string, span: number): Promise<Set<string>> {
  const { rows } = await db.query<{ key: string }>(
    `SELECT DISTINCT k.key FROM stories.sets s
       CROSS JOIN LATERAL jsonb_array_elements_text(
         CASE WHEN jsonb_typeof(s.payload->'historyKeys') = 'array' THEN s.payload->'historyKeys' ELSE '[]'::jsonb END) AS k(key)
      WHERE s.series = $1 AND s.ny_date BETWEEN $2::date - $4::int AND $2::date + $4::int
        AND s.id <> $3::uuid AND s.status NOT IN ('rejected', 'failed', 'skipped')`,
    [series, nyDate, exceptSetId, Math.max(0, Math.floor(span))],
  );
  return new Set(rows.map((r) => r.key));
}

/**
 * Spend counted against a set's daily cap. A same-day series (Morning Download) counts what Stories
 * spent on the run day on same-day sets (and on spend tied to no set), as before, but never the builds
 * for later dates that run the same night. A series made ahead (Bald-Eagle D4) counts what was spent on the
 * sets FOR its target date (stories.cost_events joined to their set's ny_date), so the cutover night
 * that fills two dates may spend up to one cap per date (D8), and a night's builds for day + 2 never
 * eat the run day's cap.
 */
export async function capSpendUsd(db: StoriesDb, series: Series, targetDate: string, now: Date): Promise<number> {
  if (leadDaysFor('stories', series) === 0) {
    const { rows } = await db.query<{ usd: number }>(
      `SELECT COALESCE(sum(c.usd), 0)::float8 AS usd FROM stories.cost_events c LEFT JOIN stories.sets s ON s.id = c.set_id
        WHERE (c.created_at AT TIME ZONE 'America/New_York')::date = $1::date
          AND (s.id IS NULL OR NOT (s.series = ANY($2::text[])))`,
      [nyDate(now), LEAD_SERIES],
    );
    return rows[0]?.usd ?? 0;
  }
  const { rows } = await db.query<{ usd: number }>(
    `SELECT COALESCE(sum(c.usd), 0)::float8 AS usd FROM stories.cost_events c JOIN stories.sets s ON s.id = c.set_id
      WHERE s.series = ANY($2::text[]) AND s.ny_date = $1::date`,
    [targetDate, LEAD_SERIES],
  );
  return rows[0]?.usd ?? 0;
}

/** The Stories series made ahead (lead > 0); their sets share a target date's cap. */
const LEAD_SERIES: readonly Series[] = (['morning_download', 'guess_the_number', 'free_vs_paid'] as const).filter((s) => leadDaysFor('stories', s) > 0);

export type BuildResult =
  | { ok: true; payload: Record<string, unknown>; frames: NewFrame[]; candidates: NewCandidate[]; historyKeys: string[] }
  | { ok: false; skip: string; candidates: NewCandidate[] };

/** The backdrop after the one this series used last (S-18 rotation: never the same twice running). */
export async function nextBackdrop(db: StoriesDb, series: Series, setId: string): Promise<Backdrop> {
  const { rows } = await db.query<{ backdrop: Backdrop }>(
    `SELECT f.backdrop FROM stories.sets s JOIN stories.frames f ON f.set_id = s.id AND f.seq = 1
      WHERE s.series = $1 AND s.id <> $2 AND s.status IN ('ready', 'approved', 'scheduled', 'publishing', 'published')
      ORDER BY s.ny_date DESC, s.created_at DESC LIMIT 1`,
    [series, setId],
  );
  const last = rows[0]?.backdrop;
  return last ? BACKDROPS[(BACKDROPS.indexOf(last) + 1) % BACKDROPS.length]! : BACKDROPS[0];
}

/** Turn a frame list into numbered rows. */
export function toFrames(data: FrameData[], backdrop: Backdrop, template: (d: FrameData) => string | null = () => null): NewFrame[] {
  return data.map((d, i) => ({ seq: i + 1, role: d.role, backdrop, copy: d, template: template(d), photo: 'photo' in d ? ((d as { photo?: Photo }).photo ?? null) : 'logo' in d ? ((d as { logo?: Photo }).logo ?? null) : null }));
}

/** Ask the finder, never failing the build over a photo (a type-led frame is fine). */
export async function findPhoto(photos: PhotoFinder, req: PhotoRequest, log: string[]): Promise<Photo | null> {
  try {
    return await photos.find(req);
  } catch (err) {
    log.push(`photo ${req.kind} "${req.query}": ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Short ids for the writer to echo back ("s1", "s2", …), and the way back to
 * the item. A story's key is its URL, and the model does not copy a
 * 300-character Google News slug intact: on 2026-10-19 every story but one
 * came back with a garbled key and was dropped before grounding.
 */
export function shortIds<T>(list: T[], prefix: string): { items: Array<{ id: string; item: T }>; byId: Map<string, T> } {
  const items = list.map((item, i) => ({ id: `${prefix}${i + 1}`, item }));
  return { items, byId: new Map(items.map((x) => [x.id, x.item])) };
}

/** Sentences in a line, skipping abbreviations (the same rule the template uses). */
export function sentenceCount(text: string): number {
  return text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“$])/).filter((s) => !/\b(Gov|Sen|Rep|Dr|Mr|Mrs|Ms|St|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|U\.S|Inc|Corp|No)\.$/.test(s.trim())).length;
}

/** A long weekday date for the opener ("Thursday, October 8"). */
export function openerDate(nyDate: string): string {
  const d = new Date(`${nyDate}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(d);
}
