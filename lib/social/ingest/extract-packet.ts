import type Anthropic from '@anthropic-ai/sdk';

import { anthropic } from '@/lib/anthropic';
import { cachedSystemText, cacheUsageFromMessage } from '@/lib/anthropic-cache';
import { formatWatchlistForPrompt } from '@/lib/social/watchlist';

/**
 * Haiku-based extraction for articles that ALREADY cleared the Jev relevance
 * gate. Produces the packet the slide generator consumes (people/companies/
 * products/topics/notable_number/bullets) plus the Helios angle callout.
 *
 * Does not score — scoring happens upstream in judge-relevance.ts. This call
 * runs only on articles Jev has approved, which is where cost savings show
 * up: ~15 approved articles per day instead of ~60 raw fetches.
 *
 * System prompt is cache_control'd with a 1h TTL — first article of a run
 * pays the cache write, subsequent articles pay ~10% of input cost.
 */

const EXTRACTION_MODEL = 'claude-haiku-4-5-20251001';

const EXTRACTION_SYSTEM_PROMPT = `
You extract the structured packet for Helios Marketing's Instagram post pipeline.
This article has ALREADY been approved as Helios-worthy by an upstream Jev filter
— do not question its relevance. Your job is to extract the packet the slide
generator needs.

WATCHLIST — the editorial focus. Match extracted names against this list only.

${formatWatchlistForPrompt()}

TOPIC DEFINITIONS — apply each topic ONLY when the article meets its criteria.
Use exact label text as written in the watchlist above (do not shorten,
paraphrase, or omit qualifiers like "($100M+)").

- frontier model launches: A specific model or major model update is being
  released to users, previewed, or benchmarked publicly (e.g. "GPT-5
  launches", "Claude 5 preview drops", "Gemini 3 SOTA on GPQA"). Do NOT
  apply to lab-organization news, exec commentary, policy statements,
  funding, or research-institute launches — even when the actor is
  OpenAI / Anthropic / Google DeepMind.

- agentic AI + computer-use: A specific agent framework, autonomous
  computer-use capability, or agent product being shipped or benchmarked.
  NOT any article mentioning "agents" in passing.

- model safety and alignment: Safety research, alignment breakthroughs,
  safety incidents, or corporate safety commitments/policy debates. The
  article must be substantively about safety — passing mentions do not
  qualify.

- image and video generation: New image or video generation model,
  feature, or notable use case. Not general "AI applications".

- AI + advertising: AI being used in ad targeting, ad creative production,
  or an ad platform's AI feature. This is about ADS specifically.

- AI use cases with visible outcomes: A specific brand or organization
  achieving a MEASURED outcome with AI (revenue lift, cost savings,
  customer-impact metric). Requires concrete outcomes; adoption
  announcements without measured results do not qualify.

- AI marketing campaigns: A BRAND running an actual marketing campaign
  where AI is central to the CREATIVE execution or media buy (e.g. the
  Nutter Butter AI mascot campaign, Coca-Cola's AI-generated holiday
  spot). NOT AI companies launching ad products (that is "AI + advertising").

- AI tools: A NEW AI tool (software, agent, platform, framework) shipping
  to users, or a major feature update. Not passing mentions of existing tools.

- AI regulation: New laws, executive orders, court rulings that create
  precedent, or a specific regulatory body taking action. NOT: industry
  discussions about regulation, corporate self-imposed policy, safety
  agreements between companies, or private copyright lawsuits.

- chip supply / GPU costs / infrastructure: NVIDIA/AMD chip news, GPU
  shortages, training-infrastructure costs, or data-center announcements
  material to AI compute.

- enterprise AI adoption: A large company (Fortune 500 scale) adopting AI
  at scale, or an AI vendor announcing a major enterprise deal / product
  line.

- AI startup funding ($100M+): A funding round of $100M or more for an AI
  startup, or valuations discussed at that scale. Do NOT tag safety,
  product, or policy articles with this topic just because a valuation is
  mentioned in passing. Use the exact label "AI startup funding ($100M+)".

- coding assistants: New or updated coding assistant tool (Copilot,
  Cursor, Claude Code, Codex), benchmark result, or notable use case.

EXTRACTION — return the following as strict JSON. No prose. No code fences.
Prefer FEWER, more accurate topics over stacking three loose matches.

- reason: one-sentence Helios angle — the specific POV Helios would take on
  this story from a marketing-agency-that-runs-AI-campaigns lens.
- people: names from the watchlist People list that appear in the article
- companies: names from the watchlist Companies list that appear
- products: names from the watchlist Products list that appear
- topics: watchlist Topics this article covers (see definitions above)
- notable_number: the attention-grabbing number as a short display string
  (e.g. "$300B valuation", "40% faster", "1.4B users"), or null if none
- bullets: 5-8 bullets summarizing the ENTIRE article, ordered by importance
  (the "why does this matter" facts BEFORE the "how it happened" backstory).
  Each bullet is one terse fact-forward sentence. No leading dashes or numbers.

Shape:
{
  "reason": "...",
  "people": [],
  "companies": [],
  "products": [],
  "topics": [],
  "notable_number": null,
  "bullets": []
}
`.trim();

