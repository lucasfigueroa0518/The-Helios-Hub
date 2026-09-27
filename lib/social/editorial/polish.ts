import type Anthropic from '@anthropic-ai/sdk';

import { anthropic } from '@/lib/anthropic';
import { cachedSystemText, cacheUsageFromMessage } from '@/lib/anthropic-cache';
import { EDITORIAL_MODEL, sonnetCostUsd } from '@/lib/social/editorial/config';
import type { EditorialPost, BeatCopy } from '@/lib/social/editorial/copy';
import type { SpanRun } from '@/lib/social/render/types';

/**
 * Stage 6b — polish (post-level).
 *
 * The per-string humanizer (`lib/social/copy/humanize.ts`) rewrites one field
 * at a time and cannot see other slides. Editorial skill §6 also enforces
 * cross-slide rules that need the whole post in view:
 *
 * - At most one pivot phrase ("But", "Now imagine", "Here's the kicker",
 *   "And it doesn't stop there") per three slides, never twice in one post.
 * - At most one "it's not X, it's Y" construction per post.
 * - No two body slides open with the same syntactic shape (cadence rotation).
 * - At most one triad (three-item list) per post.
 * - Sentence-length mix — three short sentences in a row is too many.
 *
 * This module runs ONE Sonnet call over the full EditorialPost. It edits
 * only the fields that violate cross-slide rules and leaves everything else
 * alone. Returns the polished post plus a diff-style change list.
 */

const SYSTEM_PROMPT = `You POLISH a Helios Social carousel at the post level.

You receive the ENTIRE EditorialPost as JSON. Each slide has beat, headline,
body, bodyBottom, title span runs, an altText, and metadata (position,
swipe_reason, asset_needs, facts).

Your job is to enforce cross-slide rules that a per-string editor can't see.
Edit ONLY the fields that violate the rules below. Leave everything else
exactly as-is.

## Cross-slide rules

1. **Pivot phrase budget.** "But", "Now imagine", "Here's the kicker", "And
   it doesn't stop there" are allowed on cover + TURN beats only. At most
   one pivot phrase per three slides. Never the same pivot phrase twice in
   one post. If you find a violation, remove the pivot phrase from all but
   the strongest occurrence.
2. **"Not X, it's Y" budget.** At most one such construction per post. If
   you find two, rewrite the weaker one as a direct claim.
3. **Cadence rotation.** No two body slides (positions 1..N-4, excluding
   THESIS/DEBATE/FOLLOW) may open with the same syntactic shape. Common
   repeat patterns: "Every X…", "For X years…", "The [noun] is now…", "This
   is what…", "But X…". If two body slides open with the same shape, rewrite
   the second so its opener differs.
4. **Triad cap.** At most one three-item list ("X, Y, and Z") per post.
   If you find two, break one into short sentences using period-as-rhythm:
   "The Institute has a director. It has a budget. It has a public charter."
5. **Sentence-length mix.** Three short sentences in a row is too many unless
   it's the triad-split above. Combine two of the three when the material
   allows.
6. **Attitude discipline.** "That's a red flag" style lines are only earned
   AFTER the evidence lands. If a body slide asserts attitude before its
   evidence beat, either move the attitude line to a later slide or remove.
7. **Prompt-leak nulling (CRITICAL).** Scan every span run for chat-response
   or meta-commentary text. Tells include: "I'm ready to rewrite", "Please
   paste the carousel", "the actual Instagram carousel", "I'll clean it",
   "I understand. You've given me the system prompt", "keep all the facts",
   "remove AI tells", "the carousel copy you want rewritten", or any text
   that reads as if a chat assistant is describing what it's about to do
   rather than presenting editorial copy. If ANY span run field contains
   this pattern, set that field to null in the output. Do NOT try to
   rewrite it into editorial copy — nulling is safer. Add a change entry
   noting "prompt_leak_nulled".
8. **Triad enforcement (HARDENED — explicit process).**
   Step 1: Enumerate every three-item list ("X, Y, and Z" form OR the
   compound form where three parallel subjects each get their own short
   clause: "Anthropic disclosed X. SoftBank mobilized Y. Crusoe closed Z."
   is also a triad.) across ALL body / bodyBottom fields.
   Step 2: If your count is ≤ 1, done — do not modify.
   Step 3: If your count is ≥ 2, KEEP the first triad (usually GROUND
   where the three data points ARE the news). REWRITE every subsequent
   triad into either:
     a) One dense sentence that names the pattern without listing each
        item ("All three moves fit the same self-improvement thesis"), OR
     b) Three separate short sentences using period-as-rhythm.
   This is NOT optional. A post shipping with two triads is a rule
   violation. Add a change entry per rewritten triad.
9. **"Here's what X" cover ban.** If the HOOK slide's headline contains
   any variant of "Here's what X means", "Here's what happens next",
   "Here's how", "Here's why", or "Here's the story", REWRITE it to state
   the news directly. The cover names the actor + the news + the tension.
   It does not promise to explain later. Add a change entry with rule
   "hook_staged_runup".

## Preserve

- Every factual claim, number, name, date, quote — unchanged. Never invent
  or modify a fact.
- Every span's role assignment when the text underneath doesn't change.
- Beat, position, altText (unless the copy changed enough that altText is
  now wrong — then update altText to match).
- swipe_reason, asset_needs, facts — do not touch these.
- Character casing on ALL-CAPS phrases in headlines/titles (they're
  design signals for the typesetter).
- Every field that has no rule violation — return it byte-for-byte.

## Output — STRICT JSON ONLY

**No prose. No reasoning. No analysis. No code fences. No markdown.**
Your entire response must be a single JSON object and nothing else. If
you narrate your work or reasoning outside the JSON, the response fails
and gets discarded. Emit the JSON directly.

Return the FULL EditorialPost with the same shape you received. Set null on
fields that were null in the input. Emit a "changes" array at the top level
alongside "slides" and "caption" — one entry per slide+field you edited.

{
  "slides": [ { "position": 0, "beat": "HOOK", "headline": [...], ... }, ... ],
  "caption": "...",
  "changes": [
    { "position": 3, "field": "body", "rule": "cadence_rotation", "note": "Opened same shape as position 2; rewrote first clause." }
  ]
}

If no rule was violated: return the post unchanged and set "changes" to [].`;

