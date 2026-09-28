/**
 * Caption stage — writes the Instagram caption from the final EDITED POST +
 * BRIEF. On rerun receives PREVIOUS CAPTION + FIX NOTES.
 */

import { anthropic } from '@/lib/anthropic';
import { cachedSystemText } from '@/lib/anthropic-cache';
import { EDITORIAL_MODEL } from '@/lib/social/editorial/config';

import type { CheckError } from './code-checks';
import { CAPTION_PROMPT } from './prompts/caption';
import { type Brief, type FactCheckFlag, parseCaption } from './parse';
import { extractText, formatFactCheckFlags, usageFromResponse } from './writer';
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
  const userText = buildCaptionUserMessage(input);
  const response = await anthropic.messages.create({
    model: EDITORIAL_MODEL,
    max_tokens: 1500,
    system: cachedSystemText(CAPTION_PROMPT, '1h'),
    messages: [{ role: 'user', content: userText }],
  });
  const raw = extractText(response);
  const caption = parseCaption(raw);
  return {
    caption,
    raw,
    stopReasons: [String(response.stop_reason ?? 'unknown')],
    usage: usageFromResponse(response),
  };
}

export function buildCaptionUserMessage(input: CaptionInput): string {
  const parts: string[] = [];
  parts.push('SLIDES:');
  parts.push(input.slides.trim());
  parts.push('');
  parts.push('BRIEF:');
  parts.push(input.briefRaw.trim());
  if (input.previousCaption) {
    parts.push('');
    parts.push('PREVIOUS CAPTION:');
    parts.push(input.previousCaption.trim());
  }
  const notes: string[] = [];
  if (input.checkErrors && input.checkErrors.length > 0) {
    notes.push(formatCheckErrors(input.checkErrors));
  }
  if (input.factCheckFlags && input.factCheckFlags.length > 0) {
    notes.push(formatFactCheckFlags(input.factCheckFlags));
  }
  if (notes.length > 0) {
    parts.push('');
    parts.push('FIX NOTES:');
    parts.push(notes.join('\n'));
  }
  return parts.join('\n');
}
