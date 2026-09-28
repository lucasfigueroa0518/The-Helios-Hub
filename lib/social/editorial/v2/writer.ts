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
  usage: StageUsage;
};

export async function runWriter(input: WriterInput): Promise<WriterOutput> {
  const userText = buildWriterUserMessage(input);
  const response = await anthropic.messages.create({
    model: EDITORIAL_MODEL,
    max_tokens: 3500,
    system: cachedSystemText(WRITER_PROMPT, '1h'),
    messages: [{ role: 'user', content: userText }],
  });
  const raw = extractText(response);
  const post = parseDraft(raw);
  return { post, raw, usage: usageFromResponse(response) };
}

export function buildWriterUserMessage(input: WriterInput): string {
  const parts: string[] = [];
  parts.push('BRIEF:');
  parts.push(input.briefRaw.trim());
  parts.push('');
  parts.push('SOURCES:');
  for (const src of input.sourceTexts) {
    parts.push(`[URL] ${src.url}`);
    if (src.title) parts.push(`[TITLE] ${src.title}`);
    parts.push(src.text);
    parts.push('---');
  }
  if (input.previousPost) {
    parts.push('');
    parts.push('PREVIOUS POST:');
    parts.push(input.previousPost);
  }
  if (input.factCheckFlags && input.factCheckFlags.length > 0) {
    parts.push('');
    parts.push('FACT-CHECK FLAGS:');
    parts.push(formatFactCheckFlags(input.factCheckFlags));
  }
  if (input.reviewerNotes) {
    parts.push('');
    parts.push('REVIEWER NOTES:');
    parts.push(input.reviewerNotes.trim());
  }
  return parts.join('\n');
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
