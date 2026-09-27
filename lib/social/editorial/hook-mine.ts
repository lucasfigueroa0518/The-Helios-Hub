import type Anthropic from '@anthropic-ai/sdk';

import { anthropic } from '@/lib/anthropic';
import { cachedSystemText, cacheUsageFromMessage } from '@/lib/anthropic-cache';
import {
  EDITORIAL_MODEL,
  HOOK_GATE_MIN_Q2,
  HOOK_GATE_MIN_TOTAL,
  sonnetCostUsd,
} from '@/lib/social/editorial/config';
import type { FactSheet } from '@/lib/social/editorial/fact-sheet';

/**
 * Stage 2 — hook mining and scoring.
 *
 * From `~/.claude/skills/helios-social-editorial/SKILL.md` §2: "Articles
 * contain angles, not hooks. Write 3 to 5 candidate cover hooks from the
 * fact sheet, tag each with a category, and score them."
 *
 * Sonnet only sees the fact sheet, not the raw article — the fact sheet is
 * the source of truth from stage 1. That keeps the "backed_by_facts" score
 * honest: if the fact sheet doesn't hold the claim, Sonnet can't invent it.
 *
 * The gate values live in config.ts (HOOK_GATE_MIN_TOTAL, HOOK_GATE_MIN_Q2)
 * and are env-overrideable. This module never hardcodes them.
 */

const HOOK_CATEGORIES = [
  'frame_shift',
  'authority_vs_hype',
  'provocative_question',
  'shock_number',
  'rivalry',
  'personal_payoff',
  'insider_reveal',
] as const;

export type HookCategory = typeof HOOK_CATEGORIES[number];

const SYSTEM_PROMPT = `You mine and score the cover HOOK candidates for a Helios Social carousel.

You will receive the FACT SHEET as JSON. That is the ONLY source you may use.
Do not invent facts, numbers, names, or claims the fact sheet doesn't hold.
If a candidate hook makes a claim the fact sheet can't support, mark it
"backed_by_facts": 0 and drop it from selection.

## The cover rule (non-negotiable — every candidate must satisfy all three)

1. NAME THE ACTOR. "\\$2 BILLION TO EMBED AUDITORS." fails because it doesn't
   say who. Only skip the actor's name when the actor is universally known
   in context (rare).
2. STATE THE NEWS. A reader who only sees the cover knows what happened.
   No pure teases like "You won't believe what Apple found."
3. OPEN A LOOP. The reader must want the next slide — the evidence, the
   consequence, the how, the why. If the cover fully satisfies them, it
   has no hook.

Fails:
- "Apple tested AI reasoning models on new puzzles." (no loop)
- "Apple just exposed something huge about AI." (no news)
Passes:
- "Apple just proved AI reasoning models don't actually reason. Here's what
  they found."

## Categories

Tag each candidate with one of:

- frame_shift: The obvious story points at a bigger consequence
  (e.g. "Anthropic's IPO is about to create a wealth shock SF isn't ready for")
- authority_vs_hype: A credible name contradicts the popular story
  (e.g. "Apple just proved AI 'reasoning' models don't actually reason")
- provocative_question: A high-stakes question the reader can't answer yet
  (e.g. "How would AI actually kill us all?")
- shock_number: One number made concrete
  (e.g. "Anthropic's IPO target is nearly 5x every major SF tech IPO combined")
- rivalry: Named company or person against another
  (e.g. "OpenAI just made a move Google can't ignore")
- personal_payoff: What it means for the reader's time, money, or job
  (e.g. "This tool does in 10 minutes what used to take a day")
- insider_reveal: Someone inside says what the company won't
  (e.g. "An Anthropic researcher just quit, and his reason is alarming")

## Scoring — each hook, each question 1-5

The first three come directly from Lucas's cold-reader test.

1. opens_loop: Does it open a loop? If the viewer could feel satisfied after
   3 seconds, there's no hook.
2. could_scroll_past: Could you scroll past it? If nothing about the first
   moment demands attention, it's weak. (THIS IS THE GATE — must be >= 4.)
3. payoff_implied: Is the payoff implied? The viewer should sense what
   they'll get by staying, even without the details.
4. specific: A named actor, a real number, a concrete consequence.
   "AI is changing everything" scores 1.
5. backed_by_facts: Can the fact sheet back it up? Any overclaim scores 0
   and the hook is dropped — whatever else it scored.

Total = opens_loop + could_scroll_past + payoff_implied + specific +
backed_by_facts. Range 0-25.

## Task

Produce 3 to 5 candidate hooks from the fact sheet. Score each one on all
five questions. Pick the highest-scoring candidate that is not dropped
(backed_by_facts >= 1). Return a strict JSON object. No prose, no code
fences.

## Output schema

{
  "hooks": [
    {
      "text": "the hook line as it would appear on the cover",
      "category": "one of the seven codes above",
      "scores": {
        "opens_loop": 1-5,
        "could_scroll_past": 1-5,
        "payoff_implied": 1-5,
        "specific": 1-5,
        "backed_by_facts": 0-5
      },
      "total": sum of the scores,
      "cover_rule_pass": true|false,
      "notes": "one short line — the loop this hook opens, or why it failed"
    }
  ],
  "chosen_hook_index": integer | null,
  "chosen_hook": "the winning hook text, or null if all dropped"
}

Never generate more than 5 hooks. Prefer 3-4 strong ones over 5 weak ones.
Rank by total DESC in the "hooks" array. chosen_hook_index is 0 when the
first one wins. When every hook has backed_by_facts=0, chosen_hook_index
is null and chosen_hook is null — this signals the story can't be posted.`;