export type ExtractPacketInput = {
  headline: string;
  source: string;
  byline: string | null;
  body: string;
};

export type ExtractionPacket = {
  reason: string;
  people: string[];
  companies: string[];
  products: string[];
  topics: string[];
  notable_number: string | null;
  bullets: string[];
};

export type ExtractionUsage = {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  approxCostUsd: number;
};

export type ExtractPacketResult = {
  packet: ExtractionPacket;
  usage: ExtractionUsage;
  raw: Anthropic.Message;
};

// Haiku 4.5 approximate pricing.
const HAIKU_INPUT_USD_PER_MTOK = 1.0;
const HAIKU_CACHE_READ_USD_PER_MTOK = 0.1;
const HAIKU_CACHE_WRITE_USD_PER_MTOK = 1.25;
const HAIKU_OUTPUT_USD_PER_MTOK = 5.0;

function estimateCostUsd(u: Omit<ExtractionUsage, 'approxCostUsd'>): number {
  return (
    u.inputTokens * HAIKU_INPUT_USD_PER_MTOK
    + u.cacheReadTokens * HAIKU_CACHE_READ_USD_PER_MTOK
    + u.cacheWriteTokens * HAIKU_CACHE_WRITE_USD_PER_MTOK
    + u.outputTokens * HAIKU_OUTPUT_USD_PER_MTOK
  ) / 1_000_000;
}

function parsePacket(text: string): ExtractionPacket {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`Extraction returned non-JSON: ${trimmed.slice(0, 200)}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Extraction returned non-object JSON');
  }
  const r = parsed as Record<string, unknown>;
  const reason = typeof r.reason === 'string' ? r.reason.trim() : '';
  const asStringArray = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : [];
  const notable =
    typeof r.notable_number === 'string' && r.notable_number.trim().length > 0
      ? r.notable_number.trim()
      : null;
  return {
    reason,
    people: asStringArray(r.people),
    companies: asStringArray(r.companies),
    products: asStringArray(r.products),
    topics: asStringArray(r.topics),
    notable_number: notable,
    bullets: asStringArray(r.bullets),
  };
}

/**
 * Extracts the packet for one already-approved article. Body is truncated to
 * 8000 chars — enough for a top-weighted summary of ~1200 words. max_tokens
 * bumped to 1500 (from earlier 900) so long extraction responses no longer
 * truncate mid-JSON.
 */
export async function extractPacket(input: ExtractPacketInput): Promise<ExtractPacketResult> {
  const bylineLine = input.byline ? `Byline: ${input.byline}\n` : '';
  const userText =
    `Source: ${input.source}\n`
    + `Headline: ${input.headline}\n`
    + bylineLine
    + `\nArticle body:\n${input.body.slice(0, 8000)}`;

  const response = await anthropic.messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: 1500,
    system: cachedSystemText(EXTRACTION_SYSTEM_PROMPT, '1h'),
    messages: [{ role: 'user', content: userText }],
  });

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === 'text',
  );
  if (!textBlock) throw new Error('Extraction returned no text block');

  const packet = parsePacket(textBlock.text);
  const cacheUsage = cacheUsageFromMessage(response);
  const outputTokens = Math.max(0, Number(response.usage.output_tokens ?? 0));
  const usage: ExtractionUsage = {
    inputTokens: cacheUsage.inputTokens,
    cacheReadTokens: cacheUsage.cacheReadTokens,
    cacheWriteTokens: cacheUsage.cacheWriteTokens,
    outputTokens,
    approxCostUsd: estimateCostUsd({
      inputTokens: cacheUsage.inputTokens,
      cacheReadTokens: cacheUsage.cacheReadTokens,
      cacheWriteTokens: cacheUsage.cacheWriteTokens,
      outputTokens,
    }),
  };

  return { packet, usage, raw: response };
}
