import type Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText, withToolCache } from '@/lib/anthropic-cache';
import { priceAnthropicMessages } from '@/lib/anthropic-pricing';
import { isPrivateHost } from '@/lib/net/private-host';
import { B6_MODEL } from '@/lib/reels/config';
import { recordCost as recordReelsCost } from '@/lib/reels/repository';
import { readPageText } from '@/lib/reels/seed-search';

import { Ledger, SEARCH_MAX_OUTPUT_TOKENS, SEARCH_MAX_USES, searchWorstCaseUsd } from './budget';
import { ONE_BOX_SYSTEM, REPORT_FINDING_TOOL, buildSearchUserTurn, type LinkHint } from './prompts';
import type { Finding, OneBoxInput, ReportedArticle } from './types';

/** The Anthropic client surface the one-box uses; tests pass a stub, so no test makes a live call. */
export type Client = { messages: { create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> } };

export type CostRecorder = (usd: number, inputTokens: number, outputTokens: number) => Promise<void>;

export const defaultSearchCost: CostRecorder = (usd, inputTokens, outputTokens) =>
  recordReelsCost({ runId: null, vendor: 'anthropic', component: 'one-box-seed', inputTokens, outputTokens, usd });

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** A pasted link as a hint: its page read by the plain reader (private hosts refused), or `unreadable`. Never throws. */
async function linkHint(link: string, readPage: (url: string) => Promise<string | null>): Promise<LinkHint> {
  try {
    const url = new URL(link);
    if (!/^https?:$/.test(url.protocol) || isPrivateHost(url.hostname)) return { url: link, unreadable: true };
    const text = (await readPage(link))?.trim() ?? '';
    if (text.length < 200) return { url: link, unreadable: true };
    const first = text.split('\n').map((l) => l.trim()).find((l) => l.length > 15) ?? link;
    return { url: link, headline: first.slice(0, 160), excerpt: text.slice(0, 600) };
  } catch {
    return { url: link, unreadable: true };
  }
}

function parseFinding(message: Anthropic.Message): Finding {
  const block = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === REPORT_FINDING_TOOL.name);
  if (!block) return { found: false, reason: 'The search did not report anything.', articles: [] };
  const i = block.input as Record<string, unknown>;
  const articles: ReportedArticle[] = [];
  if (Array.isArray(i.articles)) {
    for (const a of i.articles as Array<Record<string, unknown>>) {
      if (typeof a?.url === 'string' && /^https?:\/\//i.test(a.url) && typeof a.headline === 'string') {
        articles.push({ url: a.url, headline: a.headline, outlet: str(a.outlet) || new URL(a.url).hostname.replace(/^www\./, '') });
      }
    }
  }
  const finding: Finding = { found: i.found === true, articles: articles.slice(0, 3) };
  if (str(i.reason)) finding.reason = str(i.reason);
  if (str(i.duplicate_of)) finding.duplicateOf = str(i.duplicate_of);
  if (str(i.main_point)) finding.mainPoint = str(i.main_point);
  if (str(i.concept_title)) finding.conceptTitle = str(i.concept_title);
  const n = i.number as Record<string, unknown> | undefined;
  if (n && str(n.value) && str(n.fact)) finding.number = { value: str(n.value), fact: str(n.fact), ...(str(n.story_headline) ? { storyHeadline: str(n.story_headline) } : {}) };
  const t = i.tool as Record<string, unknown> | undefined;
  if (t && str(t.name) && /^https?:\/\//i.test(str(t.url))) finding.tool = { name: str(t.name), url: str(t.url), description: str(t.description) };
  return finding;
}

/**
 * The agent call (design section 3): one model call with web search that reads the person's idea (and the pool's headlines, and
 * a pasted link as a hint) and reports what it found. Modeled on `webCandidates` in lib/reels/seed-search.ts, but it is not the
 * nightly collectors. Not made at all when the ledger cannot afford its worst case.
 */
export async function runSearch(i: {
  client: Client;
  ledger: Ledger;
  input: OneBoxInput;
  poolHeadlines: string[];
  readPage?: (url: string) => Promise<string | null>;
  recordCost?: CostRecorder;
}): Promise<{ finding: Finding; usd: number } | { stopped: 'budget' }> {
  if (!i.ledger.canAfford(searchWorstCaseUsd())) return { stopped: 'budget' };
  const hint = i.input.link ? await linkHint(i.input.link, i.readPage ?? readPageText) : undefined;
  const message = await i.client.messages.create({
    model: B6_MODEL,
    max_tokens: SEARCH_MAX_OUTPUT_TOKENS,
    system: cachedSystemText(ONE_BOX_SYSTEM),
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: SEARCH_MAX_USES }, withToolCache(REPORT_FINDING_TOOL as Anthropic.Tool)],
    messages: [{ role: 'user', content: buildSearchUserTurn({ vertical: i.input.vertical, series: i.input.series, blurb: i.input.blurb, linkHint: hint, poolHeadlines: i.poolHeadlines }) }],
  });
  const priced = priceAnthropicMessages([message], { modelId: B6_MODEL, fallbackCacheTtl: '1h' });
  const usd = Number(priced.costUsd);
  i.ledger.add(usd);
  const inputTokens = priced.uncached_input_tokens + priced.cache_read_input_tokens + priced['cache_creation.ephemeral_5m_input_tokens'] + priced['cache_creation.ephemeral_1h_input_tokens'];
  await (i.recordCost ?? defaultSearchCost)(usd, inputTokens, priced.output_tokens).catch(() => undefined);
  return { finding: parseFinding(message), usd };
}
