import type Anthropic from '@anthropic-ai/sdk';
import { jsonrepair } from 'jsonrepair';

import { anthropic } from '@/lib/anthropic';
import { cachedSystemText, cacheUsageFromMessage } from '@/lib/anthropic-cache';
import { EDITORIAL_MODEL, sonnetCostUsd } from '@/lib/social/editorial/config';
import type { EditorialPost, BeatCopy } from '@/lib/social/editorial/copy';
import type { FactSheet } from '@/lib/social/editorial/fact-sheet';
import type { SpanRun } from '@/lib/social/render/types';

/**
 * Stage 7 — editorial QA.
 *
 * From `~/.claude/skills/helios-social-editorial/SKILL.md` §7:
 *   1. Fact check — every claim traces to the fact sheet via facts pointers
 *   2. Cover check — actor named, news stated, loop open (handled at stage 2)
 *   3. Five Ws — reader can answer who/what/when/how/why-it-matters
 *   4. Swipe test — each slide has reason to swipe
 *   5. Voice — stage 6 rules pass on every string
 *   6. Reference check — fits alongside reference posts (subjective, skipped)
 *
 * Checks 1 and 4 are pure static analysis of the post + fact sheet — no LLM.
 * Checks 3 and 5 need Sonnet reasoning; combined into one call. Check 2 is
 * skipped in code because Stage 2's gate already enforced it and polish
 * doesn't touch the HOOK slide's headline text materially.
 */

// ── Static checks ──────────────────────────────────────────────────────────

const VALID_FACT_KINDS = [
  'key_facts',
  'numbers',
  'quotes',
  'players',
  'assets',
  'second_order',
] as const;

type FactKind = typeof VALID_FACT_KINDS[number];

function factSheetLength(factSheet: FactSheet, kind: FactKind): number {
  switch (kind) {
    case 'key_facts':    return factSheet.key_facts.length;
    case 'numbers':      return factSheet.numbers.length;
    case 'quotes':       return factSheet.quotes.length;
    case 'players':      return factSheet.players.length;
    case 'assets':       return factSheet.assets.length;
    case 'second_order': return factSheet.second_order.length;
  }
}

/**
 * Valid keys inside the five_ws object — matches FactSheet.five_ws shape.
 */
const VALID_FIVE_WS_KEYS = new Set([
  'who', 'what', 'when', 'where', 'why', 'why_reader_cares',
]);

/**
 * Validate a single facts pointer. Accepted forms:
 *   "chosen_hook"           — the chosen hook payload
 *   "five_ws"               — the whole five_ws object
 *   "five_ws.who"           — a specific W (any of who/what/when/where/why/why_reader_cares)
 *   "key_facts[2]"          — indexed entry in an array section
 *   "numbers[0]", "quotes[3]", "players[1]", "assets[0]", "second_order[2]"
 * Returns null when the pointer resolves; an error string otherwise.
 */
function checkFactPointer(pointer: string, factSheet: FactSheet): string | null {
  if (pointer === 'chosen_hook') return null;

  // Bare five_ws reference — points at the whole object.
  if (pointer === 'five_ws') return null;

  // Dotted five_ws.<key> reference.
  const dotMatch = pointer.match(/^five_ws\.([a-z_]+)$/i);
  if (dotMatch) {
    const key = dotMatch[1]!;
    if (!VALID_FIVE_WS_KEYS.has(key)) {
      return `unknown five_ws key "${key}"`;
    }
    return null;
  }

  const match = pointer.match(/^([a-z_]+)\[(\d+)\]$/i);
  if (!match) return `malformed pointer "${pointer}"`;
  const kind = match[1] as FactKind;
  const idx = Number(match[2]);
  if (!(VALID_FACT_KINDS as readonly string[]).includes(kind)) {
    return `unknown pointer kind "${kind}"`;
  }
  const len = factSheetLength(factSheet, kind);
  if (idx < 0 || idx >= len) {
    return `${kind}[${idx}] out of range (length ${len})`;
  }
  return null;
}

export type StaticQaResult = {
  pass: boolean;
  issues: string[];
};

