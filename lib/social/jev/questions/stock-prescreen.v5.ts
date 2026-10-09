/**
 * Stock photo pre-screen v5 (2026-10-08, seventh round; Lucas: homonym
 * photos, a medical lab for an AI lab, a concert hall for a lecture hall):
 * v4 plus the story's one-line news (`story`), so the fit question judges
 * the words in the sense the story means. Everything else is v4's.
 *
 * Jev reads metadata only, never the image. Code consumes the answers
 * (photos/sources/stock.ts): results that fit and likely show no one go on
 * to the vision check, in order.
 */
import { noul, type Questions } from '@typesafe-ai/sdk';

export const VERSION = 'stock-prescreen@5';

export const THRESHOLDS = {
  /** At or above this, the result fits the scene. Provisional. */
  FIT_MIN: 0.5,
  /** At or above this, a person is likely visible: rejected (wrong-person class, so strict). Provisional. */
  PEOPLE_MAX: 0.3,
} as const;

/** Results shown per call. */
export const MAX_CANDIDATES = 8;

export type PrescreenCandidate = { title: string; tags: string[]; source: string };

/** `story`: the news the photo is for, in one line (the brief's THE NEWS). */
export function buildState(scene: string, candidates: PrescreenCandidate[], story: string) {
  return { story, requested_scene: scene, candidates };
}

export const fitId = (k: number) => `fits_${k}`;
export const peopleId = (k: number) => `people_${k}`;

export function buildQuestions(count: number): Questions {
  const questions: Questions = {};
  for (let k = 0; k < count; k++) {
    questions[fitId(k)] = noul(
      `Judging by its title and tags, does the photo \`candidates[${k}]\` show the scene in \`requested_scene\`, in the sense the news in \`story\` means?`,
      {
        true: 'The title and tags describe the requested scene, in the story\'s sense, or something a reader of the story would accept as it.',
        false: 'The title and tags describe something else (a different place, object or event), or the same words in another sense than the story means.',
      },
    );
    questions[peopleId(k)] = noul(
      `Judging by its title and tags, is any person likely visible in the photo \`candidates[${k}]\`?`,
      {
        true: 'A person is likely visible: the title or tags name people, a role, a unit or team, an activity someone does (maintenance, training, a ceremony, a meeting, a class), or an event with attendees.',
        false: 'It describes only places, buildings, objects, landscapes or abstract scenes, with nothing suggesting a person.',
      },
    );
  }
  return questions;
}
