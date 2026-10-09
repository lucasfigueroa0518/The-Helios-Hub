/**
 * What every series builder shares: its dependencies, its result, backdrop
 * and layout rotation, and photo helpers.
 */
import type { StoriesDb } from '@/lib/stories/db';
import type { StoriesJev } from '@/lib/stories/jev';
import type { PhotoFinder, PhotoRequest } from '@/lib/stories/photos';
import type { OpenPool } from '@/lib/stories/pool';
import { BACKDROPS, type Backdrop, type FrameData, type Photo, type Series } from '@/lib/stories/render/types';
import type { NewCandidate, NewFrame } from '@/lib/stories/repository';
import type { StoriesSettings } from '@/lib/stories/settings';
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
};

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

/** Sentences in a line, skipping abbreviations (the same rule the template uses). */
export function sentenceCount(text: string): number {
  return text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“$])/).filter((s) => !/\b(Gov|Sen|Rep|Dr|Mr|Mrs|Ms|St|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|U\.S|Inc|Corp|No)\.$/.test(s.trim())).length;
}

/** A long weekday date for the opener ("Thursday, October 8"). */
export function openerDate(nyDate: string): string {
  const d = new Date(`${nyDate}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(d);
}