export type PolishChange = {
  position: number;
  field: 'headline' | 'body' | 'bodyBottom' | 'title' | 'caption';
  rule: string;
  note: string;
};

export type PolishUsage = {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  approxCostUsd: number;
};

export type PolishResult = {
  post: EditorialPost;
  changes: PolishChange[];
  usage: PolishUsage;
  raw: Anthropic.Message;
};

function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  // Try direct parse first — the happy path.
  try {
    return JSON.parse(trimmed);
  } catch {
    // Sonnet sometimes narrates its analysis before emitting JSON. Extract
    // the outermost { ... } block by finding the first '{' and last '}',
    // then parse that substring. Handles prose preamble + JSON payload.
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const candidate = trimmed.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(candidate);
      } catch { /* fall through to error */ }
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
    throw new Error(`polish: ${mode} — ${head}${tail}`);
  }
}

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

function normalize(raw: unknown, original: EditorialPost): { post: EditorialPost; changes: PolishChange[] } {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('polish: model returned non-object JSON');
  }
  const r = raw as Record<string, unknown>;
  const originalByPos = new Map<number, BeatCopy>();
  for (const s of original.slides) originalByPos.set(s.position, s);

  const slidesRaw = Array.isArray(r.slides) ? r.slides : [];
  const slides: BeatCopy[] = slidesRaw
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x, idx) => {
      const position = typeof x.position === 'number' ? Math.max(0, Math.round(x.position)) : idx;
      const original = originalByPos.get(position);
      if (!original) throw new Error(`polish: slide position ${position} not in original post`);
      return {
        position,
        beat: original.beat,
        headline: normalizeSpanRun(x.headline),
        body: normalizeSpanRun(x.body),
        bodyBottom: normalizeSpanRun(x.bodyBottom),
        title: normalizeSpanRun(x.title),
        // Preserve sides array — polish never touches DEBATE sides.
        sides: original.sides,
        altText: typeof x.altText === 'string' ? x.altText.trim() : original.altText,
        // Preserve the plan-carried fields the polisher cannot touch.
        swipe_reason: original.swipe_reason,
        asset_needs: original.asset_needs,
        facts: original.facts,
      };
    })
    .sort((a, b) => a.position - b.position);

  if (slides.length !== original.slides.length) {
    throw new Error(`polish: model returned ${slides.length} slides, original had ${original.slides.length}`);
  }

  const caption = typeof r.caption === 'string' ? r.caption.trim() : original.caption;

  const validFields = new Set(['headline', 'body', 'bodyBottom', 'title', 'caption']);
  const changesRaw = Array.isArray(r.changes) ? r.changes : [];
  const changes: PolishChange[] = changesRaw
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x) => ({
      position: typeof x.position === 'number' ? Math.max(0, Math.round(x.position)) : -1,
      field: typeof x.field === 'string' && validFields.has(x.field)
        ? x.field as PolishChange['field']
        : 'body',
      rule: typeof x.rule === 'string' ? x.rule : '',
      note: typeof x.note === 'string' ? x.note : '',
    }));

  // Post-polish safety pass — null any span run that STILL contains
  // prompt-leak content even after polish. This is the final gate before
  // persisting; catches cases where polish either missed the leak or
  // rewrote it into something that still trips the patterns.
  const finalSlides = slides.map((slide) => {
    const nullIfLeak = (run: SpanRun | null): SpanRun | null => {
      if (!run) return null;
      const text = run.map((s) => s.text).join(' ');
      if (containsPromptLeak(text)) {
        changes.push({
          position: slide.position,
          field: 'body',
          rule: 'prompt_leak_nulled',
          note: `Post-polish safety pass caught residual prompt-leak text.`,
        });
        return null;
      }
      return run;
    };
    return {
      ...slide,
      headline: nullIfLeak(slide.headline),
      body: nullIfLeak(slide.body),
      bodyBottom: nullIfLeak(slide.bodyBottom),
      title: nullIfLeak(slide.title),
    };
  });

  return { post: { slides: finalSlides, caption }, changes };
}

