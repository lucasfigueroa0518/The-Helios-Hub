/**
 * Photo subject identity (spec §5A #5). One Jev call per subject: is the
 * brief's subject a person, and does each Wikidata candidate's description
 * match the brief's description of that subject? Jev also picks among the
 * candidates when the resolver couldn't decide (S2: Musk, Sacks, NSA…).
 *
 * Code consumes the answers (photos/identity.ts): the person answer is the
 * subject type the P31 check compares against.
 */
import { noul, type Questions } from '@typesafe-ai/sdk';

export const VERSION = 'subject-identity@1';

export const THRESHOLDS = {
  /** At or above this, the entry is the brief's subject. Provisional until the checkpoint run. */
  MATCH_MIN: 0.7,
  /** At or above this, the subject is a person; at or below 1 − this, an organization; between, unknown. */
  PERSON_MIN: 0.7,
} as const;

export type IdentityCandidate = { id: string; label: string; description: string };

export function buildState(
  subject: { name: string; role: string | null },
  story: string,
  candidates: IdentityCandidate[],
) {
  return {
    subject: { name: subject.name, role: subject.role ?? '' },
    story,
    candidates: candidates.map((c) => ({ label: c.label, description: c.description })),
  };
}

export const matchId = (k: number) => `match_${k}`;

export function buildQuestions(count: number): Questions {
  const questions: Questions = {
    is_person: noul('Is `subject` an individual person, as `subject.role` and `story` describe them?', {
      true: 'The subject is one individual person.',
      false: 'The subject is a company, agency, organization, product or anything else that is not one person.',
    }),
  };
  for (let k = 0; k < count; k++) {
    questions[matchId(k)] = noul(
      `Is the Wikidata entry \`candidates[${k}]\` the same real-world person or organization as \`subject\`, judging by its description against \`subject.role\` and \`story\`?`,
      {
        true: 'Same entity: the entry\'s description fits who or what the story says the subject is.',
        false: 'A different entity that only shares the name, a different type of thing (a word, a concept, a place, a film), or the description contradicts the story.',
      },
    );
  }
  return questions;
}
