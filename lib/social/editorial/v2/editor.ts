/**
 * Editor stage — the second look on the writer's DRAFT (or its own last
 * version). Fixes CHECK ERRORS or FACT-CHECK FLAGS when sent back. Produces
 * EDITED POST + EDIT NOTES.
 */

import type Anthropic from '@anthropic-ai/sdk';

import { anthropic } from '@/lib/anthropic';
import { cachedSystemText } from '@/lib/anthropic-cache';
import { EDITORIAL_MODEL, sonnetCostUsd } from '@/lib/social/editorial/config';

import type { CheckError } from './code-checks';
import { EDITOR_PROMPT } from './prompts/editor';
import { type Brief, type FactCheckFlag, parseEditedPost, type ParsedPost } from './parse';
import type { FetchedSource } from './writer';
import { extractText, formatFactCheckFlags } from './writer';
import { cacheUsageFromMessage } from '@/lib/anthropic-cache';
import type { StageUsage } from './log';

export type EditorInput = {
  brief: Brief;
  briefRaw: string;
  sourceTexts: FetchedSource[];
  /** Draft on first pass, own last EDITED POST on rerun. */
  post: string;
  /**
   * Optional length-summary block ("LENGTHS:") to prepend, listing every
   * field's current character count against its limit. Orchestrator builds
   * this from the parsed post + caption + credits estimate so the Editor
   * sees the exact numbers before deciding what to cut.
   */
  lengthsBlock?: string;
  checkErrors?: CheckError[];
  factCheckFlags?: FactCheckFlag[];
};

export type EditorOutput = {
  post: ParsedPost;
  raw: string;
  editNotes: string[] | null;
  /**
   * stop_reason of every messages.create call the stage made (usually one
   * element; two when the first call hit max_tokens and we retried with a
   * higher budget).
   */
  stopReasons: string[];
  usage: StageUsage;
};

/** Base output budget for the Editor. Raised from 3500 on Run 3's advice. */
const EDITOR_MAX_TOKENS = 8000;
/** Fallback budget if the first attempt returns stop_reason='max_tokens'. */
const EDITOR_MAX_TOKENS_RETRY = 12000;

export async function runEditor(input: EditorInput): Promise<EditorOutput> {
  const userText = buildEditorUserMessage(input);

  // First attempt at the standard budget.
  const first = await anthropic.messages.create({
    model: EDITORIAL_MODEL,
    max_tokens: EDITOR_MAX_TOKENS,
    system: cachedSystemText(EDITOR_PROMPT, '1h'),
    messages: [{ role: 'user', content: userText }],
  });
  const stopReasons: string[] = [String(first.stop_reason ?? 'unknown')];
  let response: Anthropic.Message = first;

  // Max-tokens retry: the Editor hitting the cap on a large edit is a real
  // failure mode (Run 3 saw the Editor truncate mid-post). Retry once with
  // a bigger budget — same prompt, same messages, so the model continues
  // its own train of thought at higher headroom.
  if (first.stop_reason === 'max_tokens') {
    const retry = await anthropic.messages.create({
      model: EDITORIAL_MODEL,
      max_tokens: EDITOR_MAX_TOKENS_RETRY,
      system: cachedSystemText(EDITOR_PROMPT, '1h'),
      messages: [{ role: 'user', content: userText }],
    });
    stopReasons.push(String(retry.stop_reason ?? 'unknown'));
    response = retry;
  }

  const rawFull = extractText(response);
  const raw = trimToLastCoverLabel(rawFull);
  const parsed = parseEditedPost(raw);
  return {
    post: parsed,
    raw,
    editNotes: parsed.editNotes,
    stopReasons,
    usage: sumUsage(first, response === first ? null : response),
  };
}

/**
 * Trim the Editor's raw output to start at the LAST "COVER:" line so any
 * preamble the model wrote before the actual EDITED POST ("Here's the
 * revised post:") gets dropped. Same shape as the Reporter's
 * sanitizeSingleStoryLine / joinBriefFromTurns trim — labeled-lines format
 * has one canonical start; anything before it is chatter.
 *
 * Exported for direct testing.
 */
export function trimToLastCoverLabel(rawEditedPost: string): string {
  // The last-occurring "COVER:" at line start (allowing "**COVER:**"
  // markdown, which normalizeMarkdown strips before parsing).
  const re = /(?:^|\n)(?:\*\*)?COVER:/g;
  let lastIdx = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawEditedPost)) !== null) {
    // Position of the "COVER" token itself, skipping any leading "\n" or "**".
    lastIdx = m.index + m[0].indexOf('COVER');
  }
  if (lastIdx < 0) return rawEditedPost;
  return rawEditedPost.slice(lastIdx);
}

export function buildEditorUserMessage(input: EditorInput): string {
  const parts: string[] = [];
  if (input.lengthsBlock) {
    parts.push(input.lengthsBlock);
    parts.push('');
  }
  parts.push('POST:');
  parts.push(input.post.trim());
  parts.push('');
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
  if (input.checkErrors && input.checkErrors.length > 0) {
    parts.push('');
    parts.push('CHECK ERRORS:');
    parts.push(formatCheckErrors(input.checkErrors));
  }
  if (input.factCheckFlags && input.factCheckFlags.length > 0) {
    parts.push('');
    parts.push('FACT-CHECK FLAGS:');
    parts.push(formatFactCheckFlags(input.factCheckFlags));
  }
  return parts.join('\n');
}

export function formatCheckErrors(errors: CheckError[]): string {
  // Messages are already fully formed in code-checks.ts (location + rule +
  // corrective action). Just bullet them. Editor sees exactly what to fix.
  return errors.map((e) => `- ${e.message}`).join('\n');
}

/**
 * Sum usage across the first call and (if present) the max-tokens retry so
 * the cost reflects both attempts, not just the successful one.
 */
function sumUsage(first: Anthropic.Message, retry: Anthropic.Message | null): StageUsage {
  const totals = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  for (const r of [first, ...(retry ? [retry] : [])]) {
    const c = cacheUsageFromMessage(r);
    totals.input += c.inputTokens;
    totals.cacheRead += c.cacheReadTokens;
    totals.cacheWrite += c.cacheWriteTokens;
    totals.output += Math.max(0, Number(r.usage.output_tokens ?? 0));
  }
  return {
    inputTokens: totals.input,
    cacheReadTokens: totals.cacheRead,
    cacheWriteTokens: totals.cacheWrite,
    outputTokens: totals.output,
    approxCostUsd: sonnetCostUsd({
      inputTokens: totals.input,
      outputTokens: totals.output,
      cacheReadTokens: totals.cacheRead,
      cacheWriteTokens: totals.cacheWrite,
    }),
  };
}
