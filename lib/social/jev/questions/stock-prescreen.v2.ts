/**
 * Stock photo pre-screen (spec §5A #6; approved by Tommy 2026-10-06 after
 * the checkpoint showed people in stock results). One Jev call per stock
 * search: for each result, does its title and tags fit the requested scene,
 * is a person likely visible, and (v2, Tommy 2026-10-06) does it show a
 * recognizable landmark or specific place? Jev reads metadata only, never
 * the image.
 *
 * Code consumes the answers (photos/find.ts): the first result that fits,
 * likely shows no one and no recognizable landmark is used; otherwise the next search, then the
 * starter set.
 */
import { noul, type Questions } from '@typesafe-ai/sdk';

export const VERSION = 'stock-prescreen@2';

export const THRESHOLDS = {
  /** At or above this, the result fits the scene. Provisional. */
  FIT_MIN: 0.5,
  /** At or above this, a person is likely visible: rejected (wrong-person class, so strict). Provisional. */
  PEOPLE_MAX: 0.3,
  /** At or above this, a recognizable landmark or specific place is likely shown: rejected (stock is literal and neutral). Provisional. */
  LANDMARK_MAX: 0.5,
} as const;

/** Results shown per call. */
export const MAX_CANDIDATES = 8;

export type PrescreenCandidate = { title: string; tags: string[]; source: string };

export function buildState(scene: string, candidates: PrescreenCandidate[]) {
  return { requested_scene: scene, candidates };
}

export const fitId = (k: number) => `fits_${k}`;
export const peopleId = (k: number) => `people_${k}`;
export const landmarkId = (k: number) => `landmark_${k}`;

export function buildQuestions(count: number): Questions {
  const questions: Questions = {};
  for (let k = 0; k < count; k++) {
    questions[fitId(k)] = noul(
      `Judging by its title and tags, does the photo \`candidates[${k}]\` show the scene in \`requested_scene\`?`,
      {
        true: 'The title and tags describe the requested scene or something a reader would accept as it.',
        false: 'The title and tags describe something else (a different place, object or event).',
      },
    );
    questions[peopleId(k)] = noul(
      `Judging by its title and tags, is any person likely visible in the photo \`candidates[${k}]\`?`,
      {
        true: 'A person is likely visible: the title or tags name people, a role, a unit or team, an activity someone does (maintenance, training, a ceremony, a meeting, a class), or an event with attendees.',
        false: 'It describes only places, buildings, objects, landscapes or abstract scenes, with nothing suggesting a person.',
      },
    );
    questions[landmarkId(k)] = noul(
      `Judging by its title and tags, does the photo \`candidates[${k}]\` show a recognizable landmark or a specific named place?`,
      {
        true: 'It names a landmark, a famous building, a named city skyline, a named street or square, or another specific place a reader could recognize.',
        false: 'A generic scene or object that could be anywhere.',
      },
    );
  }
  return questions;
}
