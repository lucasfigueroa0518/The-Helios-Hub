import type Anthropic from '@anthropic-ai/sdk';

import { anthropic } from '@/lib/anthropic';
import { cachedSystemText, cacheUsageFromMessage } from '@/lib/anthropic-cache';
import { EDITORIAL_MODEL, sonnetCostUsd } from '@/lib/social/editorial/config';
import { ARCHETYPE_SPECS, renderArchetypeGuidance, type Archetype } from '@/lib/social/editorial/archetype';
import type { ChosenHook } from '@/lib/social/editorial/hook-mine';
import type { FactSheet } from '@/lib/social/editorial/fact-sheet';
import type { StrategyPlan, BucketId } from '@/lib/social/editorial/strategy';

/**
 * Stage 4 — story plan.
 *
 * From `~/.claude/skills/helios-social-editorial/SKILL.md` §4: write a beat
 * sheet before any copy. Every slide gets one job. 8-11 slides, five Ws
 * covered by slide 3, one idea per slide, a TURN every 2-3 slides, every
 * big number gets a SCALE treatment, ≥1 PROOF beat, knowledge-heavy posts
 * get one ANALOGY, ending is THESIS → DEBATE → FOLLOW.
 *
 * The `facts` array on each slide points BACK into the fact sheet — either
 * "key_facts[i]" style pointers or a short label pointing at a number/quote
 * — so downstream stages can trace every claim to a verifiable source.
 */

const BEATS = [
  'HOOK',
  'GROUND',
  'SCALE',
  'CONTEXT',
  'TURN',
  'PROOF',
  'SCENARIO',
  'MECHANISM',
  'ANALOGY',
  'QUOTE',
  'STAKES',
  'TWIST',
  'THESIS',
  'DEBATE',
  'FOLLOW',
] as const;

export type Beat = typeof BEATS[number];

const SYSTEM_PROMPT = `You write the STORY PLAN for a Helios Social carousel.

You receive:
- FACT SHEET (JSON) — verified facts, with source_sentence pointers
- CHOSEN HOOK (JSON) — the winning cover hook
- STRATEGY (JSON) — value type, arousal/curiosity/knowledge scores,
  primary/secondary, bucket, target_slide_count

Your job is to plan the carousel beat by beat. One slide per beat. Every
slide gets one job. The strategy sets the OPENING energy; the bucket sets
the SHAPE.

## Beats — pick from this vocabulary only

- HOOK        the cover; actor + news + open loop (always position 0)
- GROUND      the five Ws — what actually happened
- SCALE       make a number concrete with a comparison
- CONTEXT     history, how we got here
- TURN        mid-post re-hook; a new fact or a new direction
- PROOF       third-party evidence — a real headline, paper figure, tweet, or quote
- SCENARIO    "now imagine…" a concrete picture of the consequence
- MECHANISM   how it works — cause and effect, a flywheel
- ANALOGY     a comparison from everyday life
- QUOTE       a named person's words carry the slide
- STAKES      who wins, who loses
- TWIST       a fact that cuts against reader expectation
- THESIS      zoom out — an editor's landing sentence
- DEBATE      a question with two real sides
- FOLLOW      account promise tied to this story (always last)

## Rules

1. slide_count is target_slide_count from strategy (8-11). Never pad to hit
   the count. If the material only justifies 8, use 8.
2. The five Ws are covered by slide 3.
3. One idea per slide. A slide with two ideas becomes two slides.
4. A TURN every 2-3 slides. Each turn brings a new fact or a new
   direction; never a restatement.
5. Every slide leaves a reason to swipe (swipe_reason field).
6. Every big number in the fact sheet gets a SCALE treatment.
7. At least one PROOF beat per post.
8. Knowledge-heavy posts (strategy.knowledge >= 4) get one ANALOGY beat.
9. **When the news creates a NEW REQUIREMENT** — a mandate, rule, obligation,
   deadline someone has to meet, or capability someone has to build — include
   one MECHANISM beat that explains HOW the thing gets implemented or
   enforced. "What must be done" is not the same as "how it gets done"; the
   reader needs both. Examples that trigger this rule: a kill-switch mandate,
   a reporting requirement, an audit rule, a compliance deadline, a safety
   plan obligation. Without a MECHANISM beat, QA will flag the missing "how"
   W and the story reads like a press release.
10. Ending is THESIS → DEBATE → FOLLOW in that order. Always.
10. FOLLOW's line ties the account promise to THIS story, not a generic
    "follow for more." Write it as \`follow_line\` under the FOLLOW slide's
    purpose field, e.g. "We cover the AI stories the press releases leave out."

## Facts pointers

Each slide has a \`facts\` array. Each entry is a short label pointing back
into the fact sheet. Valid forms:
- "key_facts[0]" through "key_facts[N-1]"
- "numbers[0]" through "numbers[N-1]"
- "quotes[0]" through "quotes[N-1]"
- "players[0]" through "players[N-1]"
- "assets[0]" through "assets[N-1]"
- "second_order[0]" through "second_order[N-1]"
- "five_ws" — the whole five_ws object
- "five_ws.who" / "five_ws.what" / "five_ws.when" / "five_ws.where" / "five_ws.why" / "five_ws.why_reader_cares"
- "chosen_hook" for the HOOK slide

Every claim a slide will make must be traceable through these pointers.

## Asset needs

Each slide has an \`asset_needs\` array of short strings describing what the
slide wants visually. The design skill picks a layout using these. Examples:
- "portrait of Suleyman"
- "server-rack metaphor photo"
- "bar chart: Anthropic vs top 5 SF IPOs combined"
- "type-only slide, no photo"
- "screenshot of the Redfin headline"

## Output — strict JSON, no prose, no code fences

{
  "slide_count": 8-11,
  "slides": [
    {
      "position": 0,
      "beat": "HOOK",
      "purpose": "one short line: this slide's job",
      "facts": ["chosen_hook", "players[0]"],
      "asset_needs": ["portrait of Suleyman"],
      "swipe_reason": "one short line: what makes the reader want slide 2"
    },
    ...
  ],
  "caption_plan": "one short paragraph: news peg, source, context the slides skip, debate prompt"
}

Never write copy. This is a plan, not a script. Copy comes in Stage 5.`;

