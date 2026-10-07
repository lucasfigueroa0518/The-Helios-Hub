/**
 * Headquarters check v1 (photo spec §2; Tommy, 2026-10-07, fifth round): an
 * organization's Wikidata main photo (P18) is used as its headquarters only
 * when the Commons file's title and description describe the organization's
 * building or offices ("Pioneer Building, San Francisco (2019)" for OpenAI).
 * Product shots, people, events and screenshots fail.
 *
 * Jev reads metadata only, never the image. Not the stock vision check: its
 * "named building or institution" question rejects a headquarters by design.
 */
import { noul, type Questions } from '@typesafe-ai/sdk';

export const VERSION = 'org-hq@1';

export const THRESHOLDS = {
  /** At or above this, the file shows the organization's building. Provisional. */
  HQ_MIN: 0.6,
  /** At or above this, a person is likely the subject: rejected. Provisional. */
  PEOPLE_MAX: 0.3,
} as const;

export const HQ_ID = 'is_headquarters';
export const PEOPLE_ID = 'shows_people';

export function buildState(organization: string, file: { title: string; description: string }) {
  return { organization, file_title: file.title, file_description: file.description };
}

export function buildQuestions(): Questions {
  return {
    [HQ_ID]: noul('Judging by `file_title` and `file_description`, is this photo of the building or offices of `organization` (its headquarters, campus or an office it occupies)?', {
      true: 'The title or description names a building, campus, office or headquarters, and it belongs to the organization (or the organization is known to occupy it).',
      false: 'It shows something else: a product, a logo, a screenshot, people, an event, a vehicle, or a building that is not the organization\'s.',
    }),
    [PEOPLE_ID]: noul('Judging by `file_title` and `file_description`, is a person the main subject of this photo?', {
      true: 'The title or description names a person, a group of people, a speech, a meeting or an event with attendees.',
      false: 'It describes only a building, a place or an object.',
    }),
  };
}