/**
 * Prompt-leak scan for polish output. Same intent as the copy-stage guard
 * but scans anywhere in the text (not just the start) since polish text
 * may contain the leak mid-run. Apostrophe class `['‘’]` accepts straight
 * + curly quotes.
 */
const POLISH_LEAK_PATTERNS: RegExp[] = [
  /I['‘’]m\s+(ready|going|looking|not)\b/i,
  /I\s+(understand|see|need|will|can)\s+.{0,40}\s+(system\s+prompt|rewrit|carousel|Instagram|Helios)/i,
  /I['‘’]ll\s+(rewrite|clean|remove|edit|polish)/i,
  /Paste\s+the\s+(carousel|copy|text)/i,
  /Please\s+(share|provide|paste|give)\s+the\s+(actual|real|full|carousel|text|copy)/i,
  /the\s+actual\s+(Instagram|carousel)/i,
  /the\s+carousel\s+copy\s+you\s+want/i,
  /remove\s+.{0,20}AI\s+tells?/i,
  /keep\s+all\s+the\s+facts/i,
  /system\s+prompt\s+rules/i,
  /You['‘’]ve\s+given\s+me/i,
];
function containsPromptLeak(text: string): boolean {
  return POLISH_LEAK_PATTERNS.some((pat) => pat.test(text));
}

export async function polishPost(post: EditorialPost): Promise<PolishResult> {
  const userText = `EditorialPost (JSON):\n${JSON.stringify(post, null, 2)}`;

  const response = await anthropic.messages.create({
    model: EDITORIAL_MODEL,
    // Full post payload in + full post out. 8000 gives comfortable headroom.
    max_tokens: 8000,
    system: cachedSystemText(SYSTEM_PROMPT, '1h'),
    messages: [{ role: 'user', content: userText }],
  });

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === 'text',
  );
  if (!textBlock) throw new Error('polish: model returned no text block');

  const { post: polished, changes } = normalize(parseJson(textBlock.text), post);
  const cache = cacheUsageFromMessage(response);
  const outputTokens = Math.max(0, Number(response.usage.output_tokens ?? 0));
  const usage: PolishUsage = {
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

  return { post: polished, changes, usage, raw: response };
}