export type StoryPlanSlide = {
  position: number;
  beat: Beat;
  purpose: string;
  facts: string[];
  asset_needs: string[];
  swipe_reason: string;
};

export type StoryPlan = {
  bucket: BucketId;
  slide_count: number;
  slides: StoryPlanSlide[];
  caption_plan: string;
};

export type StoryPlanUsage = {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  approxCostUsd: number;
};

export type StoryPlanResult = {
  storyPlan: StoryPlan;
  usage: StoryPlanUsage;
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
    throw new Error(`story-plan: ${mode} — ${head}${tail}`);
  }
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];
}

function normalize(raw: unknown, bucket: BucketId): StoryPlan {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('story-plan: model returned non-object JSON');
  }
  const r = raw as Record<string, unknown>;

  const beatSet = new Set<Beat>(BEATS);
  const slidesRaw = Array.isArray(r.slides) ? r.slides : [];
  const slides: StoryPlanSlide[] = slidesRaw
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x, idx) => {
      const beatRaw = typeof x.beat === 'string' ? x.beat.toUpperCase() : '';
      const beat: Beat = beatSet.has(beatRaw as Beat) ? beatRaw as Beat : 'GROUND';
      return {
        position: typeof x.position === 'number' ? Math.max(0, Math.round(x.position)) : idx,
        beat,
        purpose: typeof x.purpose === 'string' ? x.purpose.trim() : '',
        facts: asStringArray(x.facts),
        asset_needs: asStringArray(x.asset_needs),
        swipe_reason: typeof x.swipe_reason === 'string' ? x.swipe_reason.trim() : '',
      };
    })
    .sort((a, b) => a.position - b.position);

  const slide_count = typeof r.slide_count === 'number'
    ? Math.max(8, Math.min(11, Math.round(r.slide_count)))
    : slides.length;

  const caption_plan = typeof r.caption_plan === 'string' ? r.caption_plan.trim() : '';

  return { bucket, slide_count, slides, caption_plan };
}

/**
 * Validate the plan against the editorial skill's non-negotiables. Returns
 * a list of issues; empty array = clean plan. Callers can decide whether to
 * retry compose or accept-with-warnings.
 */
