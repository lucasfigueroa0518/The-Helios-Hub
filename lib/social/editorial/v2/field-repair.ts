/**
 * Field-scoped length repair. Sends ONLY the failing field, its limit, and
 * the source excerpts the fact came from — nothing else. Model returns the
 * rewritten field alone. Sonnet by default (see REPAIR_EDITOR_MODEL) because
 * choosing which words to drop is an editorial judgment; Haiku's cheap trims
 * were shown in the copy-ab review to restore cut clauses or pick the wrong
 * sentence to drop.
 */

import type Anthropic from '@anthropic-ai/sdk';

import { anthropic } from '@/lib/anthropic';
import { cacheUsageFromMessage } from '@/lib/anthropic-cache';
import { REPAIR_EDITOR_MODEL, costUsdForModel } from '@/lib/social/editorial/config';

import type { StageUsage } from './log';

export type FieldRepairInput = {
  /** Human-readable label the model sees, e.g. "SLIDE 3 QUOTE" or "COVER TEXT". */
  fieldLabel: string;
  /** Current text of the field. */
  currentText: string;
  /** Hard character limit for this field. */
  limit: number;
  /**
   * The source excerpts this field's fact came from. Ideally 1–3 short
   * paragraphs the model can point to when deciding which words to drop.
   * Pass an empty string if no obvious excerpt is available; the model
   * will just tighten wording.
   */
  sourceExcerpt: string;
  /**
   * Optional adjacent context — the slide's other fields (HEADLINE, BODY,
   * etc.) so the model doesn't restate them. Pass a short single-line
   * summary; the model uses it as "don't repeat this."
   */
  adjacentSummary?: string;
};

export type FieldRepairOutput = {
  /** Rewritten field text, guaranteed by prompt to be ≤ limit. */
  newText: string;
  /** True if the model still exceeded the limit; the caller can retry or bail. */
  stillOver: boolean;
  raw: string;
  usage: StageUsage;
};

const FIELD_REPAIR_SYSTEM = `You edit one field of a social carousel slide to fit its character limit while keeping the fact accurate. You return ONLY the rewritten field text — no labels, no quotation marks, no explanation, no scratchpad. If the field is a quote, it must remain a verbatim (or ellipsis-truncated) source quote; if you can't fit the quote within the limit, cut it back to a shorter verbatim span or replace the field with the shortest complete source sentence that captures the same point.

Rules:
- Cut words, not facts. Remove filler, glosses already made elsewhere, and restated context first.
- Keep every hedge the sources use ("may", "might", "potential", "up to", "roughly").
- Keep attribution intact ("Newsom said", "the SF Standard reports"). Don't turn an attributed argument into a bare fact.
- Truncated quotes use "..." (three dots), never a period.
- No em dashes, en dashes, exclamation marks, emoji.
- Return the new field text on one line if possible. No wrapping, no code fences, no leading label.`;

export async function runFieldRepair(input: FieldRepairInput): Promise<FieldRepairOutput> {
  const userLines: string[] = [];
  userLines.push(`FIELD: ${input.fieldLabel}`);
  userLines.push(`LIMIT: ${input.limit} characters`);
  userLines.push(`CURRENT (${input.currentText.length} chars): ${input.currentText}`);
  if (input.adjacentSummary) {
    userLines.push('');
    userLines.push(`ADJACENT (already on this slide — do NOT restate): ${input.adjacentSummary}`);
  }
  if (input.sourceExcerpt) {
    userLines.push('');
    userLines.push('SOURCE EXCERPT(S):');
    userLines.push(input.sourceExcerpt);
  }
  userLines.push('');
  userLines.push('Rewrite ONLY the field so it fits within the limit. Return the rewritten text only, no labels.');

  const response = await anthropic.messages.create({
    model: REPAIR_EDITOR_MODEL,
    max_tokens: 400,
    system: FIELD_REPAIR_SYSTEM,
    messages: [{ role: 'user', content: userLines.join('\n') }],
  });
  const raw = extractText(response);
  const newText = cleanFieldOutput(raw);
  return {
    newText,
    stillOver: newText.length > input.limit,
    raw,
    usage: usageFromResponse(response),
  };
}

