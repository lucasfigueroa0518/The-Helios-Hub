import type Anthropic from '@anthropic-ai/sdk';

import { anthropic } from '@/lib/anthropic';
import { cachedSystemText, cacheUsageFromMessage } from '@/lib/anthropic-cache';
import { EDITORIAL_MODEL, sonnetCostUsd } from '@/lib/social/editorial/config';
import { deriveArchetype, type Archetype, type ArchetypeSignals } from '@/lib/social/editorial/archetype';
import type { ChosenHook } from '@/lib/social/editorial/hook-mine';
import type { FactSheet } from '@/lib/social/editorial/fact-sheet';
import { jevChooseStrategy } from '@/lib/social/editorial/strategy-jev';

/**
 * Stage 3 — strategy and bucket (Jev + Sonnet hybrid).
 *
 * From `~/.claude/skills/helios-social-editorial/SKILL.md` §3.
 *
 * Split:
 *   - **Jev** (via strategy-jev.ts) — value_type (knowledge/entertainment) +
 *     bucket-fit scoring across the 7 buckets. Both are multi-way
 *     classifications that Jev's Noul is a natural fit for.
 *   - **Sonnet** (this module) — arousal/curiosity/knowledge scoring (1-5,
 *     needs reasoning), primary/secondary derivation, value_reason,
 *     bucket_reason, strategy_reason, target_slide_count.
 *
 * The hybrid saves ~50% on the Sonnet cost per article vs. the earlier
 * pure-Sonnet call; Jev's per-article cost is ~$0.0002. Same StrategyResult
 * interface, so callers don't change.
 */

const BUCKETS = [
  'what_just_happened',
  'the_bigger_story',
  'power_play',
  'person_profile',
  'what_to_know',
  'the_research_says',
  'use_it',
] as const;

export type BucketId = typeof BUCKETS[number];

const SONNET_SYSTEM_PROMPT = `You score the PSYCHOLOGICAL STRATEGY for a Helios Social carousel.

You receive:
- FACT SHEET (JSON) — verified facts about the article
- CHOSEN HOOK (JSON) — the cover hook that passed the gate
- PRE-DECIDED (JSON) — value_type and bucket already decided upstream by a
  cheap classifier. Do not second-guess these decisions; they are given.

Your job is the numeric strategy scoring and the short reasoning lines.

## Psychological strategy — score 1-5 on each

- arousal — anger, awe, fear, shock. Lead with the shocking fact, then back
  it up. The chosen hook leans arousal when it opens on a big number or
  claim.
- curiosity — open a question and hold the answer back. The chosen hook is
  a curiosity engine when it teases a "here's what" or "here's the how".
- knowledge — inverted pyramid, most useful takeaway first. Higher when
  the story explains a mechanism, a tool, a process, or a benchmark.

primary = highest-scored, secondary = second-highest. The top score sets
the opening; the second shapes the middle. Ties broken by whatever the
chosen hook most naturally extends.

## target_slide_count

Bucket's shape range, dialed by fact sheet source_strength:
- what_just_happened: 8-9  (thin→8, solid→8-9, rich→9)
- the_bigger_story:   10-11 (thin→10, solid→10-11, rich→11)
- power_play:         8-11  (thin→8, solid→9-10, rich→10-11)
- person_profile:     9-11  (thin→9, solid→10, rich→11)
- what_to_know:       8-9   (thin→8, solid→8-9, rich→9)
- the_research_says:  8-11  (thin→8-9, solid→9-10, rich→10-11)
- use_it:             8-9   (thin→8, solid→8-9, rich→9)

## Output — strict JSON, no prose, no code fences

{
  "value_reason":     "one short line: why this value type (max 20 words)",
  "strategy_scores":  { "arousal": 1-5, "curiosity": 1-5, "knowledge": 1-5 },
  "primary":          "arousal" | "curiosity" | "knowledge",
  "secondary":        "arousal" | "curiosity" | "knowledge",
  "strategy_reason":  "one short line: what the opening does + what the middle does (max 25 words)",
  "bucket_reason":    "one short line: why this bucket fits the story (max 25 words)",
  "target_slide_count": integer 8-11
}`;

export type StrategyPlan = {
  value_type: 'knowledge' | 'entertainment';
  value_reason: string;
  strategy_scores: {
    arousal: number;
    curiosity: number;
    knowledge: number;
  };
  primary: 'arousal' | 'curiosity' | 'knowledge';
  secondary: 'arousal' | 'curiosity' | 'knowledge';
  strategy_reason: string;
  bucket_scores: Record<BucketId, number>;
  bucket: BucketId;
  bucket_reason: string;
  target_slide_count: number;
  /**
   * Story-shape archetype derived from fact-sheet signals (heuristic router,
   * no LLM call). Drives story-plan beat rules downstream. GENERIC = falls
   * back to universal flow when no strong signal is present.
   */
  archetype: Archetype;
  archetype_reason: string;
  archetype_signals: ArchetypeSignals;
};

export type StrategyUsage = {
  /** Sonnet input tokens (non-cached). */
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  /** Jev input tokens; output is free. */
  jevInputTokens: number;
  approxCostUsd: number;
  models: { editorial: string; jev: string };
};

export type StrategyResult = {
  strategy: StrategyPlan;
  usage: StrategyUsage;
  raw: Anthropic.Message;
};

function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const startsLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[');
    const endsLikeJson = trimmed.endsWith('}') || trimmed.endsWith(']');
    const mode = startsLikeJson && !endsLikeJson
      ? 'truncated'
      : startsLikeJson
        ? 'malformed'
        : 'non-json';
    const head = trimmed.slice(0, 160);
    const tail = trimmed.length > 160 ? `... [${trimmed.length} chars] ...${trimmed.slice(-120)}` : '';
    throw new Error(`strategy: ${mode} — ${head}${tail}`);
  }
}

