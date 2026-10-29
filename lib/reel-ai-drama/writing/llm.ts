import { appendFile, mkdir } from 'node:fs/promises';
import { coerceJsonStrings } from '@/lib/reel-ai-drama/tool-input';
import path from 'node:path';

import type Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText } from '@/lib/anthropic-cache';
import { priceAnthropicMessages, usageBucketsFromMessage, type MessageUsageLike } from '@/lib/anthropic-pricing';
import type { Queryable } from '@/lib/explainers/db';
import { recordCost } from '@/lib/reel-ai-drama/cost';
import type { Mode } from '@/lib/reel-ai-drama/types';

/**
 * One strict submit-tool call, shared by the writer, director, post text and the model checks.
 *
 * Caching: the role prompt and craft are the system prefix, marked once (`cachedSystemText`, 1h), and
 * the per-story data goes in the user message after it. A validation fix appends to the conversation
 * (assistant turn as returned, thinking blocks included, then an error tool_result), so the cached
 * prefix and the turn so far stay byte-identical.
 */

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** The Messages params we send; `output_config` (effort) is newer than the SDK's types. */
export type SubmitParams = Anthropic.MessageCreateParamsNonStreaming & { output_config?: { effort: Effort } };

/** `client.messages.stream(...).finalMessage()` in production (liveSend); a canned stub in tests. */
export type SendMessage = (params: SubmitParams) => Promise<Anthropic.Message>;

/** Where a call's cost is recorded. */
export type Ledger = {
  db: Queryable;
  mode: Mode;
  jobId?: string | null;
  pitchId?: string | null;
  sessionId?: string | null;
};

export type SubmitTool = {
  name: string;
  description: string;
  /** Large nested schemas (script, revision, plan) are not strict: their grammar is too large for the API; the validators check them. */
  strict: boolean;
  input_schema: Record<string, unknown>;
};

/** A parser returns the typed value and every problem the model must fix (empty when it's valid). */
export type Parsed<T> = { value: T | null; problems: string[] };

export type SubmitRequest<T> = {
  /** Pipeline step for the cost ledger and the log (`writer`, `director`, `post_text`…). */
  component: string;
  model: string;
  system: string;
  user: string | Anthropic.ContentBlockParam[];
  tool: SubmitTool;
  maxTokens: number;
  effort?: Effort;
  parse: (input: unknown) => Parsed<T>;
  /** Validation fix rounds after the first submit (default 1). */
  fixes?: number;
};

export type SubmitResult<T> = { value: T; usd: number; calls: number };

/** A call that failed, carrying what it cost (already recorded in the ledger). */
export class WritingError extends Error {
  constructor(
    message: string,
    readonly usd: number,
    readonly problems: string[] = [],
  ) {
    super(message);
    this.name = 'WritingError';
  }
}

const MAX_CONTINUATIONS = 3;

export function submitParams(req: SubmitRequest<unknown>, messages: Anthropic.MessageParam[]): SubmitParams {
  const params: SubmitParams = {
    model: req.model,
    max_tokens: req.maxTokens,
    tools: [req.tool] as unknown as Anthropic.Tool[],
    // Opus 5.5 and Sonnet 5.5 reject a forced tool choice; the prompt and strict schema steer instead.
    tool_choice: { type: 'auto' },
    system: cachedSystemText(req.system),
    messages,
  };
  if (req.effort) params.output_config = { effort: req.effort };
  return params;
}

function usd(messages: readonly Anthropic.Message[], model: string): number {
  return messages.length ? Number(priceAnthropicMessages(messages as unknown as MessageUsageLike[], { modelId: model }).costUsd) : 0;
}

