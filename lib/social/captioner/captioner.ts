/**
 * Captioner stage (social-captions redesign, 2026-10-19): one finished
 * carousel → its caption, as two tagged parts (the news, then the builder's
 * read) submitted through submit_caption and joined by code.
 *
 * The call is runStructuredCall (cached tool and system, one retry with the
 * check errors). The check holds the caption to the Writer's rules for it:
 * claim tags exist in the BRIEF (checkDraft's tag rule), the read names
 * Helios, no hashtags or Source/Photos line, and the caption's C1–C4 text
 * checks (draftTextFailures, stage 'captioner'), with room left under the
 * 2,200 limit for the code-built Source and Photos lines.
 * Wiring into the pipeline is the orchestrator's (not here).
 */
import { STAGE_MODELS, type StageModelConfig } from '@/lib/social/pipeline/models';
import { draftTextFailures, LIMITS } from '@/lib/social/mechanical/checks';
import type { RecentClosing } from '@/lib/social/captions/build-line';
import { checkShape, type Brief } from '@/lib/social/reporter/brief';
import type { MessagesCreate } from '@/lib/social/reporter/reporter';
import type { DraftSubmission, FilledDraft, TaggedLine } from '@/lib/social/writer/draft';
import { runStructuredCall, type StructuredResult } from '@/lib/social/writer/structured-call';

import { CAPTIONER_SYSTEM, SUBMIT_CAPTION_TOOL, captionerUserMessage } from './prompt';

/** Room kept under the caption limit for the Source and Photos lines code adds after the caption. */
export const CAPTION_HEADROOM = 300;
export const CAPTION_MAX_WRITTEN = LIMITS.caption - CAPTION_HEADROOM;

export type CaptionParts = { news: TaggedLine; read: TaggedLine };

export type CaptionerDeps = { create: MessagesCreate; config?: StageModelConfig };

/** The caption as posted (before the Source and Photos lines): the news, a blank line, the read. */
export function joinCaption(parts: CaptionParts): string {
  return `${parts.news.text.trim()}\n\n${parts.read.text.trim()}`;
}

const HASHTAG = /(^|\s)#[\p{L}_][\p{L}\p{N}_]*/u;
const CREDIT_LINE = /^\s*(Sources?|Photos?):/im;

/** Throws an Error listing every problem; returns the two parts as submitted. */
export function checkCaptionSubmission(input: unknown, brief: Brief, filled: FilledDraft, attempt: number): CaptionParts {
  const shape = checkShape(input, SUBMIT_CAPTION_TOOL.input_schema, 'caption');
  if (shape.length > 0) throw new Error(shape.map((e) => `${e.section}: ${e.message}`).join('\n'));
  const parts = input as CaptionParts;
  const errors: string[] = [];
  const known = new Set([...brief.facts, ...brief.background, ...brief.quotes, ...brief.numbers].map((x) => x.id));
  for (const key of ['news', 'read'] as const) {
    const { text, facts } = parts[key];
    for (const id of facts) if (!known.has(id)) errors.push(`${key}.facts: claim tag ${id} isn't in the brief`);
    if (HASHTAG.test(text)) errors.push(`${key}: no hashtags`);
    if (CREDIT_LINE.test(text)) errors.push(`${key}: no Source or Photos line; code adds them`);
  }
  if (!/\bHelios\b/.test(parts.read.text)) errors.push("read: name Helios once in the builder's read");
  const joined = joinCaption(parts);
  if (joined.length > CAPTION_MAX_WRITTEN) {
    errors.push(`length: news and read are ${joined.length} characters together, limit ${CAPTION_MAX_WRITTEN.toLocaleString('en-US')} (${joined.length - CAPTION_MAX_WRITTEN} over); code adds the Source and Photos lines under the ${LIMITS.caption.toLocaleString('en-US')} cap`);
  }
  const withCaption: FilledDraft = { ...filled, caption: { text: joined, facts: [...new Set([...parts.news.facts, ...parts.read.facts])] } };
  for (const f of draftTextFailures(withCaption, brief, attempt, 'captioner')) errors.push(`${f.id} ${f.where}: ${f.detail}`);
  if (errors.length > 0) throw new Error(errors.join('\n'));
  return { news: { text: parts.news.text, facts: parts.news.facts }, read: { text: parts.read.text, facts: parts.read.facts } };
}

export async function runCaptioner(
  brief: Brief,
  draft: { submission: DraftSubmission; filled: FilledDraft },
  recent: RecentClosing[],
  includeBuildLine: boolean,
  deps: CaptionerDeps,
): Promise<StructuredResult<CaptionParts>> {
  return runStructuredCall({
    create: deps.create,
    config: deps.config ?? STAGE_MODELS.captioner,
    system: CAPTIONER_SYSTEM,
    tool: SUBMIT_CAPTION_TOOL,
    user: captionerUserMessage(draft.filled, brief, recent, includeBuildLine),
    check: (input, attempt) => checkCaptionSubmission(input, brief, draft.filled, attempt),
  });
}
