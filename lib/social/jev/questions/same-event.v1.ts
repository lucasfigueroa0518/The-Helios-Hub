/**
 * Duplicate grouping (spec §5B "same story, many outlets = 1 candidate").
 * One Jev call per article, one Noul per code-picked neighbour.
 */
import { noul, type Questions } from '@typesafe-ai/sdk';

import { outletName } from '@/lib/social/ingest/select/outlets';
import type { IngestArticle } from '@/lib/social/ingest/select/types';

export const VERSION = 'same-event@1';

export const THRESHOLDS = {
  /** A pair at or above this is the same story. PROVISIONAL until calibrated. */
  SAME_EVENT_MIN: 0.7,
} as const;

const LEDE_CHARS = 600;

const brief = (a: IngestArticle) => ({
  outlet: outletName(a),
  headline: a.headline,
  lede: a.body.slice(0, LEDE_CHARS),
});

/** Question id for neighbour k (ids are code-only; never sent as meaning). */
export const neighbourId = (k: number) => `same_as_${k}`;

export function buildState(article: IngestArticle, neighbours: IngestArticle[]) {
  return { article: brief(article), neighbours: neighbours.map(brief) };
}

export function buildQuestions(neighbourCount: number): Questions {
  const questions: Questions = {};
  for (let k = 0; k < neighbourCount; k++) {
    questions[neighbourId(k)] = noul(
      `Do \`article\` and \`neighbours[${k}]\` report the same news event?`,
      {
        true: 'Both report the same specific event (same announcement, deal, release, ruling or incident).',
        false: 'They are different events, even if they involve the same company, person or topic.',
      },
    );
  }
  return questions;
}