export function runStaticQa(post: EditorialPost, factSheet: FactSheet): StaticQaResult {
  const issues: string[] = [];

  if (post.slides.length === 0) {
    issues.push('post has no slides');
    return { pass: false, issues };
  }

  const first = post.slides[0]!;
  const last = post.slides[post.slides.length - 1]!;
  if (first.beat !== 'HOOK') issues.push(`first slide is ${first.beat}, expected HOOK`);
  if (last.beat !== 'FOLLOW') issues.push(`last slide is ${last.beat}, expected FOLLOW`);

  // Fact pointer coverage — every slide with copy references at least one
  // pointer, and every pointer resolves.
  for (const slide of post.slides) {
    const hasCopy = Boolean(slide.headline || slide.body || slide.bodyBottom || slide.title);
    if (hasCopy && slide.beat !== 'FOLLOW' && slide.facts.length === 0) {
      issues.push(`slide ${slide.position} (${slide.beat}) has copy but no facts pointer`);
    }
    for (const p of slide.facts) {
      const err = checkFactPointer(p, factSheet);
      if (err) issues.push(`slide ${slide.position} (${slide.beat}): ${err}`);
    }
  }

  // Swipe reasons on every non-last slide.
  for (const slide of post.slides.slice(0, -1)) {
    if (!slide.swipe_reason || slide.swipe_reason.length === 0) {
      issues.push(`slide ${slide.position} (${slide.beat}) missing swipe_reason`);
    }
  }

  // altText mandatory on every slide.
  for (const slide of post.slides) {
    if (!slide.altText || slide.altText.length === 0) {
      issues.push(`slide ${slide.position} (${slide.beat}) missing altText`);
    }
  }

  // Emphasis rule: every span run has at least one narrative span.
  const checkRun = (slide: BeatCopy, field: string, run: SpanRun | null) => {
    if (!run) return;
    const hasNarrative = run.some((s) => s.role === 'narrative');
    if (!hasNarrative && run.length > 1) {
      issues.push(`slide ${slide.position} (${slide.beat}) ${field}: no narrative span (violates three-role rule)`);
    }
    const hookCount = run.filter((s) => s.role === 'hook').length;
    if (hookCount > 1) {
      issues.push(`slide ${slide.position} (${slide.beat}) ${field}: ${hookCount} hook spans (max 1 per run)`);
    }
  };
  for (const slide of post.slides) {
    checkRun(slide, 'headline', slide.headline);
    checkRun(slide, 'body', slide.body);
    checkRun(slide, 'bodyBottom', slide.bodyBottom);
    checkRun(slide, 'title', slide.title);
  }

  // Caption length: 500-900 chars per editorial skill.
  const captionLen = post.caption.length;
  if (captionLen < 500) issues.push(`caption is ${captionLen} chars, minimum 500`);
  if (captionLen > 900) issues.push(`caption is ${captionLen} chars, maximum 900`);

  // Cover palette: HOOK slide (position 0) uses white + orange ONLY.
  // NO pivot-role spans (green) — dates, names, companies stay narrative.
  const cover = post.slides.find((s) => s.beat === 'HOOK' || s.position === 0);
  if (cover) {
    for (const field of ['headline', 'body', 'title'] as const) {
      const run = cover[field];
      if (!run) continue;
      const pivotSpans = run.filter((s) => s.role === 'pivot');
      if (pivotSpans.length > 0) {
        issues.push(
          `cover slide ${cover.position} (${cover.beat}) ${field}: `
          + `${pivotSpans.length} pivot-role span(s) — covers use white + orange only, no green pivot. `
          + `Offending: "${pivotSpans.map((s) => s.text.trim()).join('", "')}"`,
        );
      }
    }
  }

  // DEBATE beat: sides array must be populated. If it's null, T2 has no
  // valid two-side content and would fall back to a single body block.
  const debate = post.slides.find((s) => s.beat === 'DEBATE');
  if (debate) {
    const sides = (debate as unknown as { sides?: unknown }).sides;
    if (!Array.isArray(sides) || sides.length < 2) {
      issues.push(
        `DEBATE slide ${debate.position} missing sides array — T2 layout needs 2 labeled sides`,
      );
    }
  }

  return { pass: issues.length === 0, issues };
}

// ── LLM check (Sonnet) ─────────────────────────────────────────────────────

