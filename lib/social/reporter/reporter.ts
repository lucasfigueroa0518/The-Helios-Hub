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

import { BriefValidationError, SUBMIT_BRIEF_TOOL, dropAggregatorOnly, validateBrief, type Brief } from './brief';
import { REPORTER_SYSTEM, reporterUserMessage, type ReporterStoryInput } from './prompt';
import { readPage as readPageLive, type PageRead, type PageReadOk } from './read-page';

/** Server web search with dynamic filtering (Sonnet 5.5 / Opus 5.5 and later). */
export const WEB_SEARCH_TOOL_TYPE = 'web_search_20260209';
/** Searches per story. The prompt asks for ~12 tool calls in total. */
export const WEB_SEARCH_MAX_USES = 8;
/** A submission that fails the code check gets this many retries (spec §7.1: glitches get one). */
export const MAX_SUBMIT_RETRIES = 1;
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
  // Not strict: one url field gains nothing, and the API caps the combined
  // grammar of strict tools (submit_brief is the one that needs it).
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
export const REPORTER_TOOLS: Anthropic.ToolUnion[] = [WEB_SEARCH_TOOL, READ_PAGE_TOOL, withToolCache(SUBMIT_BRIEF_TOOL)];

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

export type TurnUsage = { turn: number; stopReason: string | null; usage: unknown; costUsd: number };

export type ReporterResult =
  | { ok: true; brief: Brief; raw: string; pages: PageReadOk[]; costUsd: number; turns: number; webSearches: number; pageReads: number; submitRetries: number; retryErrors: string[]; turnUsage: TurnUsage[]; aggregatorDropped: string[] }
  | { ok: false; reason: 'malformed-output' | 'service-error' | 'refused' | 'cost-cap'; detail: string; raw: string | null; costUsd: number; turns: number; webSearches: number; pageReads: number; submitRetries: number; retryErrors: string[]; turnUsage: TurnUsage[] };

export type ReporterDeps = {
  create: MessagesCreate;
  readPage?: (url: string) => Promise<PageRead>;
  config?: StageModelConfig;
  /** Spend limit for this story; see CAP_MARGIN_USD for the rule. */
  costCapUsd?: number;
};

/**
 * Cap rule (Tommy, 2026-10-05): before each turn, stop if actual spend so
 * far ≥ cap − CAP_MARGIN_USD; otherwise run the turn. No prediction.
 */