function clampScore(v: unknown, min = 1, max = 5): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

type SonnetScoringResult = {
  value_reason: string;
  strategy_scores: { arousal: number; curiosity: number; knowledge: number };
  primary: 'arousal' | 'curiosity' | 'knowledge';
  secondary: 'arousal' | 'curiosity' | 'knowledge';
  strategy_reason: string;
  bucket_reason: string;
  target_slide_count: number;
};

function normalizeSonnet(raw: unknown): SonnetScoringResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('strategy: model returned non-object JSON');
  }
  const r = raw as Record<string, unknown>;

  const scoresRaw = (typeof r.strategy_scores === 'object' && r.strategy_scores !== null)
    ? r.strategy_scores as Record<string, unknown>
    : {};
  const strategy_scores = {
    arousal: clampScore(scoresRaw.arousal),
    curiosity: clampScore(scoresRaw.curiosity),
    knowledge: clampScore(scoresRaw.knowledge),
  };

  const strategyKeys = ['arousal', 'curiosity', 'knowledge'] as const;
  const rankedStrategies = [...strategyKeys].sort((a, b) => strategy_scores[b] - strategy_scores[a]);
  const modelPrimary = typeof r.primary === 'string' && (strategyKeys as readonly string[]).includes(r.primary)
    ? r.primary as typeof strategyKeys[number]
    : rankedStrategies[0]!;
  const modelSecondary = typeof r.secondary === 'string'
    && (strategyKeys as readonly string[]).includes(r.secondary)
    && r.secondary !== modelPrimary
      ? r.secondary as typeof strategyKeys[number]
      : (rankedStrategies.find((k) => k !== modelPrimary) ?? rankedStrategies[1]!);

  const targetRaw = typeof r.target_slide_count === 'number' ? r.target_slide_count : 9;
  const target_slide_count = Math.max(8, Math.min(11, Math.round(targetRaw)));

  return {
    value_reason: typeof r.value_reason === 'string' ? r.value_reason.trim() : '',
    strategy_scores,
    primary: modelPrimary,
    secondary: modelSecondary,
    strategy_reason: typeof r.strategy_reason === 'string' ? r.strategy_reason.trim() : '',
    bucket_reason: typeof r.bucket_reason === 'string' ? r.bucket_reason.trim() : '',
    target_slide_count,
  };
}

export type StrategyInput = {
  factSheet: FactSheet;
  chosenHook: ChosenHook;
};

export async function chooseStrategy(input: StrategyInput): Promise<StrategyResult> {
  // Stage 3a — Jev picks bucket + value_type.
  const jev = await jevChooseStrategy(input);

  // Stage 3b — Sonnet fills in the 1-5 scores + reasoning, taking bucket +
  // value_type as pre-decided context.
  const preDecided = {
    value_type: jev.value_type,
    value_probability: jev.value_probability,
    bucket: jev.bucket,
    bucket_scores: jev.bucket_scores,
    bucket_probability: jev.bucket_probability,
  };
  const userText =
    `FACT SHEET (JSON):\n${JSON.stringify(input.factSheet, null, 2)}\n\n`
    + `CHOSEN HOOK (JSON):\n${JSON.stringify(input.chosenHook, null, 2)}\n\n`
    + `PRE-DECIDED (JSON):\n${JSON.stringify(preDecided, null, 2)}`;

  const response = await anthropic.messages.create({
    model: EDITORIAL_MODEL,
    max_tokens: 1200,
    system: cachedSystemText(SONNET_SYSTEM_PROMPT, '1h'),
    messages: [{ role: 'user', content: userText }],
  });

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === 'text',
  );
  if (!textBlock) throw new Error('strategy: model returned no text block');

  const sonnetResult = normalizeSonnet(parseJson(textBlock.text));

  // Stage 3c — heuristic archetype router. Pure function over fact-sheet
  // signals; zero LLM cost. Routes to DEADLINE/FIGHT/NUMBER when signals are
  // clear, GENERIC otherwise (preserves the pre-archetype universal flow).
  const archetypeDecision = deriveArchetype(input.factSheet);

  const strategy: StrategyPlan = {
    value_type: jev.value_type,
    value_reason: sonnetResult.value_reason,
    strategy_scores: sonnetResult.strategy_scores,
    primary: sonnetResult.primary,
    secondary: sonnetResult.secondary,
    strategy_reason: sonnetResult.strategy_reason,
    bucket_scores: jev.bucket_scores,
    bucket: jev.bucket,
    bucket_reason: sonnetResult.bucket_reason,
    target_slide_count: sonnetResult.target_slide_count,
    archetype: archetypeDecision.archetype,
    archetype_reason: archetypeDecision.reason,
    archetype_signals: archetypeDecision.signals,
  };

  const cache = cacheUsageFromMessage(response);
  const outputTokens = Math.max(0, Number(response.usage.output_tokens ?? 0));
  const sonnetCost = sonnetCostUsd({
    inputTokens: cache.inputTokens,
    outputTokens,
    cacheReadTokens: cache.cacheReadTokens,
    cacheWriteTokens: cache.cacheWriteTokens,
  });
  const usage: StrategyUsage = {
    inputTokens: cache.inputTokens,
    cacheReadTokens: cache.cacheReadTokens,
    cacheWriteTokens: cache.cacheWriteTokens,
    outputTokens,
    jevInputTokens: jev.usage.inputTokens,
    approxCostUsd: sonnetCost + jev.usage.approxCostUsd,
    models: { editorial: EDITORIAL_MODEL, jev: jev.usage.model },
  };

  return { strategy, usage, raw: response };
}

export { BUCKETS };
