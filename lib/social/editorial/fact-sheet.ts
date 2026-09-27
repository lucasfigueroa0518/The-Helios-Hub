import type Anthropic from '@anthropic-ai/sdk';

import { anthropic } from '@/lib/anthropic';
import { cachedSystemText, cacheUsageFromMessage } from '@/lib/anthropic-cache';
import { EDITORIAL_MODEL, sonnetCostUsd } from '@/lib/social/editorial/config';
import type { ExtractionPacket } from '@/lib/social/ingest/extract-packet';

/**
 * Stage 1 — the fact sheet.
 *
 * From `~/.claude/skills/helios-social-editorial/SKILL.md` §1: "Read the full
 * article, plus any primary source it links (the paper, the company post,
 * the filing), before deciding anything."
 *
 * Runs on Sonnet 4.6 because stages 1-4 are judgment calls. The upstream
 * Haiku extract-packet has already produced people/companies/products/
 * topics/notable_number/bullets — we pass that in as scaffolding so Sonnet
 * doesn't re-derive the same lists and can focus on the harder fields:
 * key_facts with source pointers, numbers with comparisons, quotes with
 * hold_slide flags, players with rivalries, assets, second_order, and
 * source_strength.
 *
 * System prompt is `1h` cached so consecutive articles in the same run pay
 * ~10% of input cost after the first.
 */

const SYSTEM_PROMPT = `You produce the FACT SHEET for the Helios Social editorial pipeline.

Read the full article carefully. You may be handed a scaffold from an upstream
extractor (people, companies, products, topics, notable_number, bullets) — use
it to save time on those fields, but VERIFY every name against the article
body. If the scaffold names someone the article doesn't actually name, drop
that name.

Your job is to make every downstream stage traceable: every fact you extract
must include the source sentence it came from. If you can't cite a source
sentence, don't include the fact.

Return a strict JSON object matching the schema below. No prose. No code
fences. Do not include any field the schema doesn't name.

## Schema

{
  "five_ws": {
    "who": "actor(s) with role/title",
    "what": "the specific action / event / claim",
    "when": "date or timing detail",
    "where": "location or venue if relevant, else null",
    "why": "the article's stated reason / motivation, else null",
    "why_reader_cares": "one sentence: why this matters to a general tech-and-AI reader"
  },
  "key_facts": [
    { "fact": "concise statement", "source_sentence": "verbatim sentence from the article that supports it", "news_value": 1-5 }
  ],
  "numbers": [
    { "figure": "as displayed, e.g. '$2B'", "meaning": "what it measures", "comparison": "something the reader knows to scale against, or null if none available", "source_sentence": "verbatim" }
  ],
  "quotes": [
    { "speaker": "name and role", "quote": "verbatim words", "can_hold_slide": true|false, "source_sentence": "verbatim" }
  ],
  "players": [
    { "name": "person or company", "role": "why they matter to this story", "rival": "another player they're set against, or null" }
  ],
  "assets": [
    { "kind": "photo|chart|figure|tweet|headline|filing_excerpt", "subject": "what it shows", "url": "if the article contains a direct URL, else null", "needs_licensing": true|false }
  ],
  "second_order": [
    "one-sentence consequence or implication the article hints at but doesn't lead with"
  ],
  "source_strength": "thin | solid | rich",
  "story_type": "one of ai_funding | model_launch | agents | safety | policy | infrastructure | benchmark | leadership | deal | research | tech"
}

## Rules

- "verbatim" means an EXACT substring of the article body. If you can't find
  the exact sentence, don't include the fact.
- key_facts is ranked by news_value 5 (top news) down to 1 (nice to have).
  Return at most 10 facts. Fewer is fine.
- Every number in the article body appears in "numbers", each with the
  meaning and the comparison the reader would use to scale it. Comparison
  can be null when no natural yardstick appears in the article.
- "can_hold_slide" on a quote means: is it complete and evocative enough
  that a slide could be JUST this sentence? Fragments and hedged quotes
  are false.
- "rival" on a player is only set when the article names a specific
  opposing actor. Do not invent rivalries.
- "second_order" is where the best hook often lives. Look for one-line
  consequences the article HINTS at but does not lead with (e.g. "SF has
  no personal income tax" when the article is about a $2T IPO in SF).
- source_strength:
    thin  = under 400 words, single-source, no numbers or quotes
    solid = 400-1200 words, one or two named sources, at least one number or quote
    rich  = 1200+ words, multiple sources, numbers AND quotes AND context
- story_type is single-select from the design system's category vocabulary.
  Use "tech" only when nothing else fits.
- If source_strength is "thin", still produce your best fact sheet. The
  hook-mining stage may decide to skip the story downstream. Your job is
  the extraction, not the decision.`;

