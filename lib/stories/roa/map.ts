/**
 * The Real or AI? content map (PLAN.md Stage 4, RESEARCH.md §4): subject × trap.
 * The trap decides the round's truth (types.ts TRAP_TRUTH); a twin makes a real
 * photo and its AI twin. The writer (roa-write@3) reads the descriptions below
 * in its system prompt and today's pool mix in its material.
 *
 * Descriptions name classes of scene, never a specific object or place.
 */
import type { Queryable } from '@/lib/stories/db';

import { ROA_SERIES, SUBJECTS, TRAPS, type Subject, type Trap, type Truth } from './types';

export const SUBJECT_TEXT: Record<Subject, string> = {
  nature_weather: 'landscapes, skies, water and weather',
  animals: 'wild or domestic animals, with no people in view',
  cities_architecture: 'streets, buildings and city views',
  food: 'dishes, ingredients and drinks',
  everyday_interiors: 'tidy, inviting rooms and the things in them, in good light',
  travel_spots: 'places people visit, seen as a visitor would',
  space: 'spaceflight and astronomy where the subject is bright and fills the frame (sunlit planets and moons, Earth from orbit, launches and hardware by day), with no people in view',
  vehicles: 'cars, trains, boats, aircraft and other transport',
  crowds_events: 'gatherings seen from a distance, where no one can be identified',
  old_photos: 'scenes photographed decades ago, with the look of an old print',
};

export const TRAP_TEXT: Record<Trap, string> = {
  too_perfect: 'a real photograph that looks too clean, too symmetrical, too saturated or too perfectly timed to be real',
  impossible: 'a real photograph of something that seems physically unlikely: a rare natural event, extreme light or colour, an odd coincidence, a strange scale',
  mundane: 'an AI image of an everyday scene worth a photo, taken as a good casual phone picture in natural light',
  amateur: "an AI image styled as a keen hobbyist's photo: a real camera's look and natural light on a scene the photographer chose to capture",
  twin: 'a real photograph and an AI image made to match its scene (one real image and one AI image)',
};

export const cellId = (subject: Subject, trap: Trap) => `${subject}.${trap}`;
export const ALL_CELLS = SUBJECTS.flatMap((subject) => TRAPS.map((trap) => ({ subject, trap, id: cellId(subject, trap) })));

export type PoolMix = Record<Subject, Record<Truth, number>>;

/** Open real_or_ai pool rows by subject and truth (read-only; only this series' own rows). */
export async function readPoolMix(db: Queryable): Promise<PoolMix> {
  const mix = Object.fromEntries(SUBJECTS.map((s) => [s, { real: 0, ai: 0 }])) as PoolMix;
  const { rows } = await db.query<{ subject: string | null; truth: string | null; n: string | number }>(
    `SELECT payload->'c'->>'subject' AS subject, payload->'c'->>'truth' AS truth, count(*) AS n
       FROM stories.pool WHERE series = $1 AND used_at IS NULL AND key LIKE 'roa:%'
      GROUP BY 1, 2`,
    [ROA_SERIES],
  );
  for (const r of rows) {
    const s = r.subject as Subject;
    if (mix[s] && (r.truth === 'real' || r.truth === 'ai')) mix[s][r.truth] = Number(r.n) || 0;
  }
  return mix;
}

/** The subjects with the fewest open rows (ties in map order): today's preference for the writer. */
export function thinSubjects(mix: PoolMix, n = 4): Subject[] {
  return [...SUBJECTS].sort((a, b) => mix[a].real + mix[a].ai - (mix[b].real + mix[b].ai) || SUBJECTS.indexOf(a) - SUBJECTS.indexOf(b)).slice(0, n);
}
