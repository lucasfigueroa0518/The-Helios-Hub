import type Anthropic from '@anthropic-ai/sdk';

import { anthropic } from '@/lib/anthropic';
import { cachedSystemText, cacheUsageFromMessage } from '@/lib/anthropic-cache';
import { formatWatchlistForPrompt } from '@/lib/social/watchlist';

/**
 * Haiku-based relevance filter + entity/topic extractor for the Helios Social
 * RSS ingest. One LLM call per article produces the full extraction packet
 * that later feeds the HTML slide generator.
 *
 * The system prompt (rubric + watchlist) is cache_control'd with a 1h TTL —
 * after the first article of a run, subsequent articles get ~90% cache hits
 * on the system prefix.
 *
 * Cost persistence is not wired here — Phase 1a is human-triggered per the
 * porting-report's "human-led live enrichment" rule. Phase 1b will wrap this
 * in runProviderCallWithCostPersistence when the worker/cron lands.
 */

const RELEVANCE_MODEL = 'claude-haiku-4-5-20251001';

const RELEVANCE_SYSTEM_PROMPT = `
You are the AI-news relevance filter and extraction pass for Helios Marketing —
a Madison-Avenue-meets-AI marketing agency. Their Instagram voice comments on
AI industry news through a marketing lens.

WATCHLIST — the editorial focus. Nothing off-watchlist qualifies for review.

${formatWatchlistForPrompt()}

SCORING (return in \`score\` as a float in [0.0, 1.0]):
  0.85-1.0 — article prominently features a watchlist entity/topic AND breaks
             news or offers a fresh POV. Top-tier "must post" material.
  0.60-0.85 — article centrally covers a watchlist entity/topic. Solid material.
  0.40-0.60 — watchlist entity/topic is mentioned in passing, or the topic is
              adjacent but not squarely on our beat. Borderline.
  0.00-0.40 — no watchlist match, or fully off-target. Auto-reject.

Publish threshold: 0.6. Anything below is auto-rejected and never reaches
human review.

RULES:
- Nudge score up ~0.05 if the headline or lede contains an attention-grabbing
  NUMBER (dollar valuations, model parameter counts, user counts, benchmark
  improvements, growth multiples). Numbers alone do NOT qualify an
  off-watchlist article — a shocking number about an off-topic story still
  gets rejected.
- Timeliness is already gated upstream (only articles ≤48h old reach you).
- Be decisive. Skew low when in doubt — false positives waste operator time.

TOPIC DEFINITIONS — apply each topic ONLY when the article meets its
criteria. Use exact label text as written above (do not shorten,
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
  startup, or valuations discussed at that scale. The article must be
  substantively about the funding event — do NOT tag safety, product, or
  policy articles with this topic just because a valuation is mentioned in
  passing. Use the exact label "AI startup funding ($100M+)".

- coding assistants: New or updated coding assistant tool (Copilot,
  Cursor, Claude Code, Codex), benchmark result, or notable use case.

EXTRACTION — every response also carries the following, even for rejected
articles (empty arrays / nulls are fine):

- people: names from the watchlist People list that appear in the article
- companies: names from the watchlist Companies list that appear
- products: names from the watchlist Products list that appear
- topics: watchlist Topics this article covers, per the definitions above.
  Use exact label text. Prefer FEWER, more accurate topics over stacking
  three loose matches.
- notable_number: the attention-grabbing number as a short display string
  (e.g. "$300B valuation", "40% faster", "1.4B users"), or null if none
- bullets: 5-8 bullets summarizing the ENTIRE article, ordered by importance
  (the "why does this matter" facts BEFORE the "how it happened" backstory).
  Each bullet is one terse fact-forward sentence. No leading dashes or numbers.
- reason: one-sentence Helios angle if approved, or the specific reason for
  rejection if score < 0.6.

Response is strict JSON. No prose. No code fences. Shape:

{
  "score": 0.0,
  "reason": "...",
  "people": [],
  "companies": [],
  "products": [],
  "topics": [],
  "notable_number": null,
  "bullets": []
}
`.trim();

export type ScoreRelevanceInput = {
  headline: string;
  source: string;
  byline: string | null;
  body: string;
};

export type ExtractionPacket = {
  score: number;
  reason: string;
  people: string[];
  companies: string[];
  products: string[];
  topics: string[];
  notable_number: string | null;
  bullets: string[];
};

export type RelevanceUsage = {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  approxCostUsd: number;
};

export type ScoreRelevanceResult = {
  packet: ExtractionPacket;
  usage: RelevanceUsage;
  raw: Anthropic.Message;
};

// Haiku 4.5 approximate pricing (USD per million tokens). Update when
// Anthropic ships new pricing. Used only for logging/UI, never billed.
const HAIKU_INPUT_USD_PER_MTOK = 1.0;
const HAIKU_CACHE_READ_USD_PER_MTOK = 0.1;
const HAIKU_CACHE_WRITE_USD_PER_MTOK = 1.25;
const HAIKU_OUTPUT_USD_PER_MTOK = 5.0;

function estimateCostUsd(u: Omit<RelevanceUsage, 'approxCostUsd'>): number {
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
    throw new Error(`Relevance filter returned non-JSON: ${trimmed.slice(0, 200)}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Relevance filter returned non-object JSON');
  }
  const r = parsed as Record<string, unknown>;
  const score = Number(r.score);
  const reason = typeof r.reason === 'string' ? r.reason.trim() : '';
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error(`Relevance filter returned invalid score: ${r.score}`);
  }
  const asStringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
  const notable = typeof r.notable_number === 'string' && r.notable_number.trim().length > 0
    ? r.notable_number.trim()
    : null;
  return {
    score,
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
 * Scores + extracts a single article. Body is truncated to 8000 chars — enough
 * for a top-weighted summary of ~1200 words, keeping input tokens bounded.
 */
export async function scoreRelevance(input: ScoreRelevanceInput): Promise<ScoreRelevanceResult> {
  const bylineLine = input.byline ? `Byline: ${input.byline}\n` : '';
  const userText =
    `Source: ${input.source}\n`
    + `Headline: ${input.headline}\n`
    + bylineLine
    + `\nArticle body:\n${input.body.slice(0, 8000)}`;

  const response = await anthropic.messages.create({
    model: RELEVANCE_MODEL,
    max_tokens: 900,
    system: cachedSystemText(RELEVANCE_SYSTEM_PROMPT, '1h'),
    messages: [{ role: 'user', content: userText }],
  });

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === 'text',
  );
  if (!textBlock) throw new Error('Relevance filter returned no text block');

  const packet = parsePacket(textBlock.text);
  const cacheUsage = cacheUsageFromMessage(response);
  const outputTokens = Math.max(0, Number(response.usage.output_tokens ?? 0));
  const usage: RelevanceUsage = {
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
