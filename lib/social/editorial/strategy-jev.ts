import { TypeSafeClient, noul } from '@typesafe-ai/sdk';

import { jevCostUsd } from '@/lib/social/editorial/config';
import type { ChosenHook } from '@/lib/social/editorial/hook-mine';
import type { FactSheet } from '@/lib/social/editorial/fact-sheet';
import type { BucketId } from '@/lib/social/editorial/strategy';

/**
 * Jev-backed sub-call for Stage 3.
 *
 * Handles the two multi-way decisions in the strategy stage:
 *   1. value_type — knowledge vs entertainment (binary Noul)
 *   2. bucket — which of the 7 storytelling shapes fits (7 chained Nouls,
 *      pick the highest fit)
 *
 * Sonnet still handles the 1-5 arousal/curiosity/knowledge scoring and the
 * bucket/value/strategy reason lines, because those are judgment calls that
 * benefit from Sonnet's reasoning. Splitting the stage in half saves ~50%
 * on the Sonnet cost per article (Sonnet input drops to only what it still
 * has to reason about).
 *
 * One systemOne call — 8 Nouls in a single request keeps the round-trip
 * overhead flat vs. the previous single-Sonnet call.
 */

// Lazy singleton — instantiating TypeSafeClient at module load throws when
// TYPESAFE_API_KEY is missing, which blocks the whole strategy stage from
// even importing. Defer to first use so callers can guard on env presence.
let cachedClient: TypeSafeClient | null = null;
function client(): TypeSafeClient {
  if (!cachedClient) cachedClient = new TypeSafeClient();
  return cachedClient;
}

export function jevAvailable(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY);
}

const VALUE_TYPE_INSTRUCTIONS = `A carousel post's value type describes what the reader takes away.

- KNOWLEDGE: the reader walks away smarter or better-informed — new capability, mechanism explained, a benchmark, a cost anchor. Saves them time or money, or changes how they think.
- ENTERTAINMENT: the reader walks away with a story to retell — a fight, a shock, a personality, a comeuppance. Awe, drama, outrage, intrigue.

Judge the article + chosen hook. If both readings fit, prefer the one the CHOSEN HOOK signals more strongly.`;

const BUCKET_INSTRUCTIONS = {
  what_just_happened:
    'WHAT JUST HAPPENED — Straight news event with one primary actor and clean cause-and-effect. Reader wants the facts and the "what changed." Best when the story is a single announcement/incident/move without deep implications.',
  the_bigger_story:
    'THE BIGGER STORY — The surface fact points at a bigger consequence the article hints at but doesn\'t lead with. Frame-shift hook. Best when second_order consequences are more interesting than the announcement itself (e.g. an IPO story that\'s really about wealth distribution).',
  power_play:
    'POWER PLAY — Named actors set against each other, stakes on both sides. Rivalry, government vs industry, one lab vs another. Best when the story is a fight with sides.',
  person_profile:
    'PERSON PROFILE — A specific person IS the story. Turning point, origin, current position, what\'s next. Best when the article has one named human whose backstory/decisions are the point.',
  what_to_know:
    'WHAT TO KNOW — Explainer format. Question per slide, answered on the slide. Best for high-topic-awareness stories where readers know the noise but not the mechanism (e.g. "how would AI actually kill us all?").',
  the_research_says:
    'THE RESEARCH SAYS — A new paper, finding, or experiment. Method + finding + implication + debate. Best when the article covers a specific research artifact with methodology.',
  use_it:
    'USE IT — Actionable. Reader can apply it. Tool overview + steps + example + caveat. Best when the article is about a specific tool or workflow the reader could adopt.',
} as const;

export type JevStrategyResult = {
  value_type: 'knowledge' | 'entertainment';
  value_probability: number;
  bucket_scores: Record<BucketId, number>;
  bucket: BucketId;
  bucket_probability: number;
  usage: {
    inputTokens: number;
    approxCostUsd: number;
    model: string;
  };
};

