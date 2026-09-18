import { TypeSafeClient, noul } from '@typesafe-ai/sdk';

import { formatWatchlistForPrompt } from '@/lib/social/watchlist';

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

const RELEVANCE_INSTRUCTIONS = `
Should Helios Marketing turn this article into an Instagram post?

Helios is a Madison-Avenue-meets-AI marketing agency. Their editorial voice on
Instagram comments on AI industry news through a marketing lens. An article
qualifies when it substantively covers a watchlist entity OR a watchlist topic.

Watchlist:
${formatWatchlistForPrompt()}

Say YES (probability near 1) when the article covers:
- A specific model launch, product release, agent capability, or benchmark
- A notable brand campaign where AI is central to creative or media
- Ad-industry deals, agency moves, or industry-shaping analysis
- AI safety incidents, alignment research, or corporate safety policy
- AI regulation (laws, executive orders, court rulings that create precedent)
- Chip supply, GPU costs, or AI infrastructure moves
- Enterprise AI adoption at Fortune 500 scale
- AI startup funding rounds of $100M or more
- Coding assistant tools or benchmarks
- A notable image or video generation advance

Say NO (probability near 0) when:
- No watchlist entity or topic is central to the article
- Off-topic business or political news
- Product PR blast without a larger story
- Coding tutorials or dev-only announcements
- Generic marketing or social media listicle content
`.trim();

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
