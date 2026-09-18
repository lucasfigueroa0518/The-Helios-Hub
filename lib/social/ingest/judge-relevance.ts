import { TypeSafeClient, noul } from '@typesafe-ai/sdk';

import { HELIOS_RELEVANCE_RUBRIC } from '@/lib/social/rubric';

/**
 * Jev-based relevance gate. Cheap single-Noul call that decides whether an
 * article is Helios-worthy AI news. Articles that pass the threshold get
 * escalated to Haiku for the full extraction packet (see extract-packet.ts).
 * Articles that fail are rejected without any Haiku call — that is where
 * the cost savings come from.
 *
 * Reads TYPESAFE_API_KEY from env at module load. The client throws if the
 * key is missing; that surfaces clearly on the first ingest run rather than
 * silently degrading.
 */

const client = new TypeSafeClient();

// Rubric lives in lib/social/rubric.ts — shared with the Haiku shadow judge
// so the A/B comparison is grading by identical criteria.
const RELEVANCE_INSTRUCTIONS = HELIOS_RELEVANCE_RUBRIC;

export type JudgeRelevanceInput = {
  source: string;
  headline: string;
  byline: string | null;
  body: string;
};

export type JudgeRelevanceResult = {
  /** 0.0-1.0 probability that this article should be posted. */
  noul: number;
  /** Rough estimated cost of this call in USD. Filled if the SDK exposes usage. */
  approxCostUsd: number;
  /** Which Jev version handled the request. */
  model: string;
};

// Jev pricing (per docs.typesafe.ai/models.md): $42/Btok input, output free.
const JEV_INPUT_USD_PER_MTOK = 0.042;

function estimateCostUsd(inputTokens: number): number {
  return (inputTokens * JEV_INPUT_USD_PER_MTOK) / 1_000_000;
}

/**
 * Runs one Jev Noul call to judge whether an article should be posted.
 * Body is truncated to 6000 chars to keep input tokens bounded — enough
 * for Jev to see the lede and key context.
 */
export async function judgeRelevance(
  input: JudgeRelevanceInput,
): Promise<JudgeRelevanceResult> {
  const bylineLine = input.byline ? `Byline: ${input.byline}\n` : '';
  const articleText =
    `Source: ${input.source}\n`
    + `Headline: ${input.headline}\n`
    + bylineLine
    + `\nArticle body:\n${input.body.slice(0, 6000)}`;

  const response = await client.systemOne({
    state: { article: articleText },
    questions: {
      isHeliosWorthy: noul(RELEVANCE_INSTRUCTIONS, {
        true:
          'The article covers a watchlist entity or topic substantively — '
          + 'Helios would post about it.',
        false:
          'No watchlist entity or topic is central, OR the article is off-topic '
          + '(product PR blast, coding tutorial, generic marketing listicle, '
          + 'unrelated business/political news).',
      }),
    },
  });

  const answer = response.answers.isHeliosWorthy;
  const usage = response.usage as { input_tokens?: number; inputTokens?: number } | undefined;
  const inputTokens = usage?.input_tokens ?? usage?.inputTokens ?? 0;

  return {
    noul: answer.noul,
    approxCostUsd: estimateCostUsd(inputTokens),
    model: response.model ?? 'jev-latest',
  };
}
