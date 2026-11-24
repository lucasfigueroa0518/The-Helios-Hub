import type Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText, withToolCache } from '@/lib/anthropic-cache';
import { priceAnthropicMessages } from '@/lib/anthropic-pricing';
import { CONTENT_LEAVES, WANTS, type ContentLeaf, type Want } from '@/lib/field-notes/types';
import { recordCost as recordReelsCost } from '@/lib/reels/repository';

import { CLASSIFY_MAX_OUTPUT_TOKENS, Ledger, ONE_BOX_VERIFY_MODEL, classifyWorstCaseUsd } from './budget';
import { FIELDNOTES_CLASSIFY_SYSTEM, FIELDNOTES_CLASSIFY_TOOL } from './prompts';
import type { Client, CostRecorder } from './search';

export const NOT_A_KIND = "That didn't match a Field Notes kind; nothing was added.";

export const defaultClassifyCost: CostRecorder = (usd, inputTokens, outputTokens) =>
  recordReelsCost({ runId: null, vendor: 'anthropic', component: 'one-box-classify', inputTokens, outputTokens, usd });

/** True when `leaf` and `want` are on the Field Notes lists. */
export function validKind(leaf: unknown, want: unknown): { leaf: ContentLeaf; want: Want } | null {
  const l = CONTENT_LEAVES.find((x) => x === leaf);
  const w = WANTS.find((x) => x === want);
  return l && w ? { leaf: l, want: w } : null;
}

/**
 * Field Notes with a link (the link is the source, so nothing is searched or read): one small call that sorts the person's own
 * words into a leaf and a want. The system prompt and tool are the cached prefix; the words go only in the user turn.
 */
export async function classifyLeafWant(i: { client: Client; ledger: Ledger; blurb: string; recordCost?: CostRecorder }): Promise<{ leaf: ContentLeaf; want: Want } | { error: string }> {
  if (!i.ledger.canAfford(classifyWorstCaseUsd())) return { error: 'budget' };
  const message = await i.client.messages.create({
    model: ONE_BOX_VERIFY_MODEL,
    max_tokens: CLASSIFY_MAX_OUTPUT_TOKENS,
    system: cachedSystemText(FIELDNOTES_CLASSIFY_SYSTEM),
    tools: [withToolCache(FIELDNOTES_CLASSIFY_TOOL as Anthropic.Tool)],
    tool_choice: { type: 'tool', name: FIELDNOTES_CLASSIFY_TOOL.name },
    messages: [{ role: 'user', content: `The person's words:\n${i.blurb}` }],
  });
  const priced = priceAnthropicMessages([message], { modelId: ONE_BOX_VERIFY_MODEL, fallbackCacheTtl: '1h' });
  const usd = Number(priced.costUsd);
  i.ledger.add(usd);
  const inputTokens = priced.uncached_input_tokens + priced.cache_read_input_tokens + priced['cache_creation.ephemeral_5m_input_tokens'] + priced['cache_creation.ephemeral_1h_input_tokens'];
  await (i.recordCost ?? defaultClassifyCost)(usd, inputTokens, priced.output_tokens).catch(() => undefined);
  const block = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === FIELDNOTES_CLASSIFY_TOOL.name);
  const v = (block?.input ?? {}) as { leaf?: unknown; want?: unknown };
  return validKind(v.leaf, v.want) ?? { error: NOT_A_KIND };
}
