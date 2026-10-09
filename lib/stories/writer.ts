/**
 * One structured Claude call for Stories' writing steps (S-21): the latest
 * Sonnet, prompt caching, a strict output tool, the account's server-side
 * refusal fallback, and Stories' own cost rows.
 *
 *   - Cache: tools (breakpoint on the last tool) → system (instructions plus
 *     the frozen humanizer, one breakpoint) are the stable prefix; the day's
 *     material is the uncached user turn.
 *   - Sonnet 5.5 rejects a forced tool_choice, so tool_choice is auto, the tool
 *     is strict, and the system prompt says to call it once.
 *   - fallbacks: "default" (beta server-side-fallback-2026-07-01): a refusal is
 *     retried server-side on the model the category routes to.
 *   - Web search (fvp-pair@1 only) is a server tool; a `pause_turn` is resumed.
 *
 * Tests pass a stubbed `create`; nothing here runs offline against the API.
 */
import type Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText, withToolCache } from '@/lib/anthropic-cache';
import { newAnthropic } from '@/lib/anthropic-client';
import { priceCall, type CallUsage } from '@/lib/stories/cost';
import type { StoriesDb } from '@/lib/stories/db';
import { recordCost } from '@/lib/stories/repository';

export type WriterCreate = (params: Record<string, unknown>) => Promise<Anthropic.Message>;

export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/** Web search: $10 per 1,000 searches. */
export const WEB_SEARCH_USD = 0.01;

/** The live call: the beta endpoint, so the refusal fallback can ride along. */
export function liveWriterCreate(): WriterCreate {
  const client = newAnthropic();
  return (params) =>
    (client.beta.messages.create as unknown as (p: Record<string, unknown>) => Promise<Anthropic.Message>)({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' });
}

export type StructuredRequest = {
  create: WriterCreate;
  db: StoriesDb;
  setId: string | null;
  /** Prompt id, logged as the cost component. */
  component: string;
  model: string;
  system: string;
  tool: { name: string; description: string; input_schema: Record<string, unknown> };
  user: string;
  webSearch?: { maxUses: number };
  webFetch?: { maxUses: number };
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
};

export class WriterError extends Error {
  constructor(message: string, readonly usage: CallUsage[]) {
    super(message);
  }
}

/** Ask once; return the tool's input. A refusal, no tool call, or an unknown shape throws. */
export async function writeStructured<T>(req: StructuredRequest): Promise<{ value: T; usage: CallUsage[] }> {
  const serverTools: Array<Record<string, unknown>> = [];
  if (req.webSearch) serverTools.push({ type: 'web_search_20260209', name: 'web_search', max_uses: req.webSearch.maxUses });
  if (req.webFetch) serverTools.push({ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: req.webFetch.maxUses });
  const tools = [...serverTools, withToolCache({ ...req.tool, strict: true } as unknown as Anthropic.Tool)];
  const messages: Array<Record<string, unknown>> = [{ role: 'user', content: req.user }];
  const usage: CallUsage[] = [];
  for (let turn = 0; turn < 4; turn++) {
    const res = await req.create({
      model: req.model,
      max_tokens: req.maxTokens ?? 16000,
      output_config: { effort: req.effort ?? 'medium' },
      system: cachedSystemText(req.system),
      tools,
      tool_choice: { type: 'auto' },
      messages,
    });
    const u = priceFor(res, req.model);
    usage.push(u);
    const searches = Number((res.usage as { server_tool_use?: { web_search_requests?: number } }).server_tool_use?.web_search_requests ?? 0);
    await recordCost(req.db, { setId: req.setId, vendor: 'anthropic', component: req.component, model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, cacheReadTokens: u.cacheReadTokens, cacheWriteTokens: u.cacheWriteTokens, usd: u.usd });
    if (searches > 0) await recordCost(req.db, { setId: req.setId, vendor: 'web_search', component: req.component, usd: searches * WEB_SEARCH_USD });
    if (res.stop_reason === 'refusal') throw new WriterError(`${req.component}: refused`, usage);
    const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === req.tool.name);
    if (block) return { value: block.input as T, usage };
    if (res.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: res.content });
      continue;
    }
    throw new WriterError(`${req.component}: no ${req.tool.name} call (stop: ${res.stop_reason})`, usage);
  }
  throw new WriterError(`${req.component}: still paused after 4 turns`, usage);
}

/** Price by the model that actually answered (a fallback may have). */
function priceFor(res: Anthropic.Message, requested: string): CallUsage {
  try {
    return priceCall(res.model || requested, res.usage);
  } catch {
    return priceCall(requested, res.usage);
  }
}