export const CAP_MARGIN_USD = 0.1;

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
  let submitRetries = 0;
  /** The check errors that triggered each retry (logged). */
  const retryErrors: string[] = [];
  /** Per-turn usage as the API reported it (stored in the run log). */
  const turnUsage: TurnUsage[] = [];
  const cost = () => Number(priceAnthropicMessages(responses, { modelId: config.model }).costUsd);
  const webSearches = () =>
    responses.reduce((n, r) => n + (r.usage.server_tool_use?.web_search_requests ?? 0), 0);

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    if (deps.costCapUsd !== undefined && cost() >= deps.costCapUsd - CAP_MARGIN_USD) {
      return { ok: false, reason: 'cost-cap', detail: `stopped before turn ${turn}: $${cost().toFixed(4)} spent, cap $${deps.costCapUsd} minus $${CAP_MARGIN_USD} margin`, raw: null, costUsd: cost(), turns: turn - 1, webSearches: webSearches(), pageReads, submitRetries, retryErrors, turnUsage };
    }
    let res: Anthropic.Message;
    try {
      res = await deps.create({
        model: config.model,
        max_tokens: MAX_TOKENS,
        system,
        tools: REPORTER_TOOLS,
        // Mark the newest user block for the growing conversation. After a
        // pause_turn the last message is the assistant's own (possibly a
        // server-tool block), so only the stable tools+system prefix is marked.
        messages: messages[messages.length - 1]!.role === 'user' ? withConversationCache(messages) : messages,
        output_config: { effort: config.effort },
      } as Anthropic.MessageCreateParamsNonStreaming);
    } catch (err) {
      return { ok: false, reason: 'service-error', detail: `Claude call failed: ${err instanceof Error ? err.message : String(err)}`, raw: null, costUsd: cost(), turns: turn, webSearches: webSearches(), pageReads, submitRetries, retryErrors, turnUsage };
    }
    responses.push(res as unknown as MessageUsageLike);
    turnUsage.push({
      turn,
      stopReason: res.stop_reason,
      usage: res.usage,
      costUsd: Number(priceAnthropicMessages([res as unknown as MessageUsageLike], { modelId: config.model }).costUsd),
    });

    if (res.stop_reason === 'refusal') {
      const details = (res as unknown as { stop_details?: { category?: string | null } }).stop_details;
      return { ok: false, reason: 'refused', detail: `refusal (${details?.category ?? 'no category'})`, raw: textOf(res) || null, costUsd: cost(), turns: turn, webSearches: webSearches(), pageReads, submitRetries, retryErrors, turnUsage };
    }
    if (res.stop_reason === 'max_tokens') {
      return { ok: false, reason: 'malformed-output', detail: 'brief cut off at max_tokens', raw: textOf(res) || null, costUsd: cost(), turns: turn, webSearches: webSearches(), pageReads, submitRetries, retryErrors, turnUsage };
    }

    // Keep the full content (thinking, server tool blocks) so the next turn continues the same conversation.
    messages.push({ role: 'assistant', content: res.content as Anthropic.ContentBlockParam[] });

    if (res.stop_reason === 'pause_turn') continue; // server tool paused mid-turn: resend as is

    const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    const submit = toolUses.find((u) => u.name === SUBMIT_BRIEF_TOOL.name);
    if (submit) {
      // The final step: the brief as JSON, then the code check.
      const raw = JSON.stringify(submit.input, null, 2);
      try {
        // Aggregator-only facts go back while a retry is left; after that, code drops them (logged).
        const checked = validateBrief(submit.input, { aggregators: submitRetries < MAX_SUBMIT_RETRIES });
        const { brief, dropped } = dropAggregatorOnly(checked);
        return { ok: true, brief, raw, pages, costUsd: cost(), turns: turn, webSearches: webSearches(), pageReads, submitRetries, retryErrors, turnUsage, aggregatorDropped: dropped };
      } catch (err) {
        const detail = err instanceof BriefValidationError ? err.message : `brief check failed: ${String(err)}`;
        // A failed check is a glitch (spec §7.1): one retry with the errors, then set aside.
        if (submitRetries >= MAX_SUBMIT_RETRIES) {
          return { ok: false, reason: 'malformed-output', detail, raw, costUsd: cost(), turns: turn, webSearches: webSearches(), pageReads, submitRetries, retryErrors, turnUsage };
        }
        submitRetries++;
        retryErrors.push(detail);
        const others = toolUses.filter((u) => u !== submit);
        const content: Anthropic.ToolResultBlockParam[] = [
          { type: 'tool_result', tool_use_id: submit.id, is_error: true, content: `The brief failed the check. Fix these and call submit_brief again:\n${detail}` },
          ...others.map((u): Anthropic.ToolResultBlockParam => ({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: 'Not run: submit_brief was called in the same turn.' })),
        ];
        messages.push({ role: 'user', content });
        continue;
      }
    }
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

    // end_turn without submit_brief: no brief.
    return { ok: false, reason: 'malformed-output', detail: 'ended without calling submit_brief', raw: textOf(res) || null, costUsd: cost(), turns: turn, webSearches: webSearches(), pageReads, submitRetries, retryErrors, turnUsage };
  }
  return { ok: false, reason: 'malformed-output', detail: `no brief after ${MAX_TURNS} turns`, raw: null, costUsd: cost(), turns: MAX_TURNS, webSearches: webSearches(), pageReads, submitRetries, retryErrors, turnUsage };
}
