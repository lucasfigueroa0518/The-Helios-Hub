/**
 * Reporter stage (spec §3, §4): research one picked story with web search
 * and the raw-text page reader, return a parsed brief.
 *
 * Claude Messages API, manual tool loop:
 *   tools  = [web_search (server), read_page (client, cached last)]
 *   system = REPORTER_SYSTEM (static, cached)
 *   messages grow each turn; withConversationCache marks only the last block.
 * Prompt caching per CLAUDE.md: tools → system → messages, stable prefix
 * first, the per-story STORY line in the first user message.
 *
 * The Claude client is injected (`create`), so tests stub it and nothing
 * here can reach the live API by accident.
 */
import type Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText, withConversationCache, withToolCache } from '@/lib/anthropic-cache';
import { priceAnthropicMessages, type MessageUsageLike } from '@/lib/anthropic-pricing';
import { STAGE_MODELS, type StageModelConfig } from '@/lib/social/pipeline/models';

import { BriefParseError, parseBrief, type Brief } from './brief';
import { REPORTER_SYSTEM, reporterUserMessage, type ReporterStoryInput } from './prompt';
import { readPage as readPageLive, type PageRead, type PageReadOk } from './read-page';

/** Server web search with dynamic filtering (Sonnet 5.5 / Opus 5.5 and later). */
export const WEB_SEARCH_TOOL_TYPE = 'web_search_20260209';
/** Searches per story. The prompt asks for ~12 tool calls in total. */
export const WEB_SEARCH_MAX_USES = 8;
/** Hard ceiling on read_page calls; past it, calls get an error result. */
export const READ_PAGE_MAX_CALLS = 12;
/** Model turns before the stage gives up (a turn can carry several tool calls). */
export const MAX_TURNS = 16;
const MAX_TOKENS = 16_000;

export const READ_PAGE_TOOL: Anthropic.Tool = {
  name: 'read_page',
  description:
    "Fetch one web page by URL and return its raw article text (never a summary) plus every photo in the article with its caption and credit line exactly as the page shows them. Google News links are resolved to the publisher first. Use it to open the starting sources and any coverage you found with web_search before citing it.",
  input_schema: {
    type: 'object',
    properties: { url: { type: 'string', description: 'Absolute URL of the page to read.' } },
    required: ['url'],
    additionalProperties: false,
  },
  strict: true,
} as Anthropic.Tool;

/**
 * SDK 0.65 types only web_search_20250305; the API accepts the 2026-02-09
 * variant on Sonnet 5.5. Cast at this one boundary.
 */
const WEB_SEARCH_TOOL = {
  type: WEB_SEARCH_TOOL_TYPE,
  name: 'web_search',
  max_uses: WEB_SEARCH_MAX_USES,
} as unknown as Anthropic.ToolUnion;

/** Stable tool list; the cache breakpoint sits on the last tool. */
export const REPORTER_TOOLS: Anthropic.ToolUnion[] = [WEB_SEARCH_TOOL, withToolCache(READ_PAGE_TOOL)];

export type MessagesCreate = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;

/**
 * Live client call. No refusal fallback (Tommy, 2026-10-04): a refusal
 * stays on the stage's model and sets the story aside as "refused".
 */
export function liveMessagesCreate(client: Anthropic): MessagesCreate {
  return (params) => client.messages.create(params);
}

/** Tool-result text for one page read: header, photos, then the raw text. */
export function pageToToolText(page: PageRead): string {
  if (!page.ok) return `ERROR reading ${page.url}: ${page.error}`;
  const header = [
    `URL: ${page.url}`,
    page.resolvedUrl !== page.url ? `RESOLVED URL: ${page.resolvedUrl}` : null,
    page.title ? `TITLE: ${page.title}` : null,
    page.byline ? `BYLINE: ${page.byline}` : null,
    page.publishedTime ? `PUBLISHED: ${page.publishedTime}` : null,
  ].filter(Boolean);
  const photos = page.photos.length
    ? page.photos.map((p) => `- ${p.caption ?? '(no caption)'} | ${p.credit ?? '(no credit)'} | ${p.src}`).join('\n')
    : '- none';
  return `${header.join('\n')}\n\nPHOTOS (caption | credit | URL):\n${photos}\n\nTEXT${page.truncated ? ' (truncated)' : ''}:\n${page.text}`;
}

export type ReporterResult =
  | { ok: true; brief: Brief; raw: string; pages: PageReadOk[]; costUsd: number; turns: number; webSearches: number; pageReads: number }
  | { ok: false; reason: 'malformed-output' | 'service-error' | 'refused' | 'cost-cap'; detail: string; raw: string | null; costUsd: number; turns: number };

export type ReporterDeps = {
  create: MessagesCreate;
  readPage?: (url: string) => Promise<PageRead>;
  config?: StageModelConfig;
  /**
   * Hard spend limit for this story (an approved budget for a live run).
   * Before each turn the worst case of that turn is estimated (input, all
   * searches, output) and max_tokens is cut to what the cap still affords;
   * when that's under MIN_TURN_OUTPUT_TOKENS the loop stops. The cap can't
   * be passed by a turn in flight.
   */
  costCapUsd?: number;
};

/** Worst-case input price per token: Sonnet 5.5's 1h cache-write rate ($4/M), above the $2 uncached rate. */
const WORST_INPUT_USD_PER_TOKEN = 4 / 1_000_000;
const OUTPUT_USD_PER_TOKEN = 10 / 1_000_000;
const SEARCH_USD = 0.01;
/** A turn with less room than this can't write a brief; stop instead. */
export const MIN_TURN_OUTPUT_TOKENS = 6_000;

