import type Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText, withToolCache } from '@/lib/anthropic-cache';
import { priceAnthropicMessages } from '@/lib/anthropic-pricing';
import { isPrivateHost } from '@/lib/net/private-host';
import { B6_MODEL } from '@/lib/reels/config';
import { recordCost as recordReelsCost } from '@/lib/reels/repository';
import { readPageText } from '@/lib/reels/seed-search';

import { Ledger, SEARCH_MAX_OUTPUT_TOKENS, SEARCH_MAX_USES, searchWorstCaseUsd } from './budget';
import { buildSearchUserTurn, reportFindingToolFor, searchSystemFor, type LinkHint } from './prompts';
import { shapeKey } from './shape';
import type { Entry, EntryField, Finding, OneBoxInput } from './types';

/** The Anthropic client surface the one-box uses; tests pass a stub, so no test makes a live call. */
export type Client = { messages: { create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> } };

export type CostRecorder = (usd: number, inputTokens: number, outputTokens: number) => Promise<void>;

export const defaultSearchCost: CostRecorder = (usd, inputTokens, outputTokens) =>
  recordReelsCost({ runId: null, vendor: 'anthropic', component: 'one-box-seed', inputTokens, outputTokens, usd });

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const validHttp = (u: string): boolean => {
  try {
    return /^https?:\/\//i.test(u) && Boolean(new URL(u).hostname);
  } catch {
    return false;
  }
};

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

const FIELDS: EntryField[] = ['headline', 'url', 'title', 'sourceUrl', 'value', 'fact', 'storyHeadline', 'toolName', 'description', 'leaf', 'want'];

function parseFinding(message: Anthropic.Message): Finding {
  const block = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'report_finding');
  if (!block) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), component: 'one-box-seed', message: 'no_report', stop_reason: message.stop_reason }));
    const ranOut = message.stop_reason === 'pause_turn' || message.stop_reason === 'max_tokens';
    return { found: false, reason: ranOut ? 'The search ran out of room before it reported anything.' : 'The search did not report anything.', entries: [] };
  }
  const i = block.input as Record<string, unknown>;
  const entries: Entry[] = [];
  if (Array.isArray(i.entries)) {
    for (const raw of i.entries as Array<Record<string, unknown>>) {
      const entry: Entry = {};
      for (const f of FIELDS) if (str(raw?.[f])) entry[f] = str(raw[f]);
      // A url the model reported that is not a real http(s) address is dropped with its entry.
      const bad = (['url', 'sourceUrl'] as const).some((f) => entry[f] !== undefined && !validHttp(entry[f]!));
      if (!bad && Object.keys(entry).length > 0) entries.push(entry);
    }
  }
  const finding: Finding = { found: i.found === true, entries: entries.slice(0, 3) };
  if (str(i.reason)) finding.reason = str(i.reason);
  if (str(i.duplicate_of)) finding.duplicateOf = str(i.duplicate_of);
  if (str(i.main_point)) finding.mainPoint = str(i.main_point);
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
    system: cachedSystemText(searchSystemFor(shapeKey(i.input))),
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: SEARCH_MAX_USES }, withToolCache(reportFindingToolFor(shapeKey(i.input)) as Anthropic.Tool)],
    messages: [{ role: 'user', content: buildSearchUserTurn({ vertical: i.input.vertical, blurb: i.input.blurb, linkHint: hint, poolHeadlines: i.poolHeadlines }) }],
  });
  const priced = priceAnthropicMessages([message], { modelId: B6_MODEL, fallbackCacheTtl: '1h' });
  const usd = Number(priced.costUsd);
  i.ledger.add(usd);
  const inputTokens = priced.uncached_input_tokens + priced.cache_read_input_tokens + priced['cache_creation.ephemeral_5m_input_tokens'] + priced['cache_creation.ephemeral_1h_input_tokens'];
  await (i.recordCost ?? defaultSearchCost)(usd, inputTokens, priced.output_tokens).catch(() => undefined);
  return { finding: parseFinding(message), usd };
}
