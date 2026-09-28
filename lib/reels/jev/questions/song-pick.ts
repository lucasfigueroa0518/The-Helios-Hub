import { choice, type ChoiceCriteria } from '@typesafe-ai/sdk';

import { SONG_SHORTLIST_SIZE } from '@/lib/reels/config';
import { defineQuestionSet } from '@/lib/reels/jev/question-set';

/**
 * P-13, approved 2026-09-28 (D-192). One Choice over the 12 shortlisted
 * songs, with no escape option: Jev must pick one (D-149), and code always uses
 * the pick (D-151).
 *
 * The options change every reel, so the question is built per call. The
 * version covers the wording and the layout, not the songs.
 *
 * Each song is an option labeled `song_1` to `song_12`, and its description is
 * its MUS-09 tags only (D-144, D-184). Title and artist are left out: they are
 * not tags, and they are scraped text. Options go in shortlist order, most
 * similar first (D-185).
 */

export const SONG_PICK_VERSION = 'song-pick-v1';

export type SongOption = { genre: string; bpm: number | null; instruments: string[]; vibes: string[] };

const INSTRUCTIONS = {
  question: 'How well does this song match the vibe of the copy in an Instagram reel context?',
  state:
    '`on_screen_copy` is the exact text the viewer reads over the video. `caption_body` is the caption under the reel, without its call to action or hashtags.',
  judge:
    'Pick the one song whose genre, tempo, instruments, and vibe best fit the feeling of the copy as a viewer scrolling Instagram reels would take it in. Match the mood and energy of what the copy says, not individual words.',
};

export function songPickSet(songs: ReadonlyArray<SongOption>) {
  if (songs.length !== SONG_SHORTLIST_SIZE) {
    throw new Error(`Song pick needs exactly ${SONG_SHORTLIST_SIZE} songs, got ${songs.length}`);
  }
  const criteria: ChoiceCriteria = {};
  songs.forEach((song, index) => {
    criteria[`song_${index + 1}`] = {
      genre: song.genre,
      bpm: song.bpm,
      instruments: song.instruments,
      vibes: song.vibes,
    };
  });
  return defineQuestionSet({
    id: 'song-pick',
    version: SONG_PICK_VERSION,
    questions: { song: choice(INSTRUCTIONS, criteria) },
  });
}

export function songPickState(input: { onScreenCopy: string; captionBody: string }) {
  return { on_screen_copy: input.onScreenCopy.trim(), caption_body: input.captionBody.trim() };
}