const LLM_SYSTEM_PROMPT = `You are the EDITORIAL QA for a Helios Social carousel.

You receive the polished EditorialPost. Run TWO checks and return the result.

## Check A — five Ws

A cold reader who sees every slide in order must be able to answer:
  who did it, what they did, when, how, and why it matters.

Which of the five Ws does the post satisfy? Set answers ("yes" / "no")
for each. When "no", give a one-line reason: which slide should say it
but doesn't.

**"How" acceptance rule.** For policy / mandate / rule stories where the
source doesn't yet describe an implementation process (a working group
hasn't reported, the exact enforcement is TBD), a slide that clearly names
the OBLIGATION or MECHANISM the mandate imposes counts as answering "how."
Example: a slide saying "AI companies must build a kill switch — a hard
shutoff — into their frontier models" satisfies "how" for a mandate story
even when the enforcement process isn't described. Do NOT flag "how" as
missing when the mechanism-of-obligation is stated and the source doesn't
yet have process details. For non-policy stories, the standard "how does
it work" test still applies.

## Check B — voice rules

Scan **only the published fields on each slide**: headline, body, bodyBottom,
title, sides.label, sides.text — plus the top-level caption. DO NOT scan
the internal metadata fields: swipe_reason, asset_needs, facts, altText.
Those are pipeline internals that never appear on the rendered slide or
in the Instagram caption; flagging them is a false positive.

Any occurrence of the patterns below is a fail; list them with slide
position + field + the exact offending phrase.

- "Not X but Y" contrasts: "not just X, it's Y", "not merely X but Y",
  "This isn't about X, it's about Y".
- Staged run-ups: "Let's dive in", "Here's what you need to know",
  "Here's the thing", "The thing is".
- Glue-word openers: sentences starting with "Meanwhile,",
  "Additionally,", "Furthermore,", "That said,".
- Banned inflation: "pivotal", "robust" (figurative), "groundbreaking"
  (figurative), "unprecedented", "delve", "testament", "reshape",
  "landscape" (as abstract noun), "ecosystem", "at scale", "under the hood",
  "moving forward", "in the AI space".
- Deep-sounding filler: "the real question is", "at its core", "what
  really matters", "fundamentally".
- Two or more triads (three-item "X, Y, and Z" lists) in the whole post.
- Two or more "not X but Y" constructions in the whole post.
- Two pivot phrases from the same list ("But", "Now imagine",
  "Here's the kicker", "And it doesn't stop there") anywhere in the post.

## Output — STRICT JSON ONLY

**No prose. No reasoning. No analysis. No code fences. No markdown.**
Your entire response must be a single JSON object and nothing else.

{
  "five_ws": {
    "who":  { "answered": true|false, "reason": "..." },
    "what": { "answered": true|false, "reason": "..." },
    "when": { "answered": true|false, "reason": "..." },
    "how":  { "answered": true|false, "reason": "..." },
    "why_it_matters": { "answered": true|false, "reason": "..." }
  },
  "voice_issues": [
    { "position": 3, "field": "body", "pattern": "glue_opener", "text": "Meanwhile, the labs..." }
  ]
}`;

export type FiveWsCheck = {
  who: { answered: boolean; reason: string };
  what: { answered: boolean; reason: string };
  when: { answered: boolean; reason: string };
  how: { answered: boolean; reason: string };
  why_it_matters: { answered: boolean; reason: string };
};

export type VoiceIssue = {
  position: number;
  field: string;
  pattern: string;
  text: string;
};

export type LlmQaResult = {
  five_ws: FiveWsCheck;
  voice_issues: VoiceIssue[];
};

export type LlmQaUsage = {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  approxCostUsd: number;
};

// Sonnet occasionally emits an extra `}` mid-object, closing the root early
// and leaving valid sibling keys dangling — e.g. `{"five_ws":{…}}},"voice_issues":[]}`.
// Detect via brace-depth scan (respecting strings): the first char at which
// depth returns to 0 should be the LAST char. If content follows, that content
// is dangling siblings — delete the premature closer to re-parent them.
function repairEarlyRootClose(text: string): string | null {
  let depth = 0, inString = false, escape = false, firstRootClose = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0 && firstRootClose === -1) firstRootClose = i;
    }
  }
  if (firstRootClose < 0) return null;
  if (!text.slice(firstRootClose + 1).trim()) return null;
  return text.slice(0, firstRootClose) + text.slice(firstRootClose + 1);
}

