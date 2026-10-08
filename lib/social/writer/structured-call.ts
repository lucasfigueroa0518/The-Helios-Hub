/**
 * One structured Claude call shared by the Writer, Editor and Fact-checker:
 * a single submit tool, a static cached system prompt, a per-story user
 * message, a code check on the submission, and one retry with the check
 * errors returned in the tool result (spec §7.1 glitch rule).
 *
 * Prompt caching: tools (the one submit tool, cached) → system (static,
 * cached) → user message (per story). The Claude client is injected.
 */
import type Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText, withToolCache } from '@/lib/anthropic-cache';
import { priceAnthropicMessages, type MessageUsageLike } from '@/lib/anthropic-pricing';
import type { StageModelConfig } from '@/lib/social/pipeline/models';
import type { MessagesCreate, TurnUsage } from '@/lib/social/reporter/reporter';

export const MAX_CHECK_RETRIES = 1;
const MAX_TOKENS = 16_000;

export type StructuredFailure = 'malformed-output' | 'service-error' | 'refused';

export type StructuredResult<T> =
  | { ok: true; value: T; raw: string; costUsd: number; turns: number; retries: number; retryErrors: string[]; turnUsage: TurnUsage[] }
  | { ok: false; reason: StructuredFailure; detail: string; raw: string | null; costUsd: number; turns: number; retries: number; retryErrors: string[]; turnUsage: TurnUsage[] };

export type StructuredCall<T> = {
  create: MessagesCreate;
  config: StageModelConfig;
  system: string;
  tool: Anthropic.Tool;
  user: string;
  /** Throws an Error whose message lists the problems; returns the checked value. `attempt` is 1 for the first submission, 2 for the retry. */
  check: (input: unknown, attempt: number) => T;
};

export async function runStructuredCall<T>(call: StructuredCall<T>): Promise<StructuredResult<T>> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: call.user }];
  const tools: Anthropic.ToolUnion[] = [withToolCache(call.tool)];
  const responses: MessageUsageLike[] = [];
  const turnUsage: TurnUsage[] = [];
  const retryErrors: string[] = [];
  let retries = 0;
  const cost = () => Number(priceAnthropicMessages(responses, { modelId: call.config.model }).costUsd);
  const fail = (reason: StructuredFailure, detail: string, raw: string | null, turns: number): StructuredResult<T> =>
    ({ ok: false, reason, detail, raw, costUsd: cost(), turns, retries, retryErrors, turnUsage });

  for (let turn = 1; turn <= 1 + MAX_CHECK_RETRIES; turn++) {
    let res: Anthropic.Message;
    try {
      res = await call.create({
        model: call.config.model,
        max_tokens: MAX_TOKENS,
        system: cachedSystemText(call.system),
        tools,
        messages,
        output_config: { effort: call.config.effort },
      } as Anthropic.MessageCreateParamsNonStreaming);
    } catch (err) {
      return fail('service-error', `Claude call failed: ${err instanceof Error ? err.message : String(err)}`, null, turn);
    }
    responses.push(res as unknown as MessageUsageLike);
    turnUsage.push({
      turn,
      stopReason: res.stop_reason,
      usage: res.usage,
      costUsd: Number(priceAnthropicMessages([res as unknown as MessageUsageLike], { modelId: call.config.model }).costUsd),
    });
    if (res.stop_reason === 'refusal') return fail('refused', 'refusal', null, turn);
    if (res.stop_reason === 'max_tokens') return fail('malformed-output', 'output cut off at max_tokens', null, turn);

    messages.push({ role: 'assistant', content: res.content as Anthropic.ContentBlockParam[] });
    const submit = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === call.tool.name);
    const raw = submit ? JSON.stringify(submit.input, null, 2) : null;
    let detail: string;
    if (submit) {
      try {
        const value = call.check(submit.input, retries + 1);
        return { ok: true, value, raw: raw!, costUsd: cost(), turns: turn, retries, retryErrors, turnUsage };
      } catch (err) {
        detail = err instanceof Error ? err.message : String(err);
      }
    } else {
      detail = `ended without calling ${call.tool.name}`;
    }
    if (retries >= MAX_CHECK_RETRIES) return fail('malformed-output', detail, raw, turn);
    retries++;
    retryErrors.push(detail);
    messages.push({
      role: 'user',
      content: submit
        ? [{ type: 'tool_result', tool_use_id: submit.id, is_error: true, content: `The submission failed the check. Fix these and call ${call.tool.name} again:\n${detail}` }]
        : `Call ${call.tool.name} with the finished result.`,
    });
  }
  return fail('malformed-output', 'no submission', null, 1 + MAX_CHECK_RETRIES);
}
