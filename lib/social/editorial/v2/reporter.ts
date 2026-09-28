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
  usage: StageUsage;
};

const DEFAULT_MAX_WEB_SEARCHES = Number(process.env.HELIOS_V2_REPORTER_MAX_WEB_SEARCHES ?? '5');
const DEFAULT_MAX_ITERATIONS = Number(process.env.HELIOS_V2_REPORTER_MAX_ITERATIONS ?? '8');

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
  let finalTextBlock: Anthropic.TextBlock | null = null;

  for (let iter = 0; iter < maxIterations; iter++) {
    const response = await anthropic.messages.create({
      model: EDITORIAL_MODEL,
      max_tokens: 4096,
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

    if (response.stop_reason !== 'tool_use') {
      finalTextBlock = response.content.find(
        (b): b is Anthropic.TextBlock => b.type === 'text',
      ) ?? null;
      break;
    }

    // Assistant turn: echo the whole content array so tool_use blocks are in place.
    messages.push({ role: 'assistant', content: response.content });

    // Execute every client-side tool_use in the response.
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
    if (toolResults.length === 0) {
      // No client tools were called (only server web_search). The model
      // will produce its final text on the next turn; we need to keep
      // looping.
      continue;
    }
    messages.push({ role: 'user', content: toolResults });
  }

  const briefRaw = finalTextBlock?.text ?? '';
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
  return { brief, briefRaw, fetchedUrls, usage };
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