const textOf = (message: Anthropic.Message) =>
  message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

export async function runReporter(input: ReporterStoryInput, deps: ReporterDeps): Promise<ReporterResult> {
  const config = deps.config ?? STAGE_MODELS.reporter;
  const readPage = deps.readPage ?? ((url: string) => readPageLive(url));
  const system = cachedSystemText(REPORTER_SYSTEM);
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: reporterUserMessage(input) }];
  const responses: MessageUsageLike[] = [];
  const pages: PageReadOk[] = [];
  let pageReads = 0;
  const cost = () => Number(priceAnthropicMessages(responses, { modelId: config.model }).costUsd);
  const webSearches = () =>
    responses.reduce((n, r) => n + (r.usage.server_tool_use?.web_search_requests ?? 0), 0);

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    let maxTokens = MAX_TOKENS;
    if (deps.costCapUsd !== undefined) {
      // Next turn's input ≈ the whole conversation so far, ~4 chars/token.
      // Floor: the next turn re-reads at least everything the last one read and wrote.
      const last = responses.at(-1)?.usage;
      const lastTokens = last
        ? (last.input_tokens ?? 0) + (last.cache_read_input_tokens ?? 0) + (last.cache_creation_input_tokens ?? 0) + (last.output_tokens ?? 0)
        : 0;
      const inputTokens = Math.max(lastTokens, Math.ceil(JSON.stringify({ system, tools: REPORTER_TOOLS, messages }).length / 3.5));
      const fixed = cost() + inputTokens * WORST_INPUT_USD_PER_TOKEN + WEB_SEARCH_MAX_USES * SEARCH_USD;
      const affordable = Math.floor((deps.costCapUsd - fixed) / OUTPUT_USD_PER_TOKEN);
      if (affordable < MIN_TURN_OUTPUT_TOKENS) {
        return { ok: false, reason: 'cost-cap', detail: `stopped before turn ${turn}: $${cost().toFixed(4)} spent; next turn's worst case would pass the $${deps.costCapUsd} cap`, raw: null, costUsd: cost(), turns: turn - 1 };
      }
      maxTokens = Math.min(MAX_TOKENS, affordable);
    }
    let res: Anthropic.Message;
    try {
      res = await deps.create({
        model: config.model,
        max_tokens: maxTokens,
        system,
        tools: REPORTER_TOOLS,
        // Mark the newest user block for the growing conversation. After a
        // pause_turn the last message is the assistant's own (possibly a
        // server-tool block), so only the stable tools+system prefix is marked.
        messages: messages[messages.length - 1]!.role === 'user' ? withConversationCache(messages) : messages,
        output_config: { effort: config.effort },
      } as Anthropic.MessageCreateParamsNonStreaming);
    } catch (err) {
      return { ok: false, reason: 'service-error', detail: `Claude call failed: ${err instanceof Error ? err.message : String(err)}`, raw: null, costUsd: cost(), turns: turn };
    }
    responses.push(res as unknown as MessageUsageLike);

    if (res.stop_reason === 'refusal') {
      const details = (res as unknown as { stop_details?: { category?: string | null } }).stop_details;
      return { ok: false, reason: 'refused', detail: `refusal (${details?.category ?? 'no category'})`, raw: textOf(res) || null, costUsd: cost(), turns: turn };
    }
    if (res.stop_reason === 'max_tokens') {
      return { ok: false, reason: 'malformed-output', detail: 'brief cut off at max_tokens', raw: textOf(res) || null, costUsd: cost(), turns: turn };
    }

    // Keep the full content (thinking, server tool blocks) so the next turn continues the same conversation.
    messages.push({ role: 'assistant', content: res.content as Anthropic.ContentBlockParam[] });

    if (res.stop_reason === 'pause_turn') continue; // server tool paused mid-turn: resend as is

    const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (res.stop_reason === 'tool_use' && toolUses.length > 0) {
      // Every tool_result in ONE user message (parallel tool use).
      const results = await Promise.all(
        toolUses.map(async (use): Promise<Anthropic.ToolResultBlockParam> => {
          if (use.name !== 'read_page') {
            return { type: 'tool_result', tool_use_id: use.id, is_error: true, content: `Unknown tool ${use.name}.` };
          }
          const url = typeof (use.input as { url?: unknown })?.url === 'string' ? (use.input as { url: string }).url : '';
          if (!url) return { type: 'tool_result', tool_use_id: use.id, is_error: true, content: 'read_page needs a url.' };
          if (pageReads >= READ_PAGE_MAX_CALLS) {
            return { type: 'tool_result', tool_use_id: use.id, is_error: true, content: 'Page-reading budget used up. Write the brief now from the sources you have opened.' };
          }
          pageReads++;
          const page = await readPage(url);
          if (page.ok) pages.push(page);
          return { type: 'tool_result', tool_use_id: use.id, is_error: !page.ok, content: pageToToolText(page) };
        }),
      );
      messages.push({ role: 'user', content: results });
      continue;
    }

    // end_turn (or stop_sequence): the brief.
    const raw = textOf(res);
    try {
      const brief = parseBrief(raw);
      return { ok: true, brief, raw, pages, costUsd: cost(), turns: turn, webSearches: webSearches(), pageReads };
    } catch (err) {
      const detail = err instanceof BriefParseError ? err.message : `brief parse failed: ${String(err)}`;
      return { ok: false, reason: 'malformed-output', detail, raw, costUsd: cost(), turns: turn };
    }
  }
  return { ok: false, reason: 'malformed-output', detail: `no brief after ${MAX_TURNS} turns`, raw: null, costUsd: cost(), turns: MAX_TURNS };
}
