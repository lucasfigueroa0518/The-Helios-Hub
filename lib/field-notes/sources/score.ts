/**
 * Jev scoring and tagging for Field Notes candidates (CONTRACT-v4 section 3). One call asks the scored
 * questions and the tags together. Transport is injected (tests stub it); nothing here talks to the
 * network. Refuses to run until the question wording is approved (`questionsApproved` in config).
 *
 *   score   = weighted mean of FIELD_NOTES_SCORE_WEIGHTS (value, concrete_result, single_subject 1; lesser_known, past_basics 0.75)
 *             x WANT_WEIGHTS[want] x (about_ai >= ABOUT_AI_THRESHOLD ? 1 : 0)   (field-notes-score@3: a non-AI tip scores 0)
 *   leaf, want, tier  = the top `choice` (null when Jev returns no known option)
 *   purposes = every for_* question at PURPOSE_THRESHOLD or above
 *   fresh    = new_enough at FRESH_THRESHOLD or above (a tag only: it never changes the score)
 */
import type { EntryType } from '@typesafe-ai/sdk';

import { jevUsd, type JevTransport } from '@/lib/reels/jev/runner';
import { CONTENT_LEAVES, KNOW_HOW_TIERS, PURPOSES, WANT_WEIGHTS, WANTS, type ContentLeaf, type KnowHowTier, type Purpose, type Want } from '@/lib/field-notes/types';
import type { TipCandidate } from './candidate';
import { FIELD_NOTES_SOURCES_CONFIG, type FieldNotesSourcesConfig } from './config';
import {
  ABOUT_AI_KEY,
  ABOUT_AI_THRESHOLD,
  FIELD_NOTES_PURPOSE_KEYS,
  FIELD_NOTES_QUESTION_KEYS,
  FIELD_NOTES_SCORE,
  FIELD_NOTES_SCORED_KEYS,
  FIELD_NOTES_SCORE_WEIGHTS,
  FRESH_THRESHOLD,
  PURPOSE_THRESHOLD,
} from './questions';

export class QuestionsNotApprovedError extends Error {
  constructor() {
    super('Field Notes scoring is off: question wording is not approved yet (questionsApproved is false; Tommy approves for Lucas).');
    this.name = 'QuestionsNotApprovedError';
  }
}

/** The tags scoring puts on a tip (Tip's fields of the same names). */
export type TipTags = {
  leaf: ContentLeaf | null;
  want: Want | null;
  tier: KnowHowTier | null;
  purposes: Purpose[];
  fresh: boolean;
};

export type ScoredCandidate = TipTags & {
  candidate: TipCandidate;
  /** 0 to 1: the weighted mean of the scored answers times the want's weight; 0 when the AI gate says no. */
  score: number;
  /** Every noul answer (0-1) and each choice's confidence, by question key. */
  answers: Record<string, number>;
  usd: number;
  questionSetVersion: string;
};

/** The state Jev sees: trusted metadata outside, scraped text only under untrusted_content. */
export function buildScoreState(candidate: TipCandidate, today: string): EntryType {
  return {
    today,
    source_kind: candidate.sourceKind,
    published: candidate.publishedAt,
    candidate: { untrusted_content: candidate.untrustedContent },
  } as unknown as EntryType;
}

function noulOf(answer: unknown): number {
  const n = typeof answer === 'number' ? answer : (answer as { noul?: unknown } | null | undefined)?.noul;
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

function choiceOf<T extends string>(answer: unknown, options: readonly T[]): { choice: T | null; confidence: number } {
  const a = answer as { choice?: unknown; confidence?: unknown } | null | undefined;
  const c = options.find((o) => o === a?.choice) ?? null;
  const conf = typeof a?.confidence === 'number' && Number.isFinite(a.confidence) ? Math.min(1, Math.max(0, a.confidence)) : 0;
  return { choice: c, confidence: c ? conf : 0 };
}

/** The want's weight; an untagged want counts at full weight (nothing to discount it by). */
export const wantWeight = (want: Want | null): number => (want ? WANT_WEIGHTS[want] : 1);

/** Score and tags from Jev's raw answers. Pure: the score test drives it directly. */
export function scoreFromAnswers(raw: Record<string, unknown>): TipTags & { score: number; answers: Record<string, number> } {
  const answers: Record<string, number> = {};
  for (const key of FIELD_NOTES_QUESTION_KEYS) {
    if (FIELD_NOTES_SCORE.questions[key].type === 'noul') answers[key] = noulOf(raw[key]);
  }
  const leaf = choiceOf(raw.leaf, CONTENT_LEAVES);
  const want = choiceOf(raw.want, WANTS);
  const tier = choiceOf(raw.tier, KNOW_HOW_TIERS);
  answers.leaf = leaf.confidence;
  answers.want = want.confidence;
  answers.tier = tier.confidence;

  let total = 0;
  let weights = 0;
  for (const k of FIELD_NOTES_SCORED_KEYS) {
    total += answers[k]! * FIELD_NOTES_SCORE_WEIGHTS[k];
    weights += FIELD_NOTES_SCORE_WEIGHTS[k];
  }
  const mean = weights > 0 ? total / weights : 0;
  // The AI gate is a multiplier, not a term of the mean: a non-AI tip scores 0 however well it answers the rest.
  const aiGate = answers[ABOUT_AI_KEY]! >= ABOUT_AI_THRESHOLD ? 1 : 0;
  return {
    score: mean * wantWeight(want.choice) * aiGate,
    answers,
    leaf: leaf.choice,
    want: want.choice,
    tier: tier.choice,
    purposes: PURPOSES.filter((p) => answers[FIELD_NOTES_PURPOSE_KEYS[p]]! >= PURPOSE_THRESHOLD),
    fresh: answers.new_enough! >= FRESH_THRESHOLD,
  };
}

export async function scoreCandidate(
  candidate: TipCandidate,
  deps: { transport: JevTransport; today: string; config?: FieldNotesSourcesConfig },
): Promise<ScoredCandidate> {
  const config = deps.config ?? FIELD_NOTES_SOURCES_CONFIG;
  if (!config.questionsApproved) throw new QuestionsNotApprovedError();

  const result = await deps.transport.systemOne(buildScoreState(candidate, deps.today), FIELD_NOTES_SCORE.questions);
  return {
    candidate,
    ...scoreFromAnswers(result.answers as Record<string, unknown>),
    usd: jevUsd(result.usage.input_tokens),
    questionSetVersion: FIELD_NOTES_SCORE.version,
  };
}

/** Scores in order; the approval gate is checked once up front so nothing is half-run. */
export async function scoreCandidates(
  candidates: readonly TipCandidate[],
  deps: { transport: JevTransport; today: string; config?: FieldNotesSourcesConfig },
): Promise<ScoredCandidate[]> {
  if (!(deps.config ?? FIELD_NOTES_SOURCES_CONFIG).questionsApproved) throw new QuestionsNotApprovedError();
  const out: ScoredCandidate[] = [];
  for (const c of candidates) out.push(await scoreCandidate(c, deps));
  return out;
}
