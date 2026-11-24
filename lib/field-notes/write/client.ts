/**
 * Call plumbing shared by the Writer, the Editor and the fact checker. The client is injected
 * (live: the budget-guarded client, so every call is metered); this module never builds a real
 * client and makes no network call itself.
 */
import type Anthropic from '@anthropic-ai/sdk';

import { cacheUsageFromMessage } from '@/lib/anthropic-cache';
import type { StageUsage } from './types';

export type FieldNotesClient = {
  messages: { create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> };
};

export type CacheUsage = StageUsage;

export type StageResult = { ok: true; input: unknown; usage: CacheUsage } | { ok: false; reason: string };

const usageOf = (res: Anthropic.Message): CacheUsage => ({ ...cacheUsageFromMessage(res), outputTokens: Number(res.usage.output_tokens ?? 0) });
const addUsage = (a: CacheUsage, b: CacheUsage): CacheUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  totalInputTokens: a.totalInputTokens + b.totalInputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
});

/**
 * One tool call. The tool is not forced (Sonnet 5.5 refuses a forced tool_choice), so an answer without the tool
 * gets ONE follow-up turn asking for it, the way lib/social/writer/structured-call.ts does; the same cached prefix
 * is reused, so the retry is cheap.
 */
export async function callTool(client: FieldNotesClient, params: Anthropic.MessageCreateParamsNonStreaming, tool: string): Promise<StageResult> {
  let messages = params.messages;
  let usage: CacheUsage | null = null;
  for (let turn = 1; turn <= 2; turn++) {
    let res: Anthropic.Message;
    try {
      res = await client.messages.create({ ...params, messages });
    } catch (err) {
      return { ok: false, reason: `Claude call failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    usage = usage ? addUsage(usage, usageOf(res)) : usageOf(res);
    if (res.stop_reason === 'refusal') return { ok: false, reason: 'refused' };
    if (res.stop_reason === 'max_tokens') return { ok: false, reason: 'output cut off at max_tokens' };
    const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === tool);
    if (block) return { ok: true, input: block.input, usage };
    messages = [
      ...messages,
      { role: 'assistant', content: res.content as Anthropic.ContentBlockParam[] },
      { role: 'user', content: `Call ${tool} with the finished result.` },
    ];
  }
  return { ok: false, reason: `ended without calling ${tool}` };
}

