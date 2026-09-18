import type Anthropic from '@anthropic-ai/sdk';

import { anthropic } from '@/lib/anthropic';
import { cachedSystemText, cacheUsageFromMessage } from '@/lib/anthropic-cache';
import { HELIOS_RELEVANCE_RUBRIC } from '@/lib/social/rubric';

/**
 * Haiku shadow judge — the "alternate reality" for A/B research against Jev.
 *
 * Never affects production decisions. When enabled (via env var), this runs
 * alongside the production Jev call using the SAME rubric text; the result
 * lands in helios_social.judge_shadow_ledger for offline comparison. Kill
 * switch: HELIOS_SOCIAL_SHADOW_HAIKU_JUDGE=0 (default) turns it off entirely.
 *
 * Prompt is cache_control'd with a 1h TTL so subsequent shadow calls within
 * a run pay ~10% of input cost after the first.
 */

const SHADOW_MODEL = 'claude-haiku-4-5-20251001';

const SHADOW_SYSTEM_PROMPT = `
You are the shadow relevance filter for Helios Marketing. This is a research
call — a parallel judgment run alongside the production Jev model. Your verdict
is compared to Jev's offline; it never affects production decisions.

Apply the SAME rubric Jev applies. Return your score on the SAME 0.0-1.0 scale.

${HELIOS_RELEVANCE_RUBRIC}

Return strict JSON only. No prose. No code fences.
Shape: {"score": 0.0, "reason": "one-sentence why"}
`.trim();

export type ShadowHaikuJudgeInput = {
  source: string;
  headline: string;
  byline: string | null;
  body: string;
};

export type ShadowHaikuJudgeResult = {
  /** 0.0-1.0 relevance score (directly comparable to Jev's noul). */
  score: number;
  /** One-sentence justification from Haiku (for disagreement analysis). */
  reason: string;
  approxCostUsd: number;
  inputTokens: number;
  outputTokens: number;
};

// Haiku 4.5 approximate pricing.
const HAIKU_INPUT_USD_PER_MTOK = 1.0;
const HAIKU_CACHE_READ_USD_PER_MTOK = 0.1;
const HAIKU_CACHE_WRITE_USD_PER_MTOK = 1.25;
const HAIKU_OUTPUT_USD_PER_MTOK = 5.0;

function parseVerdict(text: string): { score: number; reason: string } {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`Shadow returned non-JSON: ${trimmed.slice(0, 200)}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Shadow returned non-object JSON');
  }
  const r = parsed as Record<string, unknown>;
  const score = Number(r.score);
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error(`Shadow invalid score: ${r.score}`);
  }
  const reason = typeof r.reason === 'string' ? r.reason.trim() : '';
  return { score, reason };
}

export async function shadowHaikuJudge(
  input: ShadowHaikuJudgeInput,
): Promise<ShadowHaikuJudgeResult> {
  const bylineLine = input.byline ? `Byline: ${input.byline}\n` : '';
  const userText =
    `Source: ${input.source}\n`
    + `Headline: ${input.headline}\n`
    + bylineLine
    + `\nArticle body:\n${input.body.slice(0, 6000)}`;

  const response = await anthropic.messages.create({
    model: SHADOW_MODEL,
    max_tokens: 200,
    system: cachedSystemText(SHADOW_SYSTEM_PROMPT, '1h'),
    messages: [{ role: 'user', content: userText }],
  });

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === 'text',
  );
  if (!textBlock) throw new Error('Shadow returned no text block');

  const { score, reason } = parseVerdict(textBlock.text);
  const cacheUsage = cacheUsageFromMessage(response);
  const outputTokens = Math.max(0, Number(response.usage.output_tokens ?? 0));
  const approxCostUsd =
    (cacheUsage.inputTokens * HAIKU_INPUT_USD_PER_MTOK
      + cacheUsage.cacheReadTokens * HAIKU_CACHE_READ_USD_PER_MTOK
      + cacheUsage.cacheWriteTokens * HAIKU_CACHE_WRITE_USD_PER_MTOK
      + outputTokens * HAIKU_OUTPUT_USD_PER_MTOK)
    / 1_000_000;

  return {
    score,
    reason,
    approxCostUsd,
    inputTokens: cacheUsage.inputTokens,
    outputTokens,
  };
}

/**
 * Kill switch. Returns true only when the env var is an explicit truthy
 * value (`1`, `true`, `yes`). Default (unset, empty, `0`, `false`, `no`)
 * disables the shadow entirely — zero cost impact on ordinary ingests.
 */
export function shadowEnabled(): boolean {
  const v = process.env.HELIOS_SOCIAL_SHADOW_HAIKU_JUDGE?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Sampling knob. Default 1.0 (shadow every article when enabled).
 * Set HELIOS_SOCIAL_SHADOW_SAMPLE_RATE=0.1 for a 10% sample instead.
 */
export function shadowSampleRate(): number {
  const raw = process.env.HELIOS_SOCIAL_SHADOW_SAMPLE_RATE;
  if (!raw) return 1.0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 1.0;
}