export type HookScores = {
  opens_loop: number;
  could_scroll_past: number;
  payoff_implied: number;
  specific: number;
  backed_by_facts: number;
};

export type HookCandidate = {
  text: string;
  category: HookCategory;
  scores: HookScores;
  total: number;
  cover_rule_pass: boolean;
  notes: string;
};

export type ChosenHook = {
  text: string;
  category: HookCategory;
  scores: HookScores;
  total: number;
  index: number;
};

export type HookGateDecision = {
  /** True when at least one hook cleared both bars (total >= min, Q2 >= min) AND the cover rule. */
  post: boolean;
  /** One-line reason surfaced in UI. */
  reason: string;
  /** Which bar the best hook fell short on, when post=false. */
  failed_on:
    | null
    | 'no_candidates'
    | 'all_hooks_unsupported'
    | 'cover_rule_failed'
    | 'total_below_min'
    | 'could_scroll_past_below_min';
};

export type HookMiningResult = {
  hooks: HookCandidate[];
  chosen: ChosenHook | null;
  gate: HookGateDecision;
  usage: HookMiningUsage;
  raw: Anthropic.Message;
};

export type HookMiningUsage = {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  approxCostUsd: number;
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
    throw new Error(`hook-mine: ${mode} — ${head}${tail}`);
  }
}

function clampScore(v: unknown, min = 1, max = 5): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function normalizeHooks(raw: unknown): HookCandidate[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.hooks)) return [];
  const categorySet = new Set<HookCategory>(HOOK_CATEGORIES);
  return r.hooks
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x) => {
      const scoresRaw = (typeof x.scores === 'object' && x.scores !== null)
        ? x.scores as Record<string, unknown>
        : {};
      const scores: HookScores = {
        opens_loop: clampScore(scoresRaw.opens_loop),
        could_scroll_past: clampScore(scoresRaw.could_scroll_past),
        payoff_implied: clampScore(scoresRaw.payoff_implied),
        specific: clampScore(scoresRaw.specific),
        // Q5 allowed 0 — that's the "drop this hook" signal.
        backed_by_facts: clampScore(scoresRaw.backed_by_facts, 0),
      };
      const total = scores.opens_loop
        + scores.could_scroll_past
        + scores.payoff_implied
        + scores.specific
        + scores.backed_by_facts;
      const rawCategory = typeof x.category === 'string' ? x.category : '';
      const category = categorySet.has(rawCategory as HookCategory)
        ? rawCategory as HookCategory
        : 'frame_shift';
      return {
        text: typeof x.text === 'string' ? x.text.trim() : '',
        category,
        scores,
        total,
        cover_rule_pass: typeof x.cover_rule_pass === 'boolean' ? x.cover_rule_pass : false,
        notes: typeof x.notes === 'string' ? x.notes.trim() : '',
      };
    })
    .filter((h) => h.text.length > 0);
}