async function record(ledger: Ledger, component: string, model: string, messages: Anthropic.Message[]): Promise<number> {
  if (!messages.length) return 0;
  const total = usd(messages, model);
  const sum = { input: 0, output: 0, read: 0, write: 0 };
  for (const m of messages) {
    const b = usageBucketsFromMessage(m as unknown as MessageUsageLike);
    sum.input += b.uncachedInputTokens;
    sum.output += b.outputTokens;
    sum.read += b.cacheReadInputTokens;
    sum.write += b.cacheCreation5mInputTokens + b.cacheCreation1hInputTokens;
  }
  await recordCost(ledger.db, {
    sessionId: ledger.sessionId ?? null,
    jobId: ledger.jobId ?? null,
    pitchId: ledger.pitchId ?? null,
    mode: ledger.mode,
    vendor: 'anthropic',
    component,
    inputTokens: sum.input,
    outputTokens: sum.output,
    cacheReadTokens: sum.read,
    cacheWriteTokens: sum.write,
    usd: total,
  });
  return total;
}

function fixMessage(call: Anthropic.ToolUseBlock, problems: string[]): Anthropic.MessageParam {
  return {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: call.id,
        is_error: true,
        content: `Not accepted. Fix every problem below and call ${call.name} again with the whole corrected output:\n- ${problems.join('\n- ')}`,
      },
    ],
  };
}

/**
 * Send until the model calls the submit tool with output that parses clean. Resumes `pause_turn`,
 * nudges once when the turn ends without the call, and gives `fixes` rounds for validation problems.
 * The ledger gets one cost event per request, success or failure.
 */
export async function runSubmit<T>(send: SendMessage, ledger: Ledger, req: SubmitRequest<T>): Promise<SubmitResult<T>> {
  const fixes = req.fixes ?? 1;
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: req.user }];
  const responses: Anthropic.Message[] = [];
  let model = req.model;
  let fixesLeft = fixes;
  let nudged = false;
  let continuations = 0;
  let lastProblems: string[] = [];
  const fail = async (message: string): Promise<never> => {
    const spent = await record(ledger, req.component, model, responses);
    throw new WritingError(`${req.component}: ${message}`, spent, lastProblems);
  };

  for (;;) {
    const message = await send(submitParams(req, messages));
    responses.push(message);
    model = message.model || model;
    if (message.stop_reason === 'max_tokens') return fail('the turn hit max_tokens before submitting');
    if (message.stop_reason === 'refusal') return fail('the model declined the request');
    const call = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === req.tool.name,
    );
    messages.push({ role: 'assistant', content: message.content as unknown as Anthropic.ContentBlockParam[] });
    if (call) {
      const parsed = req.parse(coerceJsonStrings(call.input));
      if (parsed.value && parsed.problems.length === 0) {
        const spent = await record(ledger, req.component, model, responses);
        return { value: parsed.value, usd: spent, calls: responses.length };
      }
      lastProblems = parsed.problems.length ? parsed.problems : ['the output could not be read'];
      if (fixesLeft <= 0) return fail(`output still invalid after ${fixes} fix round(s): ${lastProblems.join('; ')}`);
      fixesLeft -= 1;
      messages.push(fixMessage(call, lastProblems));
      continue;
    }
    if ((message.stop_reason as string) === 'pause_turn') {
      if (continuations >= MAX_CONTINUATIONS) return fail('still paused after continuations');
      continuations += 1;
      continue;
    }
    if (nudged) return fail(`the turn ended (${message.stop_reason}) without calling ${req.tool.name}`);
    nudged = true;
    messages.push({ role: 'user', content: `Submit your work by calling ${req.tool.name} now.` });
  }
}

export const LOG_DIR = path.join('.explainers-local', 'reel-ai-drama', 'logs');

/** The live sender: streams (long outputs need it) and appends every response to a JSONL log. */
export function liveSend(client: Anthropic, opts: { logFile?: string; label?: string } = {}): SendMessage {
  const file = opts.logFile ?? path.join(LOG_DIR, `${opts.label ?? 'writing'}-${new Date().toISOString().slice(0, 10)}.jsonl`);
  return async (params) => {
    const message = await client.messages.stream(params as unknown as Anthropic.MessageStreamParams).finalMessage();
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify({ at: new Date().toISOString(), label: opts.label ?? null, message })}\n`);
    return message;
  };
}

/** Plain JSON for a user message section (stable key order is the caller's object order). */
export function section(title: string, body: unknown): string {
  return `## ${title}\n\n${typeof body === 'string' ? body : `\`\`\`json\n${JSON.stringify(body, null, 2)}\n\`\`\``}`;
}
