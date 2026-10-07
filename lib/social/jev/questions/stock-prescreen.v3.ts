/**
 * Stock photo pre-screen v3 (Tommy, 2026-10-06; link B, tested on the
 * photo-finder bench). Changes from v2:
 *
 *   LANDMARK reworded: v2 rejected every fitting "data center" photo as a
 *   landmark (0.78–0.92). A named but ordinary building, facility or room
 *   is not a landmark.
 *   BRAND (new): reject a result whose title or tags name a company, brand
 *   or organization that isn't among the story's SUBJECTS (a stock photo
 *   must not suggest a company the story isn't about).
 *
 * Jev reads metadata only, never the image. Code consumes the answers
 * (photos/find.ts): the first result that fits, likely shows no one, no
 * landmark and no outside brand is used.
 */
import { noul, type Questions } from '@typesafe-ai/sdk';

export const VERSION = 'stock-prescreen@3';

export const THRESHOLDS = {
  /** At or above this, the result fits the scene. Provisional. */
  FIT_MIN: 0.5,
  /** At or above this, a person is likely visible: rejected (wrong-person class, so strict). Provisional. */
  PEOPLE_MAX: 0.3,
  /** At or above this, a landmark a typical reader would recognize: rejected. Provisional. */
  LANDMARK_MAX: 0.5,
  /** At or above this, the title or tags name an outside company, brand or organization: rejected. Provisional. */
  BRAND_MAX: 0.5,
} as const;

/** Results shown per call. */
export const MAX_CANDIDATES = 8;

export type PrescreenCandidate = { title: string; tags: string[]; source: string };

/** `story_subjects`: the brief's SUBJECTS names (people and organizations the story is about). */
export function buildState(scene: string, candidates: PrescreenCandidate[], subjects: string[]) {
  return { requested_scene: scene, story_subjects: subjects, candidates };
}

export const fitId = (k: number) => `fits_${k}`;
export const peopleId = (k: number) => `people_${k}`;
export const landmarkId = (k: number) => `landmark_${k}`;
export const brandId = (k: number) => `brand_${k}`;

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
      `Judging by its title and tags, would a typical reader recognize this exact place in the photo \`candidates[${k}]\` by sight (a famous landmark, capitol, monument or famous skyline)? A named but ordinary building, facility or room is not a landmark.`,
      {
        true: 'A famous landmark, capitol, monument or famous skyline that a typical reader would recognize by sight.',
        false: 'A generic scene, object, or a named but ordinary building, facility or room.',
      },
    );
    questions[brandId(k)] = noul(
      `Do the title or tags of the photo \`candidates[${k}]\` name a company, brand or organization that isn't among \`story_subjects\`?`,
      {
        true: 'The title or tags name a company, brand or organization (a maker, operator, owner, agency or institution) that is not in `story_subjects`.',
        false: 'The title and tags name no company, brand or organization, or only ones in `story_subjects`.',
      },
    );
  }
  return questions;
}
