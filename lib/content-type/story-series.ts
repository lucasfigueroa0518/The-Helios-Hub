import { isStoryVertical, SERIES_OF_VERTICAL, STORY_TYPE_LABEL, STORY_VERTICALS, verticalOfSeries } from '@/lib/social-hub/story-types';
import type { Vertical } from '@/lib/social-hub/types';

/**
 * The Stories series, as the buttons, drawers, cards and descriptions name them: the one label map the hub's
 * copies collapsed into (SS-1). A live series reads as its type's label (lib/social-hub/story-types.ts); the
 * retired ones (Guess the Number, AT-14; Free vs. Paid, RA-10) keep their names so their sets on record still read.
 */
export const SERIES_LABEL: Readonly<Record<string, string>> = Object.freeze({
  ...Object.fromEntries(STORY_VERTICALS.map((v) => [SERIES_OF_VERTICAL[v], STORY_TYPE_LABEL[v]])),
  guess_the_number: 'Guess the Number',
  free_vs_paid: 'Free vs. Paid',
});

/** A series' name; an unknown key reads as itself. */
export const seriesLabel = (series: string): string => SERIES_LABEL[series] ?? series;

/**
 * Whether a hub idea id is this type's. Ids start with their type (`carousels:…`), except a Stories pool idea,
 * which keeps `stories:pool:<series>:<key>` for every Stories-format type (SS-1) and is its series' type's.
 */
export function ideaOfType(vertical: Vertical, ideaId: string): boolean {
  if (!isStoryVertical(vertical)) return ideaId.startsWith(`${vertical}:`);
  if (!ideaId.startsWith('stories:')) return false;
  const m = /^stories:pool:([a-z_]+):/.exec(ideaId);
  return m ? verticalOfSeries(m[1]) === vertical : vertical === 'stories';
}
