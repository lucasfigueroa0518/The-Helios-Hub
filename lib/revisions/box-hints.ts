import type { Vertical } from '@/lib/social-hub/types';

import type { FixKind } from './types';

/**
 * What the revision box tells a person about their own content type: a sample sentence (the textarea's
 * placeholder) and what can be changed, in the type's own words. Pure (type-only imports), so the browser
 * box can use it without pulling the per-type descriptions in. Each type's `can` kinds must match its
 * description's fixKinds: tests/revisions-box-hints.test.ts compares them to the registry.
 */
export type BoxHints = {
  example: string;
  can: ReadonlyArray<{ kind: FixKind; text: string }>;
};

export const BOX_HINTS: Record<Vertical, BoxHints> = {
  carousels: {
    example: 'Slide 3’s headline is too long',
    can: [
      { kind: 'photo', text: 'a slide’s photo' },
      { kind: 'wording', text: 'a headline or sentence' },
      { kind: 'color', text: 'a slide’s background' },
      { kind: 'layout', text: 'a slide’s layout' },
    ],
  },
  stories: {
    example: 'Frame 3 repeats frame 1’s photo',
    can: [
      { kind: 'photo', text: 'a frame’s photo' },
      { kind: 'wording', text: 'a story headline' },
      { kind: 'color', text: 'a frame’s background' },
      { kind: 'layout', text: 'a photo crop' },
    ],
  },
  last_few_days: {
    example: 'The photo on story 2 shows the wrong company',
    can: [
      { kind: 'photo', text: 'a story’s photo' },
      { kind: 'wording', text: 'a story’s words' },
      { kind: 'layout', text: 'a photo crop' },
    ],
  },
  ai_events: {
    example: 'The host’s name on slide 1 is misspelled',
    can: [
      { kind: 'photo', text: 'a slide’s photo' },
      { kind: 'wording', text: 'the title, host or place' },
      { kind: 'layout', text: 'a slide’s layout' },
    ],
  },
  reels: {
    example: 'The words on screen run too long',
    can: [
      { kind: 'wording', text: 'the words on screen' },
      { kind: 'photo', text: 'the background image' },
      { kind: 'motion', text: 'the video’s movement' },
      { kind: 'color', text: 'the color grade' },
    ],
  },
  explainers: {
    example: 'Scene 3 shows the wrong chart',
    can: [
      { kind: 'wording', text: 'the caption or a scene’s words' },
      { kind: 'photo', text: 'a scene’s picture' },
      { kind: 'color', text: 'a scene’s colors' },
      { kind: 'layout', text: 'a scene’s layout' },
    ],
  },
};

/** "a slide’s photo, a headline or sentence, a slide’s background and a slide’s layout". */
export function canChangeText(vertical: Vertical): string {
  const items = BOX_HINTS[vertical].can.map((c) => c.text);
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
