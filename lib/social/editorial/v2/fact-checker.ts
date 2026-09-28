/**
 * Fact-checker stage — flags anything the sources don't support. Never
 * rewrites. Reads SOURCES + BRIEF + POST (slides + caption), returns
 * VERDICT + FLAGS.
 */

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
};

export type FactCheckerOutput = {
  result: FactCheckResult;
  raw: string;
  stopReasons: string[];
  usage: StageUsage;
};

export async function runFactChecker(input: FactCheckerInput): Promise<FactCheckerOutput> {
  const userText = buildFactCheckerUserMessage(input);
  const response = await anthropic.messages.create({
    model: EDITORIAL_MODEL,
    max_tokens: 3000,
    system: cachedSystemText(FACT_CHECKER_PROMPT, '1h'),
    messages: [{ role: 'user', content: userText }],
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

export function buildFactCheckerUserMessage(input: FactCheckerInput): string {
  const parts: string[] = [];
  parts.push('SOURCES:');
  for (const src of input.sourceTexts) {
    parts.push(`[URL] ${src.url}`);
    if (src.title) parts.push(`[TITLE] ${src.title}`);
    parts.push(src.text);
    parts.push('---');
  }
  parts.push('');
  parts.push('BRIEF:');
  parts.push(input.briefRaw.trim());
  parts.push('');
  parts.push('POST:');
  parts.push(input.post.trim());
  parts.push('');
  parts.push('CAPTION:');
  parts.push(input.caption.trim());
  return parts.join('\n');
}