export function validateStoryPlan(plan: StoryPlan, strategy: StrategyPlan): string[] {
  const issues: string[] = [];

  if (plan.slides.length === 0) {
    issues.push('plan has no slides');
    return issues;
  }
  if (plan.slides.length < 8 || plan.slides.length > 11) {
    issues.push(`slide count ${plan.slides.length} outside 8-11 range`);
  }

  const first = plan.slides[0]!;
  const last = plan.slides[plan.slides.length - 1]!;
  const secondToLast = plan.slides[plan.slides.length - 2];
  const thirdToLast = plan.slides[plan.slides.length - 3];

  if (first.beat !== 'HOOK') issues.push('first slide is not HOOK');
  if (last.beat !== 'FOLLOW') issues.push('last slide is not FOLLOW');
  if (secondToLast && secondToLast.beat !== 'DEBATE') issues.push('second-to-last slide is not DEBATE');
  if (thirdToLast && thirdToLast.beat !== 'THESIS') issues.push('third-to-last slide is not THESIS');

  const beats = plan.slides.map((s) => s.beat);
  const hasProof = beats.includes('PROOF');
  // PROOF is universal for GENERIC/NUMBER/DEADLINE; FIGHT stories can carry
  // proof implicitly via QUOTE from a named speaker.
  const proofRequired = strategy.archetype !== 'FIGHT';
  if (proofRequired && !hasProof) issues.push('no PROOF beat');

  const knowledgeHeavy = strategy.strategy_scores.knowledge >= 4;
  const hasAnalogy = beats.includes('ANALOGY');
  if (knowledgeHeavy && !hasAnalogy) issues.push('knowledge-heavy story missing ANALOGY beat');

  // Archetype-specific beat constraints. Required beats must appear;
  // forbidden beats must not. GENERIC has no additional constraints.
  if (strategy.archetype !== 'GENERIC') {
    const spec = ARCHETYPE_SPECS[strategy.archetype];
    const beatSet = new Set(beats);
    for (const req of spec.required_beats) {
      if (!beatSet.has(req as (typeof beats)[number])) {
        issues.push(`archetype ${strategy.archetype} requires beat ${req}`);
      }
    }
    for (const forbid of spec.forbidden_beats) {
      if (beatSet.has(forbid as (typeof beats)[number])) {
        issues.push(`archetype ${strategy.archetype} forbids beat ${forbid} (does not fit this shape)`);
      }
    }
  }

  // TURN cadence check — no gap > 3 without a TURN.
  let sinceTurn = 0;
  const bodyBeats = beats.slice(1, -3); // skip HOOK + THESIS/DEBATE/FOLLOW
  for (const b of bodyBeats) {
    if (b === 'TURN') sinceTurn = 0;
    else sinceTurn += 1;
    if (sinceTurn > 3) {
      issues.push('TURN cadence broken — more than 3 body slides without a TURN');
      break;
    }
  }

  // No two consecutive slides with the same beat.
  for (let i = 1; i < plan.slides.length; i += 1) {
    if (plan.slides[i]!.beat === plan.slides[i - 1]!.beat) {
      issues.push(`consecutive same beat at positions ${i - 1}-${i}: ${plan.slides[i]!.beat}`);
    }
  }

  // Every slide has a swipe_reason (except the last one — FOLLOW is the end).
  for (const s of plan.slides.slice(0, -1)) {
    if (!s.swipe_reason || s.swipe_reason.length === 0) {
      issues.push(`slide ${s.position} (${s.beat}) missing swipe_reason`);
    }
  }

  return issues;
}

export type StoryPlanInput = {
  factSheet: FactSheet;
  chosenHook: ChosenHook;
  strategy: StrategyPlan;
};

export async function buildStoryPlan(input: StoryPlanInput): Promise<StoryPlanResult> {
  // Archetype guidance is appended to the USER message (not the system
  // prompt) so the base system-prompt cache stays hot across all articles
  // and archetypes. Cache miss cost would otherwise 3x with 3 archetypes.
  const archetypeBlock = renderArchetypeGuidance(input.strategy.archetype);
  const userText =
    `FACT SHEET (JSON):\n${JSON.stringify(input.factSheet, null, 2)}\n\n`
    + `CHOSEN HOOK (JSON):\n${JSON.stringify(input.chosenHook, null, 2)}\n\n`
    + `STRATEGY (JSON):\n${JSON.stringify(input.strategy, null, 2)}`
    + archetypeBlock;

  const response = await anthropic.messages.create({
    model: EDITORIAL_MODEL,
    // 11 slides × ~350 tokens each + wrapper = ~4200. Give headroom.
    max_tokens: 5000,
    system: cachedSystemText(SYSTEM_PROMPT, '1h'),
    messages: [{ role: 'user', content: userText }],
  });

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === 'text',
  );
  if (!textBlock) throw new Error('story-plan: model returned no text block');

  const storyPlan = normalize(parseJson(textBlock.text), input.strategy.bucket);
  const cache = cacheUsageFromMessage(response);
  const outputTokens = Math.max(0, Number(response.usage.output_tokens ?? 0));
  const usage: StoryPlanUsage = {
    inputTokens: cache.inputTokens,
    cacheReadTokens: cache.cacheReadTokens,
    cacheWriteTokens: cache.cacheWriteTokens,
    outputTokens,
    approxCostUsd: sonnetCostUsd({
      inputTokens: cache.inputTokens,
      outputTokens,
      cacheReadTokens: cache.cacheReadTokens,
      cacheWriteTokens: cache.cacheWriteTokens,
    }),
  };

  return { storyPlan, usage, raw: response };
}

export { BEATS };
