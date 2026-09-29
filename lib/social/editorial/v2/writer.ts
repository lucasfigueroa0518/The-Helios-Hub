/**
 * Writer stage — writes the DRAFT from BRIEF + SOURCES. Optionally receives
 * PREVIOUS POST + FACT-CHECK FLAGS (fact-check rerun) or PREVIOUS POST +
 * REVIEWER NOTES (human critique on regenerate).
 */

import type Anthropic from '@anthropic-ai/sdk';

import { anthropic } from '@/lib/anthropic';
import { cachedSystemText, cacheUsageFromMessage } from '@/lib/anthropic-cache';
import { EDITORIAL_MODEL, sonnetCostUsd } from '@/lib/social/editorial/config';

import { WRITER_PROMPT } from './prompts/writer';
import { type Brief, type FactCheckFlag, parseDraft, type ParsedPost } from './parse';
import type { StageUsage } from './log';

export type WriterInput = {
  brief: Brief;
  briefRaw: string;
  sourceTexts: FetchedSource[];
  previousPost?: string;
  factCheckFlags?: FactCheckFlag[];
  reviewerNotes?: string;
};

export type FetchedSource = { url: string; title?: string | null; text: string };

export type WriterOutput = {
  post: ParsedPost;
  raw: string;
  /**
   * stop_reason of every messages.create response the stage made (usually
   * one; multiple only when a stage retries on max_tokens).
   */
  stopReasons: string[];
  usage: StageUsage;
};

export async function runWriter(input: WriterInput): Promise<WriterOutput> {
  const messages = buildWriterMessages(input);
  const response = await anthropic.messages.create({
    model: EDITORIAL_MODEL,
    max_tokens: 3500,
    system: cachedSystemText(WRITER_PROMPT, '1h'),
    messages,
  });
  const raw = extractText(response);
  const post = parseDraft(raw);
  return {
    post,
    raw,
    stopReasons: [String(response.stop_reason ?? 'unknown')],
    usage: usageFromResponse(response),
  };
}

/**
 * Cost-cut #1: split user message into [BRIEF + SOURCES] prefix (cached) and
 * [PREVIOUS POST + FACT-CHECK FLAGS / REVIEWER NOTES] suffix (varies per
 * rerun). Fact-check reruns of the Writer within one pipeline run share the
 * cached prefix.
 */
export function buildWriterMessages(input: WriterInput): Anthropic.MessageParam[] {
  const prefixParts: string[] = ['BRIEF:', input.briefRaw.trim(), '', 'SOURCES:'];
  for (const src of input.sourceTexts) {
    prefixParts.push(`[URL] ${src.url}`);
    if (src.title) prefixParts.push(`[TITLE] ${src.title}`);
    prefixParts.push(src.text);
    prefixParts.push('---');
  }

  const suffixParts: string[] = [];
  if (input.previousPost) {
    suffixParts.push('PREVIOUS POST:');
    suffixParts.push(input.previousPost);
  }
  if (input.factCheckFlags && input.factCheckFlags.length > 0) {
    if (suffixParts.length > 0) suffixParts.push('');
    suffixParts.push('FACT-CHECK FLAGS:');
    suffixParts.push(formatFactCheckFlags(input.factCheckFlags));
  }
  if (input.reviewerNotes) {
    if (suffixParts.length > 0) suffixParts.push('');
    suffixParts.push('REVIEWER NOTES:');
    suffixParts.push(input.reviewerNotes.trim());
  }

  const content: Anthropic.TextBlockParam[] = [
    { type: 'text', text: prefixParts.join('\n'), cache_control: { type: 'ephemeral', ttl: '1h' } },
  ];
  if (suffixParts.length > 0) {
    content.push({ type: 'text', text: suffixParts.join('\n') });
  }
  return [{ role: 'user', content }];
}

/** Legacy string form kept for tests that inspect the assembled prompt. */
export function buildWriterUserMessage(input: WriterInput): string {
  const [{ content }] = buildWriterMessages(input);
  if (typeof content === 'string') return content;
  return content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
}

export function formatFactCheckFlags(flags: FactCheckFlag[]): string {
  const out: string[] = [];
  for (const flag of flags) {
    out.push(`WHERE: ${flag.where}`);
    out.push(`TEXT: ${flag.text}`);
    out.push(`PROBLEM: ${flag.problem}`);
    out.push(`SOURCES SAY: ${flag.sourcesSay}`);
    out.push(`SIZE: ${flag.size}`);
    out.push('');
  }
  return out.join('\n').trim();
}

export function extractText(response: Anthropic.Message): string {
  const block = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === 'text',
  );
  if (!block) throw new Error('stage: model returned no text block');
  return block.text;
}

export function usageFromResponse(response: Anthropic.Message): StageUsage {
  const cache = cacheUsageFromMessage(response);
  const output = Math.max(0, Number(response.usage.output_tokens ?? 0));
  return {
    inputTokens: cache.inputTokens,
    cacheReadTokens: cache.cacheReadTokens,
    cacheWriteTokens: cache.cacheWriteTokens,
    outputTokens: output,
    approxCostUsd: sonnetCostUsd({
      inputTokens: cache.inputTokens,
      outputTokens: output,
      cacheReadTokens: cache.cacheReadTokens,
      cacheWriteTokens: cache.cacheWriteTokens,
    }),
  };
}
