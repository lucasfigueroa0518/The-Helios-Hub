/**
 * roa-screen@4 (CONTRACT.md §1, R4, RA-6, RA-17, RA-22, RA-23, RA-28): the Jev vision screen.
 * @1 wording approved by Lucas 2026-11-15 (RA-19); clear_subject and off_putting added 2026-11-16 from his lab
 * feedback (RA-22); @3 asks that the subject sit whole and well placed in the frame (RA-23, approved); @4 boxes the
 * subject so the slide text keeps off it (RA-28). Bump the version on any change.
 *
 * One set, asked in up to four calls (screen.ts), each with the image and the
 * experimental images header:
 *   glance  blind (Jev is not told the truth): the 3-second tell, how AI it looks, real people, brands, readable text,
 *           a clear subject, and whether it is off-putting to look at
 *   subject images that passed: where the subject is (`box`, model jev-preview)
 *   close   AI images that passed: is there a subtle tell on close inspection
 *   box     when there is: where it is (`box`, model jev-preview)
 *
 * The five tell categories (RESEARCH.md §1) are worded once here, for the screen only: since RA-26 the reveal
 * never names a tell.
 */
import { box, noul } from '@typesafe-ai/sdk';

import { defineQuestionSet } from '@/lib/reels/jev/question-set';

/** The five kinds of AI tell (Kamali et al.): anatomy, style, function, physics, sociocultural. */
export const TELL_CATEGORIES =
  'anatomy that is wrong, a surface or style too smooth or glossy for a camera, an object that could not work, light, shadows or reflections that break physics, or a detail that would not happen in real life';

/** What Jev is told on the blind glance call. */
export const GLANCE_CONTEXT =
  'The image fills a phone screen in an Instagram Story for about three seconds. The viewer then guesses whether it is a real photograph or an AI-made image.';

/** What Jev is told on the close and box calls (AI images only). */
export const CLOSE_CONTEXT = 'This image is AI-made. It will be shown to viewers who guess whether it is a real photograph or AI-made, and the answer slide will point at one sign that gives it away.';

export const ROA_SCREEN = defineQuestionSet({
  id: 'roa-screen',
  version: 'roa-screen@4',
  questions: {
    glance_tell: noul(
      `Picture a typical viewer glancing at this image for about three seconds on a phone. Would they spot at least one sign that it is AI-made: ${TELL_CATEGORIES}?`,
      { true: 'A sign of AI is visible in a three-second look.', false: 'Nothing visible in a three-second look marks it as AI-made; any sign needs a close look.' },
    ),
    looks_ai: noul('After a three-second look, would a typical viewer guess that this image is AI-made rather than a real photograph?', {
      true: 'Most viewers would guess AI-made.',
      false: 'Most viewers would guess it is a real photograph.',
    }),
    real_person: noul('Does the image show a person who could be identified, or anyone who resembles a specific real person?', {
      true: 'Someone in it could be identified, or looks like a specific real person.',
      false: 'No one in it could be identified: no people, or only small, distant or turned-away figures.',
    }),
    brand: noul('Does the image show a real brand, logo or trademark, or a product recognisable as one specific brand?', {
      true: 'A real brand, logo, trademark or branded product is recognisable.',
      false: 'Nothing in it is recognisable as a specific brand.',
    }),
    readable_text: noul('Does the image contain anything a viewer could read: words, letters or numbers on signs, labels, screens or anywhere else?', {
      true: 'Some text, letters or numbers can be read.',
      false: 'Nothing in it can be read.',
    }),
    clear_subject: noul('Seen on a phone screen at a glance, does this image show one clear subject that a viewer recognises straight away, whole and well placed in the frame?', {
      true: 'One clear subject is recognisable at a glance and sits whole and well placed in the frame.',
      false: 'No clear subject, or it is cut off or pushed to an edge: the frame reads as empty, murky, cropped or confusing at a glance.',
    }),
    off_putting: noul(
      'Would a typical viewer find this image unpleasant or awkward to look at: messy, unappetising, private-feeling, badly framed, blocked by something in front of the lens, or blurred?',
      { true: 'Most viewers would find it unpleasant or awkward to look at.', false: 'Most viewers would find it pleasant, or at least easy, to look at.' },
    ),
    subtle_tell: noul(`Look as closely and as long as needed. Is there one specific spot in this image that shows it is AI-made: ${TELL_CATEGORIES}?`, {
      true: 'One specific spot shows it clearly once you look closely.',
      false: 'No spot shows it clearly, even on close inspection.',
    }),
    tell_box: box('The one spot in this image that shows most clearly, on close inspection, that it is AI-made.'),
    subject_box: box('The main subject of this image: everything a viewer would notice if words were laid over it. Include all of it, tightly; leave out plain background such as open sky, water, ground or walls.'),
  },
});

export type RoaScreenKey = keyof typeof ROA_SCREEN.questions;
export const GLANCE_KEYS = ['glance_tell', 'looks_ai', 'real_person', 'brand', 'readable_text', 'clear_subject', 'off_putting'] as const satisfies readonly RoaScreenKey[];
