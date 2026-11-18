import { noul } from '@typesafe-ai/sdk';

import { defineQuestionSet } from '@/lib/reels/jev/question-set';

/**
 * The wear check (VISUAL_SYSTEM_6.md § 4, § 6; D89: weak critter designs fall back to the bare critter).
 * One vision call per reel, inside a render a human started (CLAUDE.md Rule 1), on a contact sheet of
 * the reel's cast: each critter alone on paper, wearing exactly what its role draws. Two yes/no
 * questions per critter, read as probabilities; code applies the thresholds, never the model
 * (lib/explainers/render/job.ts runWearCheck). `{role}` is filled per critter in the request, never
 * in the cached instructions.
 */
export const WEAR_QUESTIONS = {
  reads_as_role: {
    question: 'Looking only at this character, would most viewers say it is a {role} (or a close synonym)?',
    judge:
      'Look at the character alone, as a stranger scrolling past would, without the role name. Answer yes when what it wears on its head and holds in its hands would make most viewers name that role or a close synonym within a second; answer no when they would name another role, or could not name one.',
  },
  confusing_piece: {
    question: 'Is any item on this character hard to identify, or does anything look like a mouth, teeth, eyebrows or another face part?',
    judge:
      'The character has eyes and nothing else on its face, by design. Answer yes when any head piece or held prop cannot be named at a glance, or when any shape on or near the body reads as a mouth, teeth, eyebrows or another face part; answer no when every item is clear and the face is only the eyes.',
  },
} as const;

export const WEAR_CHECK = defineQuestionSet({
  id: 'explainers-wear-check',
  version: 'explainers-wear-check-v1',
  questions: {
    reads_as_role: noul({ ...WEAR_QUESTIONS.reads_as_role }),
    confusing_piece: noul({ ...WEAR_QUESTIONS.confusing_piece }),
  },
});

/** The state each critter is judged with: its number on the contact sheet and its role. */
export const WEAR_CHECK_FIELDS = ['n', 'role'] as const;

/** A critter keeps its role's wear only when it reads as the role at least this likely… */
export const READS_AS_ROLE_MIN = 0.6;
/** …and nothing on it confuses at this likelihood or more. */
export const CONFUSING_PIECE_MAX = 0.4;

export type WearAnswers = { reads_as_role: number; confusing_piece: number };

/** Whether a critter's wear passes (VISUAL_SYSTEM_6.md § 4, § 6). */
export const wearPasses = (r: WearAnswers): boolean => r.reads_as_role >= READS_AS_ROLE_MIN && r.confusing_piece < CONFUSING_PIECE_MAX;