function decideGate(hooks: HookCandidate[]): { decision: HookGateDecision; chosen: ChosenHook | null } {
  if (hooks.length === 0) {
    return {
      decision: {
        post: false,
        reason: 'No hook candidates were produced.',
        failed_on: 'no_candidates',
      },
      chosen: null,
    };
  }

  // Only hooks whose facts backing survives Q5 are eligible.
  const supported = hooks
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h.scores.backed_by_facts >= 1);

  if (supported.length === 0) {
    return {
      decision: {
        post: false,
        reason: 'Every candidate hook overclaims the fact sheet.',
        failed_on: 'all_hooks_unsupported',
      },
      chosen: null,
    };
  }

  // Pick the best-total hook that also passes the cover rule.
  const covered = supported.filter(({ h }) => h.cover_rule_pass);
  const pool = covered.length > 0 ? covered : supported;
  pool.sort((a, b) => b.h.total - a.h.total);
  const best = pool[0]!;

  if (!best.h.cover_rule_pass) {
    return {
      decision: {
        post: false,
        reason: 'No hook satisfies the cover rule (actor + news + loop).',
        failed_on: 'cover_rule_failed',
      },
      chosen: null,
    };
  }

  const totalBar = HOOK_GATE_MIN_TOTAL;
  const q2Bar = HOOK_GATE_MIN_Q2;
  if (best.h.total < totalBar) {
    return {
      decision: {
        post: false,
        reason: `Best hook totals ${best.h.total}/25 — under the ${totalBar}/25 gate.`,
        failed_on: 'total_below_min',
      },
      chosen: null,
    };
  }
  if (best.h.scores.could_scroll_past < q2Bar) {
    return {
      decision: {
        post: false,
        reason: `Best hook's "could you scroll past" is ${best.h.scores.could_scroll_past}/5 — under the ${q2Bar}/5 gate.`,
        failed_on: 'could_scroll_past_below_min',
      },
      chosen: null,
    };
  }

  return {
    decision: {
      post: true,
      reason: `Hook clears the gate at ${best.h.total}/25 (Q2 ${best.h.scores.could_scroll_past}/5).`,
      failed_on: null,
    },
    chosen: {
      text: best.h.text,
      category: best.h.category,
      scores: best.h.scores,
      total: best.h.total,
      index: best.i,
    },
  };
}

export async function mineHooks(factSheet: FactSheet): Promise<HookMiningResult> {
  const userText = `FACT SHEET (JSON):\n${JSON.stringify(factSheet, null, 2)}`;

  const response = await anthropic.messages.create({
    model: EDITORIAL_MODEL,
    // 3000 gives room for 5 candidates × ~400 tokens each (text + scores +
    // notes) plus the wrapping array. 2000 was close to the ceiling with
    // 4 candidates already; a rich fact sheet with 5 could truncate.
    max_tokens: 3000,
    system: cachedSystemText(SYSTEM_PROMPT, '1h'),
    messages: [{ role: 'user', content: userText }],
  });

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === 'text',
  );
  if (!textBlock) throw new Error('hook-mine: model returned no text block');

  const raw = parseJson(textBlock.text);
  const hooks = normalizeHooks(raw);
  const { decision, chosen } = decideGate(hooks);

  const cache = cacheUsageFromMessage(response);
  const outputTokens = Math.max(0, Number(response.usage.output_tokens ?? 0));
  const usage: HookMiningUsage = {
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

  return { hooks, chosen, gate: decision, usage, raw: response };
}
