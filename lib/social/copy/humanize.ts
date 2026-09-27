import Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText } from '@/lib/anthropic-cache';
import type { Post, Span, SpanRun } from '@/lib/social/render/types';

/**
 * Humanizer for Helios Social copy.
 *
 * Runs the distilled humanizer rules (from ~/.claude/skills/humanizer/SKILL.md)
 * against a slide string field via Haiku 4.5. Uses prompt caching so the rules
 * prefix is written once (1h TTL) and read on every subsequent call — a full
 * carousel is ~cache-write once + N cache-read calls, one per field.
 *
 * The rules prefix is the STABLE cache prefix. Only the input string varies
 * per request. Model: haiku (cheapest for a rewrite task at this scale).
 *
 * When Phase 3b compose lands, this same helper is the post-compose pass. The
 * banned-word list is also baked into the compose prompt so Haiku avoids
 * generating them from the start.
 */

const MODEL_ID = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 400;

/**
 * Distilled humanizer rules — kept tight because the target inputs are short
 * (headline ≤ 40 chars, body ≤ 110 chars, caption ≤ 600 chars). The full
 * skill is for long-form prose; slide copy needs the top 8 tells + Helios's
 * social-specific banned words.
 */
const HUMANIZER_SYSTEM = `You rewrite Helios Marketing's Instagram carousel copy so it stops sounding AI-generated.

Helios is a marketing agency writing news carousels about AI industry stories, at a Madison-Avenue-meets-AI voice. Instagram punishes AI cadence harder than any other surface — the scroll is fast, and readers skim past the tells below.

Rules — remove these on sight:

1. **Not X but Y contrasts.** No "not just X, it's Y", "not merely X but Y", "This isn't about X, it's about Y", "not [noun], but [Y]" (compact form — e.g. "not negligence, but the cost of scale"), "not [verb-ing], but [Y-ing]", and the COMPOUND form "not X, not Y, but Z" (e.g. "not a ban, not a pause, but a framework"). Any construction where a negation — single, compact, or compound — is set against a positive claim as a rhetorical pivot is banned. State the claim directly, without setting up a foil.
2. **One-line closers that restate.** No "That's the real question." "Read that again." "The trust test." (as a bolt-on tag line that just restates the paragraph). A closer is fine only when it adds a new specific claim.
3. **Sayings that sound deep.** No "the real question is", "at its core", "what really matters", "fundamentally", "the deeper issue", "X is the Y of Z", "X becomes a trap", "the language of Y", "the currency of Y", "the architecture of Y".
4. **Staged run-ups.** No "Let's dive in", "Here's what you need to know", "Now let's look at", "Honestly?", "Look,", "Here's the thing", "The thing is", "Real talk". Get to the point.
5. **Forced triads.** Three parallel items only when the meaning genuinely has three parts. If two items say the same thing, merge them or cut one.
6. **Dashes as universal connector.** Replace em/en dashes with periods, commas, colons, or parentheses. Leave dashes inside code, URLs, and dates.
7. **Inflation.** No "stands as a testament", "pivotal moment", "plays a key role", "marks a shift", "underscores its importance", "in an evolving landscape", "in the AI space", "in the AI ecosystem", "unpacking", "deep-dive", "game-changer", "paradigm", "revolutionary", "seismic", "watershed", "at scale", "under the hood", "moving forward", "unprecedented", "reshape".
8. **Sales language.** No "vibrant", "rich", "profound", "groundbreaking" (figurative), "renowned", "featuring", "diverse array", "boasts", "features" (as verb replacing "has"), "must-visit".
9. **Glue words.** No sentence starting with "Meanwhile,", "Additionally,", "Furthermore,", "That said,", "So,", "Now,", "Then,". These are AI's connective tissue — real writing moves between ideas without announcing the move. Cut the glue word; the sentence usually stands on its own.

Also cut these overused AI words on sight: **actually · additionally · align with · at scale · bolstered · compliance cost · crucial · delve · emphasizing · enduring · enhance · epicenter · fostering · furthermore · garner · gate/gated/gating · highlight (verb) · interplay · intricate · key (adjective) · landscape (abstract noun) · meanwhile · meticulous · pivotal · quietly · reshape · robust (figurative) · self-reinforcing · self reinforcing · showcase · tapestry (abstract noun) · testament · underscore (verb) · unprecedented · valuable · vibrant · ecosystem · space (as in "AI space") · essentially · ultimately · in a significant development · it's worth noting · that said · with that said · moving forward · cuts to the core · at the heart of · at the center of**.

What NOT to change:
- Named entities (companies, people, product names, dates, dollar amounts) — never invent or modify.
- Specific claims — every fact in the input stays in the output.
- The core voice — Madison-Avenue marketing intelligence. Direct, confident, dry. Not chatty, not clickbait, not academic.
- ALL-CAPS words that are already ALL-CAPS in the input (they're for the headline typesetter — leave the string casing alone).
- No exclamation marks, no emoji anywhere.

How to respond:
- Return ONLY the rewritten string. No preamble, no explanation, no quotes around it, no markdown.
- If the input has no AI tells and reads clean, return it unchanged.
- Never add a fact, name, date, or number that wasn't in the input.
- Respect character limits: headlines ≤ 40 chars, body sentences ≤ 110 chars, landing lines ≤ 20 chars, attributions ≤ 60 chars.
- If the input is a single word or two-word fragment (a hook phrase from a headline), return it unchanged unless it's a banned word — those get replaced with a synonym.`;

