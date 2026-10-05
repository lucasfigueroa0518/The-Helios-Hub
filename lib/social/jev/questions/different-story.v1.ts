/**
 * Winners must be different stories (spec §5B): if #1 and #2 are about the
 * same company or topic, the next one moves up. One Jev call, one Noul per
 * shortlisted candidate after #1. Replaces the old Haiku-field comparison.
 */
import { noul, type Questions } from '@typesafe-ai/sdk';

import type { StoryGroup } from '@/lib/social/ingest/select/types';

export const VERSION = 'different-story@1';

export const THRESHOLDS = {
  /** At or above this, the candidate is the same company/topic as #1. Calibrated from live run reports (§2.3). */
  SAME_TOPIC_MIN: 0.5,
} as const;

const LEDE_CHARS = 600;

const brief = (g: StoryGroup) => ({ headline: g.representative.headline, lede: g.body.slice(0, LEDE_CHARS) });

export const candidateId = (k: number) => `same_topic_${k}`;

export function buildState(first: StoryGroup, others: StoryGroup[]) {
  return { first: brief(first), candidates: others.map(brief) };
}

export function buildQuestions(count: number): Questions {
  const questions: Questions = {};
  for (let k = 0; k < count; k++) {
    questions[candidateId(k)] = noul(
      `Is \`candidates[${k}]\` about the same main company or the same topic as \`first\`?`,
      {
        true: 'Both stories centre on the same company, or on the same topic, so posting both would feel repetitive.',
        false: 'They centre on different companies and different topics.',
      },
    );
  }
  return questions;
}
