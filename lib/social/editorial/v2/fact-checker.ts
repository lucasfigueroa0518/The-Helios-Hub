/**
 * Fact-checker stage — flags anything the sources don't support. Never
 * rewrites. Reads SOURCES + BRIEF + POST (slides + caption), returns
 * VERDICT + FLAGS.
 */

import type Anthropic from '@anthropic-ai/sdk';

import { anthropic } from '@/lib/anthropic';
import { cachedSystemText } from '@/lib/anthropic-cache';
import { EDITORIAL_MODEL } from '@/lib/social/editorial/config';

import { FACT_CHECKER_PROMPT } from './prompts/fact-checker';
import { type Brief, type FactCheckResult, parseFactCheck } from './parse';
import type { FetchedSource } from './writer';
import { extractText, usageFromResponse } from './writer';
import type { StageUsage } from './log';

export type FactCheckerInput = {
  brief: Brief;
  briefRaw: string;
  sourceTexts: FetchedSource[];
  post: string;
  caption: string;
  /**
   * Optional "IMAGES CHOSEN:" block from the image step, listing the
   * subject / Wikidata id / Commons file / license the pipeline picked
   * for each slide. Lets the fact-checker flag a photo that doesn't fit
   * its slide. See docs/IMAGES-V1-HANDOFF.md §Fact-checker.
   */
  imagesBlock?: string;
};

export type FactCheckerOutput = {
  result: FactCheckResult;
  raw: string;
  stopReasons: string[];
  usage: StageUsage;
};

export async function runFactChecker(input: FactCheckerInput): Promise<FactCheckerOutput> {
  const messages = buildFactCheckerMessages(input);
  const response = await anthropic.messages.create({
    model: EDITORIAL_MODEL,
    max_tokens: 3000,
    system: cachedSystemText(FACT_CHECKER_PROMPT, '1h'),
    messages,
  });
  const raw = extractText(response);
  const result = parseFactCheck(raw);
  return {
    result,
    raw,
    stopReasons: [String(response.stop_reason ?? 'unknown')],
    usage: usageFromResponse(response),
  };
}

/**
 * Cost-cut #1: cache [SOURCES + BRIEF] prefix. Multiple fact-check rounds
 * on the same run share the prefix; POST + CAPTION + IMAGES CHOSEN vary.
 */
export function buildFactCheckerMessages(input: FactCheckerInput): Anthropic.MessageParam[] {
  const prefixParts: string[] = ['SOURCES:'];
  for (const src of input.sourceTexts) {
    prefixParts.push(`[URL] ${src.url}`);
    if (src.title) prefixParts.push(`[TITLE] ${src.title}`);
    prefixParts.push(src.text);
    prefixParts.push('---');
  }
  prefixParts.push('');
  prefixParts.push('BRIEF:');
  prefixParts.push(input.briefRaw.trim());

  const suffixParts: string[] = ['POST:', input.post.trim()];
  if (input.imagesBlock) {
    suffixParts.push('');
    suffixParts.push(input.imagesBlock.trim());
  }
  suffixParts.push('');
  suffixParts.push('CAPTION:');
  suffixParts.push(input.caption.trim());

  return [{
    role: 'user',
    content: [
      { type: 'text', text: prefixParts.join('\n'), cache_control: { type: 'ephemeral', ttl: '1h' } },
      { type: 'text', text: suffixParts.join('\n') },
    ],
  }];
}

/** Legacy string form kept for tests that inspect the assembled prompt. */
export function buildFactCheckerUserMessage(input: FactCheckerInput): string {
  const [{ content }] = buildFactCheckerMessages(input);
  if (typeof content === 'string') return content;
  return content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
}