let cachedClient: Anthropic | null = null;

function client(): Anthropic {
  if (cachedClient) return cachedClient;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not configured');
  cachedClient = new Anthropic({ apiKey: key, maxRetries: 1 });
  return cachedClient;
}

export type HumanizeUsage = {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
};

/**
 * Rewrite one short string in Helios voice. Returns the string unchanged if
 * the input is empty or clearly a single word / plain number.
 */
export async function humanizeString(input: string): Promise<{ text: string; usage: HumanizeUsage }> {
  const trimmed = input.trim();
  const zeroUsage = { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
  if (trimmed.length < 3) {
    return { text: input, usage: zeroUsage };
  }
  // Skip humanization on landing lines. Short + no lowercase + terminal
  // period = design-skill "landing line" register. Haiku sometimes
  // interprets a bare landing line as insufficient context and responds
  // with meta-commentary; skipping avoids that entirely.
  const isLandingLine =
    trimmed.length <= 80
    && !/[a-z]/.test(trimmed)
    && /[.!?]$/.test(trimmed);
  if (isLandingLine) {
    return { text: input, usage: zeroUsage };
  }

  const message = await client().messages.create({
    model: MODEL_ID,
    max_tokens: MAX_TOKENS,
    system: cachedSystemText(HUMANIZER_SYSTEM, '1h'),
    // Wrap the input in a marker envelope so Haiku sees it clearly as
    // "text to rewrite" instead of guessing whether it's a chat prompt.
    messages: [{
      role: 'user',
      content:
        'Rewrite the following text. Return ONLY the rewritten text, no other output:\n\n---\n'
        + trimmed
        + '\n---',
    }],
  });

  const rawText = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
  // Strip the marker envelope if Haiku echoed it back.
  const stripped = rawText
    .replace(/^---\s*/, '')
    .replace(/\s*---$/, '')
    .replace(/^Rewrite the following text[^:]*:\s*/i, '')
    .trim();
  const text = stripped || rawText;

  // Output validator — if Haiku responded with chat/meta-commentary
  // instead of rewriting, discard and return original. Prevents leaked
  // prompt patterns from getting persisted into copy_json.
  if (isHumanizerLeak(text)) {
    return { text: input, usage: {
      inputTokens: message.usage.input_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
      outputTokens: message.usage.output_tokens,
    } };
  }

  return {
    text: text || input,
    usage: {
      inputTokens: message.usage.input_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
      outputTokens: message.usage.output_tokens,
    },
  };
}

/**
 * Detect chat-response / prompt-leak patterns in humanizer output. Uses
 * apostrophe class `['‘’]` to catch both straight and curly
 * apostrophes. Same patterns as copy.ts prompt-leak guard, adjusted for
 * scan-anywhere-in-string (not just anchor at start) since humanized text
 * may prepend acknowledgement before the leak.
 */
const HUMANIZER_LEAK_PATTERNS: RegExp[] = [
  /I['‘’]m\s+(ready|going|looking|not|going)\b/i,
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
function isHumanizerLeak(text: string): boolean {
  return HUMANIZER_LEAK_PATTERNS.some((pat) => pat.test(text));
}

/**
 * Rewrite one span run. Approach: humanize the concatenated sentence, then
 * re-mark hooks and pivots by verbatim-locating the ORIGINAL span text in the
 * rewritten sentence. Everything not matched falls back to narrative.
 *
 * Why this beats boundary-slicing: Haiku legitimately restructures sentences,
 * so word boundaries move. But hook/pivot phrases are semantically specific
 * ("clearly labeled", "September 16,") and the humanizer prompt tells Haiku
 * to preserve named entities and specific claims — so those phrases almost
 * always survive verbatim. Narrative connectors around them can move freely.
 */
async function humanizeSpanRun(run: SpanRun): Promise<SpanRun> {
  const concatenated = run.map((span) => span.text).join('');
  const { text: rewritten } = await humanizeString(concatenated);
  return remarkSpans(run, rewritten);
}

/**
 * Given the original span run and Haiku's rewritten sentence, produce a new
 * span run that preserves the original hook/pivot roles by verbatim locating
 * each emphasis span's text inside the rewrite. Exported for offline testing.
 *
 * Pure function — no API calls, no I/O. Deterministic given inputs.
 */
export function remarkSpans(run: SpanRun, rewritten: string): SpanRun {
  const concatenated = run.map((span) => span.text).join('');
  if (rewritten === concatenated) return run;

  const emphasis = run
    .filter((span) => span.role !== 'narrative')
    .map((span) => ({ text: span.text.trim(), role: span.role }))
    .filter((span) => span.text.length > 0);

  const hits: { start: number; end: number; role: Span['role'] }[] = [];
  for (const em of emphasis) {
    const idx = rewritten.indexOf(em.text);
    if (idx === -1) continue;
    if (hits.some((h) => Math.max(h.start, idx) < Math.min(h.end, idx + em.text.length))) continue;
    hits.push({ start: idx, end: idx + em.text.length, role: em.role });
  }
  hits.sort((a, b) => a.start - b.start);

  const result: SpanRun = [];
  let cursor = 0;
  for (const hit of hits) {
    if (hit.start > cursor) {
      result.push({ text: rewritten.slice(cursor, hit.start), role: 'narrative' });
    }
    result.push({ text: rewritten.slice(hit.start, hit.end), role: hit.role });
    cursor = hit.end;
  }
  if (cursor < rewritten.length) {
    result.push({ text: rewritten.slice(cursor), role: 'narrative' });
  }
  return result.length > 0 ? result : [{ text: rewritten, role: 'narrative' }];
}

export type HumanizedPost = {
  post: Post;
  usage: HumanizeUsage;
};

/**
 * Humanize every string field on a Post. Fires one call per span-run and one
 * per plain string; cache-read after the first call means Nth call is ~free.
 */
export async function humanizePost(post: Post): Promise<HumanizedPost> {
  const totals: HumanizeUsage = {
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
  };

  const slides = await Promise.all(post.slides.map(async (slide) => {
    const [headline, body, bodyBottom, title] = await Promise.all([
      slide.headline ? humanizeSpanRun(slide.headline) : undefined,
      slide.body ? humanizeSpanRun(slide.body) : undefined,
      slide.bodyBottom ? humanizeSpanRun(slide.bodyBottom) : undefined,
      slide.title ? humanizeSpanRun(slide.title) : undefined,
    ]);
    return {
      ...slide,
      headline,
      body,
      bodyBottom,
      title,
    };
  }));

  const captionResult = await humanizeString(post.caption);
  totals.inputTokens += captionResult.usage.inputTokens;
  totals.cacheReadTokens += captionResult.usage.cacheReadTokens;
  totals.cacheWriteTokens += captionResult.usage.cacheWriteTokens;
  totals.outputTokens += captionResult.usage.outputTokens;

  return {
    post: { ...post, slides, caption: captionResult.text },
    usage: totals,
  };
}

// Type-only re-export so consumers don't need to import from the SDK.
export type { Span };