function extractText(response: Anthropic.Message): string {
  const block = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  if (!block) throw new Error('field-repair: model returned no text block');
  return block.text;
}

/**
 * Strip common ways the model wraps its answer: fenced code, quote marks,
 * leading label "SLIDE X QUOTE:" that we told it not to add, trailing
 * commentary after a blank line.
 */
function cleanFieldOutput(raw: string): string {
  let s = raw.trim();
  // Strip triple-fenced code blocks.
  const fenced = s.match(/^```(?:\w+\s*)?\n?([\s\S]*?)\n?```$/);
  if (fenced) s = fenced[1]!.trim();
  // If the model added a label line ("HEADLINE:" or "SLIDE 3 QUOTE:") strip it.
  s = s.replace(/^(?:SLIDE\s+\d+\s+)?(?:HEADLINE|BODY|NOTE|BIG NUMBER|NUMBER NOTE|SECOND NUMBER|SECOND NOTE|QUOTE|QUOTE BY|HIGHLIGHT|IMAGE|COVER(?: TEXT| HIGHLIGHT| IMAGE)?|FOLLOW):\s*/i, '');
  // If the model appended commentary after a blank line, keep only the first paragraph.
  const paragraphs = s.split(/\n{2,}/);
  if (paragraphs.length > 1) s = paragraphs[0]!.trim();
  // Strip enclosing double-quotes when the whole thing is quoted (except for
  // the QUOTE field, whose double-quotes are legitimate).
  return s;
}

function usageFromResponse(response: Anthropic.Message): StageUsage {
  const cache = cacheUsageFromMessage(response);
  const output = Math.max(0, Number(response.usage.output_tokens ?? 0));
  return {
    inputTokens: cache.inputTokens,
    cacheReadTokens: cache.cacheReadTokens,
    cacheWriteTokens: cache.cacheWriteTokens,
    outputTokens: output,
    approxCostUsd: costUsdForModel(REPAIR_EDITOR_MODEL, {
      inputTokens: cache.inputTokens,
      outputTokens: output,
      cacheReadTokens: cache.cacheReadTokens,
      cacheWriteTokens: cache.cacheWriteTokens,
    }),
  };
}

/* ── Helpers shared with orchestrate.ts ─────────────────────────────── */

/** Recover the FIELD label (HEADLINE, BODY, QUOTE, …) from a char_limit
 * CHECK ERROR message when the CheckError.field is missing or ambiguous. */
export function inferFieldFromMessage(msg: string): string {
  const m = msg.match(/\b(HEADLINE|BODY|NOTE|BIG NUMBER|NUMBER NOTE|SECOND NUMBER|SECOND NOTE|QUOTE|QUOTE BY|COVER|FOLLOW|TEXT|HIGHLIGHT|IMAGE)\b/);
  return m ? m[1]!.toUpperCase() : 'BODY';
}

/** Pull the hard limit out of a char_limit CHECK ERROR message
 *  ("… limit 220 …"). Defaults to 220 (body) when not found. */
export function extractLimitFromMessage(msg: string): number {
  const m = msg.match(/limit\s+(\d+)/i);
  return m ? Number(m[1]) : 220;
}

/** Map a human FIELD label to the ParsedSlide property key. */
export function fieldToKey(field: string): string {
  const map: Record<string, string> = {
    HEADLINE: 'headline',
    BODY: 'body',
    NOTE: 'note',
    'BIG NUMBER': 'bigNumber',
    'NUMBER NOTE': 'numberNote',
    'SECOND NUMBER': 'secondNumber',
    'SECOND NOTE': 'secondNote',
    QUOTE: 'quote',
    'QUOTE BY': 'quoteBy',
    HIGHLIGHT: 'highlight',
    IMAGE: 'image',
    'COVER TEXT': 'text',
    'COVER HIGHLIGHT': 'highlight',
    'COVER IMAGE': 'image',
    COVER: 'text',
    FOLLOW: 'follow',
    TEXT: 'text',
  };
  return map[field.toUpperCase()] ?? field.toLowerCase();
}