export type FactSheet = {
  five_ws: {
    who: string;
    what: string;
    when: string;
    where: string | null;
    why: string | null;
    why_reader_cares: string;
  };
  key_facts: Array<{
    fact: string;
    source_sentence: string;
    news_value: number;
  }>;
  numbers: Array<{
    figure: string;
    meaning: string;
    comparison: string | null;
    source_sentence: string;
  }>;
  quotes: Array<{
    speaker: string;
    quote: string;
    can_hold_slide: boolean;
    source_sentence: string;
  }>;
  players: Array<{
    name: string;
    role: string;
    rival: string | null;
  }>;
  assets: Array<{
    kind: 'photo' | 'chart' | 'figure' | 'tweet' | 'headline' | 'filing_excerpt';
    subject: string;
    url: string | null;
    needs_licensing: boolean;
  }>;
  second_order: string[];
  source_strength: 'thin' | 'solid' | 'rich';
  story_type:
    | 'ai_funding'
    | 'model_launch'
    | 'agents'
    | 'safety'
    | 'policy'
    | 'infrastructure'
    | 'benchmark'
    | 'leadership'
    | 'deal'
    | 'research'
    | 'tech';
};

export type FactSheetInput = {
  headline: string;
  source: string;
  byline: string | null;
  body: string;
  /**
   * Prior Haiku extract-packet, when available. Passed to Sonnet as
   * scaffolding — saves tokens on the fields Haiku already produced.
   * Sonnet is instructed to VERIFY the scaffold against the article body.
   */
  scaffold?: ExtractionPacket | null;
};

export type FactSheetUsage = {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  approxCostUsd: number;
};

export type FactSheetResult = {
  factSheet: FactSheet;
  usage: FactSheetUsage;
  raw: Anthropic.Message;
};

function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Distinguish truncation (looks like JSON but doesn't end with a matching
    // closer) from prose refusals (doesn't start with { or [). The message
    // that lands in the DB/logs should tell you which failure mode you hit
    // without having to eyeball the raw response.
    const startsLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[');
    const endsLikeJson = trimmed.endsWith('}') || trimmed.endsWith(']');
    const mode = startsLikeJson && !endsLikeJson
      ? 'truncated'
      : startsLikeJson
        ? 'malformed'
        : 'non-json';
    const head = trimmed.slice(0, 160);
    const tail = trimmed.length > 160 ? `... [${trimmed.length} chars] ...${trimmed.slice(-120)}` : '';
    throw new Error(`fact-sheet: ${mode} — ${head}${tail}`);
  }
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];
}

/**
 * Validate + normalize the parsed JSON into a FactSheet. Missing arrays
 * become []; missing strings become '' (fields the caller can inspect);
 * enums are lightly clamped to valid values.
 */
