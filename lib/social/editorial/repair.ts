import type Anthropic from '@anthropic-ai/sdk';

import { anthropic } from '@/lib/anthropic';
import { cachedSystemText, cacheUsageFromMessage } from '@/lib/anthropic-cache';
import { HUMANIZER_MODEL } from '@/lib/social/editorial/config';
import type { EditorialPost, BeatCopy } from '@/lib/social/editorial/copy';
import type { FactSheet } from '@/lib/social/editorial/fact-sheet';
import type { QaResult } from '@/lib/social/editorial/qa';
import type { SpanRun } from '@/lib/social/render/types';

/**
 * Layer 2 — targeted repair pass.
 *
 * Runs after QA if issues are flagged. Rather than regenerating the entire
 * post ($0.10+), we hand Haiku ONLY the affected slides plus the QA issues
 * and ask it to rewrite just those fields. Small context, cheap model,
 * scoped surgery.
 *
 * Cost per repair: ~$0.02. Only runs when QA reports 1-3 fixable issues
 * (not on the truly stuck cases). Above 3 issues, we skip repair — the
 * post has structural problems that a repair pass won't solve.
 */

const REPAIR_SYSTEM_PROMPT = `You are the REPAIR pass for a Helios Social carousel.

The copy stage already wrote the post. Polish already ran. QA then flagged
specific issues in specific slides. Your ONLY job is to rewrite the flagged
slides to fix those specific issues, preserving everything else.

## Rules

1. You are given the ORIGINAL slides (positions + current copy) and the
   QA ISSUES list. Each issue references a slide position and a field.
2. Rewrite ONLY the fields called out. Do not touch fields not flagged.
3. Preserve every factual claim, number, name, date, quote exactly.
4. Preserve span roles when the text underneath doesn't change materially.
5. Common fixes:
   - "banned_inflation" — remove the flagged word, replace with plain
     equivalent or rewrite the sentence.
   - "not_x_but_y" — rewrite as a direct positive claim without the
     negation setup.
   - "deep_sounding_filler" — strip the hedge phrase; the sentence usually
     stands cleaner without it.
   - "triad_count" — rewrite as one dense sentence naming the pattern, OR
     as three short sentences with periods.
   - "staged_runup" — cut the "Here's what/how/why" framing; state the
     news directly.
6. If a body has 2+ hook spans, demote extras to narrative (max 1 orange
   per span run).
7. Output the FIXED slides only, as a JSON object. Do NOT return unchanged
   slides. Do NOT add prose. Do NOT emit code fences.

## Output shape

{
  "fixed_slides": [
    {
      "position": integer,
      "headline": [{ "text": "...", "role": "narrative" | "hook" | "pivot" }, ...] | null,
      "body": [ ... ] | null,
      "bodyBottom": [ ... ] | null,
      "title": [ ... ] | null,
      "sides": [{ "label": "...", "text": "..." }, ...] | null
    }
  ],
  "caption": "updated caption if the caption was flagged, otherwise null"
}

Only include slides you actually fixed. If a field wasn't flagged, DO NOT
include it in the output (the original stays).`;

export type RepairUsage = {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  approxCostUsd: number;
};

export type RepairResult = {
  post: EditorialPost;
  fixedPositions: number[];
  usage: RepairUsage;
  raw: Anthropic.Message;
};

function normalizeSpanRun(v: unknown): SpanRun | null {
  if (!Array.isArray(v)) return null;
  const validRoles = new Set(['narrative', 'hook', 'pivot']);
  const runs = v
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x) => ({
      text: typeof x.text === 'string' ? x.text : '',
      role: typeof x.role === 'string' && validRoles.has(x.role)
        ? x.role as SpanRun[number]['role']
        : 'narrative' as const,
    }))
    .filter((s) => s.text.length > 0);
  return runs.length > 0 ? runs : null;
}

/**
 * Haiku 4.5 pricing (matches humanize.ts) — for cost estimation.
 * $1/Mtok input, $5/Mtok output, cache reads $0.10/Mtok, cache writes $1.25/Mtok.
 */