/** Read the current text of the failing field from the ParsedPost. */
export function extractFieldText(
  post: { cover?: { text?: string }; follow?: string; slides: Array<{ position: number; headline?: string; body?: string; note?: string; quote?: string; quoteBy?: string; bigNumber?: string; numberNote?: string; secondNumber?: string; secondNote?: string; highlight?: string; image?: string }> },
  target: string,
  slidePosition: number | undefined,
  field: string,
): string {
  if (target === 'cover') return post.cover?.text ?? '';
  if (target === 'follow') return post.follow ?? '';
  const s = post.slides.find((x) => x.position === slidePosition);
  if (!s) return '';
  const key = fieldToKey(field);
  return (s as unknown as Record<string, string>)[key] ?? '';
}

/** Write the repaired text back into the ParsedPost. */
export function applyFieldTo(
  post: { cover?: { text?: string }; follow?: string; slides: Array<{ position: number }> },
  target: string,
  slidePosition: number | undefined,
  field: string,
  newText: string,
) {
  if (target === 'cover') {
    if (!post.cover) return;
    (post.cover as { text?: string }).text = newText;
    return;
  }
  if (target === 'follow') {
    (post as { follow?: string }).follow = newText;
    return;
  }
  const s = post.slides.find((x) => x.position === slidePosition);
  if (!s) return;
  (s as unknown as Record<string, string>)[fieldToKey(field)] = newText;
}

/** Summarise the OTHER fields on the same slide so the field-scoped repair
 * knows what not to restate. Kept short (≤ ~300 chars); truncates long
 * bodies to the first 120 chars. */
export function summarizeAdjacent(
  post: { slides: Array<{ position: number; headline?: string; body?: string; note?: string; quote?: string; bigNumber?: string; numberNote?: string }> },
  slidePosition: number,
  thisField: string,
): string {
  const s = post.slides.find((x) => x.position === slidePosition);
  if (!s) return '';
  const F = thisField.toUpperCase();
  const bits: string[] = [];
  if (F !== 'HEADLINE' && s.headline) bits.push(`HEADLINE: ${s.headline}`);
  if (F !== 'BODY' && s.body) bits.push(`BODY (${s.body.length} chars): ${s.body.slice(0, 120)}`);
  if (F !== 'NOTE' && s.note) bits.push(`NOTE: ${s.note}`);
  if (F !== 'QUOTE' && s.quote) bits.push(`QUOTE: ${s.quote.slice(0, 120)}`);
  if (F !== 'BIG NUMBER' && s.bigNumber) bits.push(`BIG NUMBER: ${s.bigNumber}`);
  if (F !== 'NUMBER NOTE' && s.numberNote) bits.push(`NUMBER NOTE: ${s.numberNote}`);
  return bits.join(' | ');
}

/**
 * Pick the source paragraph whose word set overlaps most with the failing
 * field text. Returned excerpt is capped at maxChars so the field-repair
 * prompt stays small.
 */
export function pickSourceExcerpt(
  currentText: string,
  sourceTexts: Array<{ url?: string; text: string }>,
  maxChars: number,
): string {
  if (sourceTexts.length === 0) return '';
  const currentTokens = new Set(
    currentText.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4),
  );
  if (currentTokens.size === 0) return (sourceTexts[0]!.text ?? '').slice(0, maxChars);
  let best = { score: -1, excerpt: '' };
  for (const src of sourceTexts) {
    for (const p of (src.text ?? '').split(/\n{2,}/)) {
      const tokens = p.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
      let score = 0;
      for (const t of tokens) if (currentTokens.has(t)) score += 1;
      if (score > best.score) best = { score, excerpt: p.trim() };
    }
  }
  return best.excerpt.slice(0, maxChars);
}
