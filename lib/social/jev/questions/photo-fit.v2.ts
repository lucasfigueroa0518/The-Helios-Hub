/**
 * Photo fit v2 (2026-10-08, seventh round; Lucas: homonym photos, a medical
 * lab for an AI lab, a concert hall for a lecture hall): v1 plus the story's
 * one-line news (`story`), so "in the sense the request means" is the
 * story's sense. Everything else is v1's: do a candidate tile's tags (from
 * the Haiku sheet call) show what the slide asked for?
 *
 * Jev reads text only: the request and the tags, never the image. Code
 * consumes the answers (photos/pick.ts): a candidate below FIT_MIN is not
 * used. Verified photos (people, logos, company photos, captioned article
 * photos) are never asked: the fit check never judges who or what they are.
 */
import { noul, type Questions } from '@typesafe-ai/sdk';

import type { JevAsk } from '@/lib/social/jev/client';

export const VERSION = 'photo-fit@2';

export const THRESHOLDS = {
  /** At or above this, the tags show what was asked for. Provisional. */
  FIT_MIN: 0.5,
} as const;

/** Tiles per call. */
export const MAX_TILES = 8;

export type FitTile = { request_kind: string; request: string; tags: string[] };

/** `story`: the news the photos are for, in one line (the brief's THE NEWS). */
export function buildState(tiles: FitTile[], story: string) {
  return { story, tiles };
}

export const fitId = (k: number) => `fits_${k}`;

export function buildQuestions(count: number): Questions {
  const questions: Questions = {};
  for (let k = 0; k < count; k++) {
    questions[fitId(k)] = noul(
      `Do the tags in \`tiles[${k}].tags\` describe a photo that shows what \`tiles[${k}].request\` asks for (a ${'`'}tiles[${k}].request_kind${'`'}), in the sense the news in \`story\` means?`,
      {
        true: 'The tags describe the requested thing, scene, place, product or event, in the sense the request means for this story.',
        false: 'The tags describe something else, or the same word in a different sense than the story means (a fruit for a company, an animal for a programming language, a medical lab for a computing lab), or a blank tile.',
      },
    );
  }
  return questions;
}

/** One Jev call over up to MAX_TILES tiles: each tile's fit probability, in order. */
export async function photoFitScores(jev: JevAsk, tiles: FitTile[], story: string): Promise<number[]> {
  const res = await jev({ state: buildState(tiles, story), questions: buildQuestions(tiles.length) }, { version: VERSION, subjectId: tiles.map((t) => t.request).join(' | ').slice(0, 120) });
  return tiles.map((_, k) => res.answers[fitId(k)]?.noul ?? 0);
}
