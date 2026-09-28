/**
 * Reporter stage — researches ONE main story via web_search + fetch_page and
 * writes a BRIEF in plain text with labeled lines.
 */

import type Anthropic from '@anthropic-ai/sdk';

import { anthropic } from '@/lib/anthropic';
import { cachedSystemText, cacheUsageFromMessage, withToolCache } from '@/lib/anthropic-cache';
import { EDITORIAL_MODEL, sonnetCostUsd } from '@/lib/social/editorial/config';

import { REPORTER_PROMPT } from './prompts/reporter';
import { type Brief, parseBrief } from './parse';
import { fetchPage, FETCH_PAGE_TOOL, fetchResultToToolContent } from './tools/fetch-page';
import type { StageUsage } from './log';

export type ReporterInput = {
  /** URL from the scraper. Optional if article text is provided. */
  url?: string;
  /** Article text from the scraper. Optional if URL is provided. */
  articleText?: string;
  /** Article headline from the scraper — helps the model find the main story. */
  headline: string;
  /** Article source (outlet + date), for context. */
  source: string;
  /** Cap on web_search calls. */
  maxWebSearches?: number;
  /** Cap on iterations (tool_use → tool_result cycles). */
  maxIterations?: number;
};

export type ReporterOutput = {
  brief: Brief;
  briefRaw: string;
  fetchedUrls: string[];
  /** stop_reason of every messages.create response in the tool loop, in order. */
  stopReasons: string[];
  usage: StageUsage;
};

const DEFAULT_MAX_WEB_SEARCHES = Number(process.env.HELIOS_V2_REPORTER_MAX_WEB_SEARCHES ?? '5');
const DEFAULT_MAX_ITERATIONS = Number(process.env.HELIOS_V2_REPORTER_MAX_ITERATIONS ?? '8');

/**
 * Reporter output token budget. With server-side web_search, the assistant's
 * response weaves text between citation breakpoints and can grow large. 8k
 * is enough headroom for a Bloomberg-scale brief with 5+ sources cited; the
 * previous 4096 hit ~97% on the first live run.
 */
const REPORTER_MAX_TOKENS = 8000;

export async function runReporter(input: ReporterInput): Promise<ReporterOutput> {
  const maxWebSearches = input.maxWebSearches ?? DEFAULT_MAX_WEB_SEARCHES;
  const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  const userText = buildUserMessage(input);
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userText }];

  const tools: Anthropic.MessageCreateParams['tools'] = [
    // Server-side web_search. The SDK type doesn't include this server-tool
    // shape yet — same pattern as `lib/research-provider.ts` in outreach.
    { type: 'web_search_20250305', name: 'web_search', max_uses: maxWebSearches } as unknown as Anthropic.Tool,
    // Client-side fetch_page — cached last so the tools-array prefix stays stable.
    withToolCache(FETCH_PAGE_TOOL, '1h'),
  ];

  let totalInput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalOutput = 0;
  let totalWebSearches = 0;
  const fetchedUrls: string[] = [];
  const stopReasons: string[] = [];
  const collectedTurns: Anthropic.ContentBlock[][] = [];

  for (let iter = 0; iter < maxIterations; iter++) {
    const response = await anthropic.messages.create({
      model: EDITORIAL_MODEL,
      max_tokens: REPORTER_MAX_TOKENS,
      system: cachedSystemText(REPORTER_PROMPT, '1h'),
      tools,
      messages,
    });

    const usage = cacheUsageFromMessage(response);
    totalInput += usage.inputTokens;
    totalCacheRead += usage.cacheReadTokens;
    totalCacheWrite += usage.cacheWriteTokens;
    totalOutput += Math.max(0, Number(response.usage.output_tokens ?? 0));
    const serverToolUse = (response.usage as unknown as { server_tool_use?: { web_search_requests?: number } }).server_tool_use;
    totalWebSearches += Math.max(0, Number(serverToolUse?.web_search_requests ?? 0));
    stopReasons.push(String(response.stop_reason ?? 'unknown'));

    if (response.stop_reason === 'tool_use') {
      // Client-tool round: append assistant, execute fetch_page calls,
      // append tool_results, loop. Do NOT collect this turn's text yet —
      // the model may continue after tool_results with more text that we
      // want joined to it.
      messages.push({ role: 'assistant', content: response.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        if (block.name !== 'fetch_page') continue; // web_search is server-side
        const args = block.input as { url?: string };
        const url = String(args.url ?? '');
        const result = await fetchPage(url);
        if (result.ok) fetchedUrls.push(result.url);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: fetchResultToToolContent(result),
          is_error: !result.ok,
        });
      }
      if (toolResults.length === 0) continue;
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // Any non-tool_use stop: the model produced some or all of its final
    // answer text on this turn. Collect the text blocks now — with server
    // web_search the response is interleaved: text, server_tool_use,
    // web_search_tool_result, text, more search, text — so we must join
    // ALL text blocks, in order, not just the first one.
    collectedTurns.push(response.content as Anthropic.ContentBlock[]);

    if (response.stop_reason === 'pause_turn') {
      // Model paused mid-turn (server web_search chain got long). Per the
      // SDK contract, we continue by re-invoking with the paused assistant
      // response appended — no user message needed. The next turn's text
      // blocks continue where these left off.
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }

    // end_turn, max_tokens, stop_sequence, refusal → the model is done.
    break;
  }

  const briefRaw = joinBriefFromTurns(collectedTurns);
  const brief = parseBrief(briefRaw);
  const usage: StageUsage = {
    inputTokens: totalInput,
    cacheReadTokens: totalCacheRead,
    cacheWriteTokens: totalCacheWrite,
    outputTokens: totalOutput,
    webSearchRequests: totalWebSearches,
    approxCostUsd:
      sonnetCostUsd({
        inputTokens: totalInput,
        outputTokens: totalOutput,
        cacheReadTokens: totalCacheRead,
        cacheWriteTokens: totalCacheWrite,
      })
      + (totalWebSearches * 0.01),
  };
  return { brief, briefRaw, fetchedUrls, stopReasons, usage };
}

/**
 * Join all text blocks from every collected turn, in order. Then trim the
 * result to start at the LAST occurrence of "SINGLE STORY:" so any
 * preamble the model wrote before starting the brief ("I now have enough
 * information…") gets dropped.
 *
 * Exported for direct testing without an SDK mock.
 */
export function joinBriefFromTurns(turns: Anthropic.ContentBlock[][]): string {
  const chunks: string[] = [];
  for (const turn of turns) {
    for (const block of turn) {
      if (block.type === 'text') chunks.push(block.text);
    }
  }
  const joined = chunks.join('');
  const lastSingleStoryIdx = joined.lastIndexOf('SINGLE STORY:');
  if (lastSingleStoryIdx >= 0) return joined.slice(lastSingleStoryIdx);
  return joined;
}

function buildUserMessage(input: ReporterInput): string {
  const parts: string[] = [];
  parts.push(`Source: ${input.source}`);
  parts.push(`Headline: ${input.headline}`);
  if (input.url) parts.push(`URL: ${input.url}`);
  if (input.articleText) {
    parts.push('');
    parts.push('Article text:');
    parts.push(input.articleText.slice(0, 16000));
  }
  parts.push('');
  parts.push('Research this story. Use web_search to find other coverage, and fetch_page to read a source in full before citing it. Return the BRIEF in the required format.');
  return parts.join('\n');
}
