/**
 * Editor stage — the second look on the writer's DRAFT (or its own last
 * version). Fixes CHECK ERRORS or FACT-CHECK FLAGS when sent back. Produces
 * EDITED POST + EDIT NOTES.
 */

import { anthropic } from '@/lib/anthropic';
import { cachedSystemText } from '@/lib/anthropic-cache';
import { EDITORIAL_MODEL } from '@/lib/social/editorial/config';

import type { CheckError } from './code-checks';
import { EDITOR_PROMPT } from './prompts/editor';
import { type Brief, type FactCheckFlag, parseEditedPost, type ParsedPost } from './parse';
import type { FetchedSource } from './writer';
import { extractText, formatFactCheckFlags, usageFromResponse } from './writer';
import type { StageUsage } from './log';

export type EditorInput = {
  brief: Brief;
  briefRaw: string;
  sourceTexts: FetchedSource[];
  /** Draft on first pass, own last EDITED POST on rerun. */
  post: string;
  checkErrors?: CheckError[];
  factCheckFlags?: FactCheckFlag[];
};

export type EditorOutput = {
  post: ParsedPost;
  raw: string;
  editNotes: string[] | null;
  usage: StageUsage;
};

export async function runEditor(input: EditorInput): Promise<EditorOutput> {
  const userText = buildEditorUserMessage(input);
  const response = await anthropic.messages.create({
    model: EDITORIAL_MODEL,
    max_tokens: 3500,
    system: cachedSystemText(EDITOR_PROMPT, '1h'),
    messages: [{ role: 'user', content: userText }],
  });
  const raw = extractText(response);
  const parsed = parseEditedPost(raw);
  return { post: parsed, raw, editNotes: parsed.editNotes, usage: usageFromResponse(response) };
}

export function buildEditorUserMessage(input: EditorInput): string {
  const parts: string[] = [];
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