const HAIKU_INPUT_USD_PER_MTOK = 1.0;
const HAIKU_OUTPUT_USD_PER_MTOK = 5.0;
const HAIKU_CACHE_READ_USD_PER_MTOK = 0.10;
const HAIKU_CACHE_WRITE_USD_PER_MTOK = 1.25;

function haikuCostUsd(u: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }): number {
  return (
    u.inputTokens * HAIKU_INPUT_USD_PER_MTOK
    + u.outputTokens * HAIKU_OUTPUT_USD_PER_MTOK
    + u.cacheReadTokens * HAIKU_CACHE_READ_USD_PER_MTOK
    + u.cacheWriteTokens * HAIKU_CACHE_WRITE_USD_PER_MTOK
  ) / 1_000_000;
}

function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const candidate = trimmed.slice(firstBrace, lastBrace + 1);
      try { return JSON.parse(candidate); } catch { /* fall through */ }
    }
    throw new Error(`repair: unparseable JSON — ${trimmed.slice(0, 200)}`);
  }
}

/**
 * Build the affected-slide subset + issue list for Haiku's user message.
 * Only slides referenced by the QA issues get included — Haiku doesn't
 * need to see slides that already passed.
 */
function buildRepairInput(post: EditorialPost, qa: QaResult): {
  affectedPositions: Set<number>;
  userText: string;
} {
  const affectedPositions = new Set<number>();
  const issues: Array<{ position: number | 'caption'; field: string; pattern: string; text: string }> = [];

  // Static issues from runStaticQa.
  for (const issue of qa.static_issues) {
    // Format is "slide N (BEAT) field: pattern — text" or similar.
    const match = issue.match(/slide\s+(\d+)/i);
    if (match) {
      const pos = Number(match[1]);
      affectedPositions.add(pos);
      const fieldMatch = issue.match(/(headline|body|bodyBottom|title|caption)/i);
      issues.push({
        position: pos,
        field: fieldMatch?.[1] ?? 'body',
        pattern: 'static',
        text: issue,
      });
    } else if (/caption/i.test(issue)) {
      issues.push({ position: 'caption', field: 'caption', pattern: 'static', text: issue });
    }
  }

  // LLM voice issues.
  for (const vi of qa.llm.voice_issues) {
    affectedPositions.add(vi.position);
    issues.push({
      position: vi.position,
      field: vi.field,
      pattern: vi.pattern,
      text: vi.text,
    });
  }

  const affectedSlides = post.slides.filter((s) => affectedPositions.has(s.position));
  const userText =
    `ORIGINAL SLIDES (only the ones referenced by issues):\n`
    + `${JSON.stringify(affectedSlides, null, 2)}\n\n`
    + `CAPTION (only if flagged):\n`
    + `${issues.some((i) => i.position === 'caption') ? post.caption : '(not flagged, skip)'}\n\n`
    + `QA ISSUES:\n`
    + `${JSON.stringify(issues, null, 2)}\n\n`
    + `Rewrite ONLY the flagged fields on the listed slides. Preserve every fact.`;

  return { affectedPositions, userText };
}

export type RepairInput = {
  post: EditorialPost;
  qa: QaResult;
  factSheet: FactSheet;
};

/**
 * Run one targeted repair pass. Returns the post with flagged fields
 * rewritten by Haiku. Non-flagged fields are preserved from the input.
 *
 * When no repair is needed (0 issues) or too many issues to repair (> 5),
 * returns the post unchanged with zero usage.
 */
