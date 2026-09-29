/**
 * Editor stage — the second look on the writer's DRAFT (or its own last
 * version). Fixes CHECK ERRORS or FACT-CHECK FLAGS when sent back. Produces
 * EDITED POST + EDIT NOTES.
 */

import type Anthropic from '@anthropic-ai/sdk';

import { anthropic } from '@/lib/anthropic';
import { cachedSystemText, cacheUsageFromMessage } from '@/lib/anthropic-cache';
import {
  EDITORIAL_MODEL,
  REPAIR_EDITOR_MODEL,
  costUsdForModel,
} from '@/lib/social/editorial/config';

import type { CheckError } from './code-checks';
import { EDITOR_PROMPT } from './prompts/editor';
import { type Brief, type FactCheckFlag, parseEditedPost, type ParsedPost } from './parse';
import type { FetchedSource } from './writer';
import { extractText, formatFactCheckFlags } from './writer';
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
  /**
   * Cost-cut #3: mechanical length trims (char_limit / highlight_substring)
   * run on Haiku (`REPAIR_EDITOR_MODEL`). Full-editorial calls (first pass,
   * post-writer fact-check reruns, small-flag reruns) stay on Sonnet
   * (`EDITORIAL_MODEL`) because they need judgment about the sources.
   * Orchestrator sets this to `'repair'` only when CHECK ERRORS drive the
   * call and no factCheckFlags are attached.
   */
  mode?: 'primary' | 'repair';
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

/**
 * Anti-scratchpad guardrail. Prepended to the user message right before
 * the model's turn so the "start with COVER:" instruction sits as the
 * final byte the model reads. Sonnet 4.6 does NOT support assistant-role
 * prefill (`400 invalid_request_error` — the Anthropic API rejects a
 * conversation that doesn't end in a user message), so a prompt-level
 * instruction is our only lever against the 45KB scratchpad blow-up seen
 * on the 2026-09-29 Google CC re-run.
 */
const EDITOR_START_INSTRUCTION = '\n\nOUTPUT REQUIREMENT: Your response MUST begin with "COVER:" on the very first line. Write the finished EDITED POST directly. Do NOT write any preamble, analysis, reasoning, or scratchpad before COVER:. Put reasoning inside EDIT NOTES at the end.';

export async function runEditor(input: EditorInput): Promise<EditorOutput> {
  const model = input.mode === 'repair' ? REPAIR_EDITOR_MODEL : EDITORIAL_MODEL;
  const messages = buildEditorMessages(input);

  // First attempt at the standard budget.
  const first = await anthropic.messages.create({
    model,
    max_tokens: EDITOR_MAX_TOKENS,
    system: cachedSystemText(EDITOR_PROMPT, '1h'),
    messages,
  });
  const stopReasons: string[] = [String(first.stop_reason ?? 'unknown')];
  let response: Anthropic.Message = first;

  // Max-tokens retry: the Editor hitting the cap on a large edit is a real
  // failure mode (Run 3 saw the Editor truncate mid-post). Retry once with
  // a bigger budget — same prompt, same messages, so the model continues
  // its own train of thought at higher headroom.
  if (first.stop_reason === 'max_tokens') {
    const retry = await anthropic.messages.create({
      model,
      max_tokens: EDITOR_MAX_TOKENS_RETRY,
      system: cachedSystemText(EDITOR_PROMPT, '1h'),
      messages,
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
    usage: sumUsage(first, response === first ? null : response, model),
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

/**
 * Cost-cut #1: two-block user message so reruns within the same pipeline
 * run share the [BRIEF + SOURCES] prefix at the cache-read rate. POST +
 * LENGTHS + CHECK ERRORS + FACT-CHECK FLAGS all vary per rerun and go
 * after the breakpoint.
 */
export function buildEditorMessages(input: EditorInput): Anthropic.MessageParam[] {
  const prefixParts: string[] = ['BRIEF:', input.briefRaw.trim(), '', 'SOURCES:'];
  for (const src of input.sourceTexts) {
    prefixParts.push(`[URL] ${src.url}`);
    if (src.title) prefixParts.push(`[TITLE] ${src.title}`);
    prefixParts.push(src.text);
    prefixParts.push('---');
  }

  const suffixParts: string[] = [];
  if (input.lengthsBlock) {
    suffixParts.push(input.lengthsBlock);
    suffixParts.push('');
  }
  suffixParts.push('POST:');
  suffixParts.push(input.post.trim());
  if (input.checkErrors && input.checkErrors.length > 0) {
    suffixParts.push('');
    suffixParts.push('CHECK ERRORS:');
    suffixParts.push(formatCheckErrors(input.checkErrors));
  }
  if (input.factCheckFlags && input.factCheckFlags.length > 0) {
    suffixParts.push('');
    suffixParts.push('FACT-CHECK FLAGS:');
    suffixParts.push(formatFactCheckFlags(input.factCheckFlags));
  }

  // Append the anti-scratchpad instruction as the final bytes so the
  // "start with COVER:" rule is the last thing the model sees before
  // generating.
  suffixParts.push(EDITOR_START_INSTRUCTION);

  return [{
    role: 'user',
    content: [
      { type: 'text', text: prefixParts.join('\n'), cache_control: { type: 'ephemeral', ttl: '1h' } },
      { type: 'text', text: suffixParts.join('\n') },
    ],
  }];
}

/** Legacy string form kept for tests that inspect the assembled prompt. */
export function buildEditorUserMessage(input: EditorInput): string {
  const [{ content }] = buildEditorMessages(input);
  if (typeof content === 'string') return content;
  return content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
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
function sumUsage(first: Anthropic.Message, retry: Anthropic.Message | null, model: string): StageUsage {
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
    approxCostUsd: costUsdForModel(model, {
      inputTokens: totals.input,
      outputTokens: totals.output,
      cacheReadTokens: totals.cacheRead,
      cacheWriteTokens: totals.cacheWrite,
    }),
  };
}
