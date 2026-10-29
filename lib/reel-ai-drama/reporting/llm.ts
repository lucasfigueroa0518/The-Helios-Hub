import fs from 'node:fs';
import path from 'node:path';

import type Anthropic from '@anthropic-ai/sdk';

import { priceAnthropicMessages, type MessageUsageLike } from '@/lib/anthropic-pricing';

/**
 * Small plumbing shared by reporting and the harvest's looks: the send function (a stub in tests),
 * the JSONL response log and pricing. Prompt words never live here (B3's prompts, `loadPrompt`).
 */

/** `client.messages.stream(params).finalMessage()` live; a canned reply in tests. */
export type CreateMessage = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;

/** The live send function: always streamed (long reporting turns go past the SDK's non-streaming limit). */
export function streamingCreate(client: Anthropic): CreateMessage {
  return (params) => client.messages.stream(params).finalMessage();
}

export const LOG_DIR = path.join('.explainers-local', 'reel-ai-drama', 'logs');

/** A JSONL writer for one component's responses; `dir` defaults to LOG_DIR under the cwd. */
export function jsonlLog(component: string, id: string, dir: string = LOG_DIR): (entry: Record<string, unknown>) => void {
  const file = path.join(dir, `${component}-${id}.jsonl`);
  return (entry) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  };
}

export function messagesUsd(usages: readonly MessageUsageLike[], model: string): number {
  return usages.length ? Number(priceAnthropicMessages(usages, { modelId: model }).costUsd) : 0;
}

/** Token totals across a turn's messages, for the cost ledger. */
export function usageTotals(usages: readonly MessageUsageLike[]) {
  const sum = (pick: (u: MessageUsageLike['usage']) => number | null | undefined) =>
    usages.reduce((n, m) => n + Number(pick(m.usage) ?? 0), 0);
  return {
    inputTokens: sum((u) => u.input_tokens),
    outputTokens: sum((u) => u.output_tokens),
    cacheReadTokens: sum((u) => u.cache_read_input_tokens),
    cacheWriteTokens: sum((u) => u.cache_creation_input_tokens),
    webSearches: sum((u) => u.server_tool_use?.web_search_requests),
  };
}