function normalize(raw: unknown): FactSheet {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('fact-sheet: model returned non-object JSON');
  }
  const r = raw as Record<string, unknown>;

  const w = (typeof r.five_ws === 'object' && r.five_ws) ? (r.five_ws as Record<string, unknown>) : {};
  const five_ws = {
    who: typeof w.who === 'string' ? w.who : '',
    what: typeof w.what === 'string' ? w.what : '',
    when: typeof w.when === 'string' ? w.when : '',
    where: typeof w.where === 'string' ? w.where : null,
    why: typeof w.why === 'string' ? w.why : null,
    why_reader_cares: typeof w.why_reader_cares === 'string' ? w.why_reader_cares : '',
  };

  const key_facts = Array.isArray(r.key_facts)
    ? r.key_facts
        .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
        .map((x) => ({
          fact: typeof x.fact === 'string' ? x.fact : '',
          source_sentence: typeof x.source_sentence === 'string' ? x.source_sentence : '',
          news_value: typeof x.news_value === 'number' ? Math.max(1, Math.min(5, Math.round(x.news_value))) : 3,
        }))
        .filter((x) => x.fact.length > 0 && x.source_sentence.length > 0)
    : [];

  const numbers = Array.isArray(r.numbers)
    ? r.numbers
        .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
        .map((x) => ({
          figure: typeof x.figure === 'string' ? x.figure : '',
          meaning: typeof x.meaning === 'string' ? x.meaning : '',
          comparison: typeof x.comparison === 'string' && x.comparison.trim().length > 0 ? x.comparison : null,
          source_sentence: typeof x.source_sentence === 'string' ? x.source_sentence : '',
        }))
        .filter((x) => x.figure.length > 0)
    : [];

  const quotes = Array.isArray(r.quotes)
    ? r.quotes
        .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
        .map((x) => ({
          speaker: typeof x.speaker === 'string' ? x.speaker : '',
          quote: typeof x.quote === 'string' ? x.quote : '',
          can_hold_slide: typeof x.can_hold_slide === 'boolean' ? x.can_hold_slide : false,
          source_sentence: typeof x.source_sentence === 'string' ? x.source_sentence : '',
        }))
        .filter((x) => x.quote.length > 0)
    : [];

  const players = Array.isArray(r.players)
    ? r.players
        .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
        .map((x) => ({
          name: typeof x.name === 'string' ? x.name : '',
          role: typeof x.role === 'string' ? x.role : '',
          rival: typeof x.rival === 'string' && x.rival.trim().length > 0 ? x.rival : null,
        }))
        .filter((x) => x.name.length > 0)
    : [];

  const assetKinds = new Set(['photo', 'chart', 'figure', 'tweet', 'headline', 'filing_excerpt']);
  const assets = Array.isArray(r.assets)
    ? r.assets
        .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
        .map((x) => ({
          kind: typeof x.kind === 'string' && assetKinds.has(x.kind) ? x.kind as FactSheet['assets'][number]['kind'] : 'photo',
          subject: typeof x.subject === 'string' ? x.subject : '',
          url: typeof x.url === 'string' && x.url.trim().length > 0 ? x.url : null,
          needs_licensing: typeof x.needs_licensing === 'boolean' ? x.needs_licensing : true,
        }))
        .filter((x) => x.subject.length > 0)
    : [];

  const second_order = asStringArray(r.second_order);

  const strengths = new Set(['thin', 'solid', 'rich']);
  const source_strength = typeof r.source_strength === 'string' && strengths.has(r.source_strength)
    ? r.source_strength as FactSheet['source_strength']
    : 'solid';

  const types = new Set(['ai_funding', 'model_launch', 'agents', 'safety', 'policy', 'infrastructure', 'benchmark', 'leadership', 'deal', 'research', 'tech']);
  const story_type = typeof r.story_type === 'string' && types.has(r.story_type)
    ? r.story_type as FactSheet['story_type']
    : 'tech';

  return {
    five_ws,
    key_facts,
    numbers,
    quotes,
    players,
    assets,
    second_order,
    source_strength,
    story_type,
  };
}

/**
 * Build the fact sheet for one article. Body truncated to 12000 chars so
 * long features still fit inside Sonnet's input window without paying for
 * pages of comment-thread appendage.
 */
export async function buildFactSheet(input: FactSheetInput): Promise<FactSheetResult> {
  const bylineLine = input.byline ? `Byline: ${input.byline}\n` : '';
  const scaffoldBlock = input.scaffold
    ? `\n\nUpstream extractor scaffold (verify each name against the article body — drop anything the article doesn't actually name):\n${JSON.stringify(input.scaffold, null, 2)}`
    : '';
  const userText =
    `Source: ${input.source}\n`
    + `Headline: ${input.headline}\n`
    + bylineLine
    + `\nArticle body:\n${input.body.slice(0, 12000)}`
    + scaffoldBlock;

  const response = await anthropic.messages.create({
    model: EDITORIAL_MODEL,
    // Rich articles produce a lot of key_facts + numbers + quotes with
    // their verbatim source_sentence pointers. 6000 is enough headroom for
    // Suleyman-scale coverage (long feature with multiple quoted speakers
    // and 5+ numbers); the previous 3000 truncated on the first real
    // article. Cost delta at Sonnet output rates is negligible — cheaper
    // than paying for a full call that returns unusable truncated JSON.
    max_tokens: 6000,
    system: cachedSystemText(SYSTEM_PROMPT, '1h'),
    messages: [{ role: 'user', content: userText }],
  });

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === 'text',
  );
  if (!textBlock) throw new Error('fact-sheet: model returned no text block');

  const factSheet = normalize(parseJson(textBlock.text));
  const cache = cacheUsageFromMessage(response);
  const outputTokens = Math.max(0, Number(response.usage.output_tokens ?? 0));
  const usage: FactSheetUsage = {
    inputTokens: cache.inputTokens,
    cacheReadTokens: cache.cacheReadTokens,
    cacheWriteTokens: cache.cacheWriteTokens,
    outputTokens,
    approxCostUsd: sonnetCostUsd({
      inputTokens: cache.inputTokens,
      outputTokens,
      cacheReadTokens: cache.cacheReadTokens,
      cacheWriteTokens: cache.cacheWriteTokens,
    }),
  };

  return { factSheet, usage, raw: response };
}