export async function repairPost(input: RepairInput): Promise<RepairResult> {
  const { post, qa } = input;
  const totalIssues = qa.static_issues.length + qa.llm.voice_issues.length;

  const zeroUsage: RepairUsage = {
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    approxCostUsd: 0,
  };

  // No repair needed — skip.
  if (totalIssues === 0) {
    return {
      post,
      fixedPositions: [],
      usage: zeroUsage,
      raw: { content: [], usage: { input_tokens: 0, output_tokens: 0 } } as unknown as Anthropic.Message,
    };
  }

  // Too many issues — post has structural problems, repair won't help.
  // Return unchanged; caller marks as failed and flags for human review.
  if (totalIssues > 5) {
    return {
      post,
      fixedPositions: [],
      usage: zeroUsage,
      raw: { content: [], usage: { input_tokens: 0, output_tokens: 0 } } as unknown as Anthropic.Message,
    };
  }

  const { affectedPositions, userText } = buildRepairInput(post, qa);
  if (affectedPositions.size === 0 && !qa.static_issues.some((i) => /caption/i.test(i))) {
    return {
      post,
      fixedPositions: [],
      usage: zeroUsage,
      raw: { content: [], usage: { input_tokens: 0, output_tokens: 0 } } as unknown as Anthropic.Message,
    };
  }

  const response = await anthropic.messages.create({
    model: HUMANIZER_MODEL, // Haiku for cheap targeted rewrite
    max_tokens: 3000,
    system: cachedSystemText(REPAIR_SYSTEM_PROMPT, '1h'),
    messages: [{ role: 'user', content: userText }],
  });

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === 'text',
  );
  if (!textBlock) throw new Error('repair: model returned no text block');

  const parsed = parseJson(textBlock.text) as {
    fixed_slides?: unknown;
    caption?: unknown;
  };
  const fixedSlidesRaw = Array.isArray(parsed.fixed_slides) ? parsed.fixed_slides : [];
  const newCaption = typeof parsed.caption === 'string' && parsed.caption.length > 0
    ? parsed.caption.trim()
    : null;

  // Merge fixed slides back into the post.
  const fixedByPosition = new Map<number, Partial<BeatCopy>>();
  for (const s of fixedSlidesRaw) {
    if (typeof s !== 'object' || s === null) continue;
    const sx = s as Record<string, unknown>;
    if (typeof sx.position !== 'number') continue;
    const pos = Math.round(sx.position);
    const patch: Partial<BeatCopy> = {};
    if ('headline' in sx) patch.headline = normalizeSpanRun(sx.headline);
    if ('body' in sx) patch.body = normalizeSpanRun(sx.body);
    if ('bodyBottom' in sx) patch.bodyBottom = normalizeSpanRun(sx.bodyBottom);
    if ('title' in sx) patch.title = normalizeSpanRun(sx.title);
    if ('sides' in sx && Array.isArray(sx.sides)) {
      patch.sides = (sx.sides as Array<{ label?: unknown; text?: unknown }>)
        .filter((si) => typeof si === 'object' && si !== null)
        .map((si) => ({
          label: typeof si.label === 'string' ? si.label.trim() : '',
          text: typeof si.text === 'string' ? si.text.trim() : '',
        }))
        .filter((si) => si.label.length > 0 && si.text.length > 0);
    }
    fixedByPosition.set(pos, patch);
  }

  const newSlides = post.slides.map((slide) => {
    const patch = fixedByPosition.get(slide.position);
    if (!patch) return slide;
    return { ...slide, ...patch };
  });
  const newCaptionFinal = newCaption ?? post.caption;

  const cache = cacheUsageFromMessage(response);
  const outputTokens = Math.max(0, Number(response.usage.output_tokens ?? 0));
  const usage: RepairUsage = {
    inputTokens: cache.inputTokens,
    cacheReadTokens: cache.cacheReadTokens,
    cacheWriteTokens: cache.cacheWriteTokens,
    outputTokens,
    approxCostUsd: haikuCostUsd({
      inputTokens: cache.inputTokens,
      outputTokens,
      cacheReadTokens: cache.cacheReadTokens,
      cacheWriteTokens: cache.cacheWriteTokens,
    }),
  };

  return {
    post: { slides: newSlides, caption: newCaptionFinal },
    fixedPositions: Array.from(fixedByPosition.keys()).sort((a, b) => a - b),
    usage,
    raw: response,
  };
}
