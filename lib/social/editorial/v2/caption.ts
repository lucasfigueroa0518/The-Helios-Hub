/**
 * Caption stage — writes the Instagram caption from the final EDITED POST +
 * BRIEF. On rerun receives PREVIOUS CAPTION + FIX NOTES.
 */

import type Anthropic from '@anthropic-ai/sdk';

import { anthropic } from '@/lib/anthropic';
import { cachedSystemText, cacheUsageFromMessage } from '@/lib/anthropic-cache';
import { CAPTION_MODEL, costUsdForModel } from '@/lib/social/editorial/config';

import type { CheckError } from './code-checks';
import { CAPTION_PROMPT } from './prompts/caption';
import { type Brief, type FactCheckFlag, parseCaption } from './parse';
import { extractText, formatFactCheckFlags } from './writer';
import { formatCheckErrors } from './editor';
import type { StageUsage } from './log';

export type CaptionInput = {
  brief: Brief;
  briefRaw: string;
  slides: string;
  previousCaption?: string;
  checkErrors?: CheckError[];
  factCheckFlags?: FactCheckFlag[];
};

export type CaptionOutput = {
  caption: string;
  raw: string;
  stopReasons: string[];
  usage: StageUsage;
};

export async function runCaption(input: CaptionInput): Promise<CaptionOutput> {
  const model = CAPTION_MODEL;
  const messages = buildCaptionMessages(input);
  const response = await anthropic.messages.create({
    model,
    max_tokens: 1500,
    system: cachedSystemText(CAPTION_PROMPT, '1h'),
    messages,
  });
  const raw = extractText(response);
  const caption = parseCaption(raw);
  return {
    caption,
    raw,
    stopReasons: [String(response.stop_reason ?? 'unknown')],
    usage: captionUsage(response, model),
  };
}

function captionUsage(response: Anthropic.Message, model: string): StageUsage {
  const cache = cacheUsageFromMessage(response);
  const output = Math.max(0, Number(response.usage.output_tokens ?? 0));
  return {
    inputTokens: cache.inputTokens,
    cacheReadTokens: cache.cacheReadTokens,
    cacheWriteTokens: cache.cacheWriteTokens,
    outputTokens: output,
    approxCostUsd: costUsdForModel(model, {
      inputTokens: cache.inputTokens,
      outputTokens: output,
      cacheReadTokens: cache.cacheReadTokens,
      cacheWriteTokens: cache.cacheWriteTokens,
    }),
  };
}

/**
 * Cost-cut #1: split the user message into a stable prefix (SLIDES + BRIEF)
 * and a variable suffix (PREVIOUS CAPTION + FIX NOTES). cache_control on the
 * prefix means the fact-check / check-error rerun on the same run shares
 * the prefix at the cache-read rate (Haiku: $0.10/Mtok vs $1/Mtok).
 *
 * SLIDES is placed first because it changes rarely across reruns within one
 * pipeline run (only when the Editor's own EDITED POST changes, at which
 * point the cache miss is expected).
 */
export function buildCaptionMessages(input: CaptionInput): Anthropic.MessageParam[] {
  const prefixText = [
    'SLIDES:',
    input.slides.trim(),
    '',
    'BRIEF:',
    input.briefRaw.trim(),
  ].join('\n');

  const suffixParts: string[] = [];
  if (input.previousCaption) {
    suffixParts.push('PREVIOUS CAPTION:');
    suffixParts.push(input.previousCaption.trim());
  }
  const notes: string[] = [];
  if (input.checkErrors && input.checkErrors.length > 0) {
    notes.push(formatCheckErrors(input.checkErrors));
  }
  if (input.factCheckFlags && input.factCheckFlags.length > 0) {
    notes.push(formatFactCheckFlags(input.factCheckFlags));
  }
  if (notes.length > 0) {
    if (suffixParts.length > 0) suffixParts.push('');
    suffixParts.push('FIX NOTES:');
    suffixParts.push(notes.join('\n'));
  }

  const content: Anthropic.TextBlockParam[] = [
    { type: 'text', text: prefixText, cache_control: { type: 'ephemeral', ttl: '1h' } },
  ];
  if (suffixParts.length > 0) {
    content.push({ type: 'text', text: suffixParts.join('\n') });
  }
  return [{ role: 'user', content }];
}

/** Legacy string form kept for tests that inspect the prompt text directly. */
export function buildCaptionUserMessage(input: CaptionInput): string {
  const messages = buildCaptionMessages(input);
  const content = messages[0]!.content;
  if (typeof content === 'string') return content;
  return content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
}