function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Sonnet prose+JSON extraction — same fix as polish.ts.
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const candidate = trimmed.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(candidate);
      } catch { /* fall through */ }
      // Targeted repair: early root-close with dangling siblings.
      const rerooted = repairEarlyRootClose(candidate);
      if (rerooted) {
        try {
          return JSON.parse(rerooted);
        } catch { /* fall through */ }
      }
      // jsonrepair as broader fallback (trailing commas, single quotes, etc.).
      try {
        return JSON.parse(jsonrepair(candidate));
      } catch { /* fall through */ }
    }
    const startsLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[');
    const endsLikeJson = trimmed.endsWith('}') || trimmed.endsWith(']');
    const mode = startsLikeJson && !endsLikeJson
      ? 'truncated'
      : startsLikeJson
        ? 'malformed'
        : 'non-json';
    const head = trimmed.slice(0, 160);
    const tail = trimmed.length > 160 ? `... [${trimmed.length} chars] ...${trimmed.slice(-120)}` : '';
    // Dump the full unparseable text so we can inspect *what* actually broke —
    // 160-char head + 120-char tail hides the actual syntax error every time.
    try {
      const fs = require('fs') as typeof import('fs');
      const path = `/tmp/qa_parse_fail_${Date.now()}.txt`;
      fs.writeFileSync(path, trimmed, 'utf8');
      throw new Error(`qa: ${mode} — dumped to ${path} — ${head}${tail}`);
    } catch (dumpErr) {
      if (dumpErr instanceof Error && dumpErr.message.startsWith('qa:')) throw dumpErr;
      throw new Error(`qa: ${mode} — ${head}${tail}`);
    }
  }
}

function normalizeLlm(raw: unknown): LlmQaResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('qa: model returned non-object JSON');
  }
  const r = raw as Record<string, unknown>;

  const wsRaw = (typeof r.five_ws === 'object' && r.five_ws !== null)
    ? r.five_ws as Record<string, unknown>
    : {};
  const normW = (name: string) => {
    const x = wsRaw[name];
    if (typeof x === 'object' && x !== null) {
      const xr = x as Record<string, unknown>;
      return {
        answered: typeof xr.answered === 'boolean' ? xr.answered : false,
        reason: typeof xr.reason === 'string' ? xr.reason.trim() : '',
      };
    }
    return { answered: false, reason: 'missing from qa output' };
  };
  const five_ws: FiveWsCheck = {
    who: normW('who'),
    what: normW('what'),
    when: normW('when'),
    how: normW('how'),
    why_it_matters: normW('why_it_matters'),
  };

  const issuesRaw = Array.isArray(r.voice_issues) ? r.voice_issues : [];
  const voice_issues: VoiceIssue[] = issuesRaw
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x) => ({
      position: typeof x.position === 'number' ? Math.max(0, Math.round(x.position)) : -1,
      field: typeof x.field === 'string' ? x.field : '',
      pattern: typeof x.pattern === 'string' ? x.pattern : '',
      text: typeof x.text === 'string' ? x.text : '',
    }));

  return { five_ws, voice_issues };
}

async function runLlmQa(post: EditorialPost): Promise<{ result: LlmQaResult; usage: LlmQaUsage; raw: Anthropic.Message }> {
  const userText = `EditorialPost (JSON):\n${JSON.stringify(post, null, 2)}`;

  const response = await anthropic.messages.create({
    model: EDITORIAL_MODEL,
    // Longer posts (12-13 slides, richer voice-issue explanations) can
    // push QA output past 2000 tokens — the truncation hits mid-JSON and
    // parseJson throws. 4000 gives comfortable headroom.
    max_tokens: 4000,
    system: cachedSystemText(LLM_SYSTEM_PROMPT, '1h'),
    messages: [{ role: 'user', content: userText }],
  });

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === 'text',
  );
  if (!textBlock) throw new Error('qa: model returned no text block');

  const result = normalizeLlm(parseJson(textBlock.text));
  const cache = cacheUsageFromMessage(response);
  const outputTokens = Math.max(0, Number(response.usage.output_tokens ?? 0));
  const usage: LlmQaUsage = {
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

  return { result, usage, raw: response };
}

// ── Combined orchestrator ──────────────────────────────────────────────────

export type QaResult = {
  pass: boolean;
  static_issues: string[];
  llm: LlmQaResult;
  usage: LlmQaUsage;
};

export async function runEditorialQa(
  post: EditorialPost,
  factSheet: FactSheet,
): Promise<QaResult> {
  const staticResult = runStaticQa(post, factSheet);
  const llmResult = await runLlmQa(post);

  const allWsAnswered = Object.values(llmResult.result.five_ws).every((w) => w.answered);
  const noVoiceIssues = llmResult.result.voice_issues.length === 0;
  const pass = staticResult.pass && allWsAnswered && noVoiceIssues;

  return {
    pass,
    static_issues: staticResult.issues,
    llm: llmResult.result,
    usage: llmResult.usage,
  };
}