export type JevStrategyInput = {
  factSheet: FactSheet;
  chosenHook: ChosenHook;
};

export async function jevChooseStrategy(input: JevStrategyInput): Promise<JevStrategyResult> {
  const state = {
    context:
      `FACT SHEET:\n${JSON.stringify(input.factSheet, null, 2)}\n\n`
      + `CHOSEN HOOK:\n${JSON.stringify(input.chosenHook, null, 2)}`,
  };

  const response = await client().systemOne({
    state,
    questions: {
      isKnowledgePost: noul(VALUE_TYPE_INSTRUCTIONS, {
        true: 'The reader walks away smarter or better-informed. Knowledge is the point.',
        false: 'The reader walks away with a story to retell. Entertainment is the point.',
      }),
      fits_what_just_happened: noul(BUCKET_INSTRUCTIONS.what_just_happened, {
        true: 'This is a straight news event with one actor and clean cause-and-effect.',
        false: 'The story has a deeper angle, is a fight between actors, or is not primarily news-of-event.',
      }),
      fits_the_bigger_story: noul(BUCKET_INSTRUCTIONS.the_bigger_story, {
        true: 'The interesting story is a hinted consequence, not the surface announcement.',
        false: 'The surface fact IS the story; second-order consequences are not the point.',
      }),
      fits_power_play: noul(BUCKET_INSTRUCTIONS.power_play, {
        true: 'Named actors are set against each other with stakes on both sides.',
        false: 'This is not primarily a fight between named actors.',
      }),
      fits_person_profile: noul(BUCKET_INSTRUCTIONS.person_profile, {
        true: 'One named human is THE story — their decisions, turning point, backstory.',
        false: 'No single named human is the center of gravity here.',
      }),
      fits_what_to_know: noul(BUCKET_INSTRUCTIONS.what_to_know, {
        true: 'This is an explainer — readers know the topic but want the mechanism.',
        false: 'Explainer format doesn\'t fit; the story is not about answering FAQ-style questions.',
      }),
      fits_the_research_says: noul(BUCKET_INSTRUCTIONS.the_research_says, {
        true: 'The article covers a specific research artifact — paper, experiment, finding.',
        false: 'This is not a research report; there is no method-and-finding structure.',
      }),
      fits_use_it: noul(BUCKET_INSTRUCTIONS.use_it, {
        true: 'The reader could apply this immediately — a tool or workflow to adopt.',
        false: 'There is no direct action the reader can take from this story.',
      }),
    },
  });

  const answers = response.answers;
  const bucket_scores: Record<BucketId, number> = {
    what_just_happened: answers.fits_what_just_happened.noul,
    the_bigger_story: answers.fits_the_bigger_story.noul,
    power_play: answers.fits_power_play.noul,
    person_profile: answers.fits_person_profile.noul,
    what_to_know: answers.fits_what_to_know.noul,
    the_research_says: answers.fits_the_research_says.noul,
    use_it: answers.fits_use_it.noul,
  };

  const bucket = (Object.entries(bucket_scores) as [BucketId, number][])
    .sort((a, b) => b[1] - a[1])[0]![0];
  const bucket_probability = bucket_scores[bucket];

  const value_probability = answers.isKnowledgePost.noul;
  const value_type: 'knowledge' | 'entertainment' = value_probability >= 0.5 ? 'knowledge' : 'entertainment';

  const usage = response.usage as { input_tokens?: number; inputTokens?: number } | undefined;
  const inputTokens = usage?.input_tokens ?? usage?.inputTokens ?? 0;

  return {
    value_type,
    value_probability,
    bucket_scores,
    bucket,
    bucket_probability,
    usage: {
      inputTokens,
      approxCostUsd: jevCostUsd({ inputTokens }),
      model: response.model ?? 'jev-latest',
    },
  };
}
