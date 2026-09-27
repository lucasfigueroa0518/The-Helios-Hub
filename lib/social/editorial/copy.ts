import type Anthropic from '@anthropic-ai/sdk';
import { jsonrepair } from 'jsonrepair';

import { anthropic } from '@/lib/anthropic';
import { cachedSystemText, cacheUsageFromMessage } from '@/lib/anthropic-cache';
import { EDITORIAL_MODEL, sonnetCostUsd } from '@/lib/social/editorial/config';
import type { ChosenHook } from '@/lib/social/editorial/hook-mine';
import type { FactSheet } from '@/lib/social/editorial/fact-sheet';
import type { StrategyPlan } from '@/lib/social/editorial/strategy';
import type { StoryPlan, Beat } from '@/lib/social/editorial/story-plan';
import type { SpanRun } from '@/lib/social/render/types';

/**
 * Stage 5 — copy per beat.
 *
 * From `~/.claude/skills/helios-social-editorial/SKILL.md` §5: write copy for
 * each beat, following the plan. Character limits per field belong to the
 * layout the design skill picks, so write to the beat's job first and trim
 * to the layout's limits second.
 *
 * This module is SEMANTIC ONLY. It does NOT pick layouts, photos, or the
 * concrete `layoutVariant`. It emits an `EditorialPost` — the story with
 * words and emphasis, but no visual composition yet. Phase 4's layout
 * picker turns this into a full render `Post`.
 */

const SYSTEM_PROMPT = `You write the COPY for a Helios Social carousel.

You receive:
- FACT SHEET (JSON) — verified facts with source_sentence pointers
- CHOSEN HOOK (JSON) — the winning cover hook (already scored 18+/25)
- STRATEGY (JSON) — value type, arousal/curiosity/knowledge scores,
  primary/secondary, bucket
- STORY PLAN (JSON) — 8-11 slides with beat + purpose + facts + swipe_reason

Your job is to write the WORDS that live on each slide, plus the caption.

## Non-negotiables

- One idea per slide. Copy that tries to say two things at once gets split
  by the plan; you don't merge them back.
- Body copy carries at least one specific fact per slide — a number, a
  date, a named person, a concrete example. A beat that reads as a
  headline label is too thin.
- Every claim traces to the fact sheet through the slide's \`facts\` pointers.
  You do not invent numbers, quotes, or events.
- Copy is short sentences. Avoid compound sentences. Prefer two short
  sentences over one long one.

## Registers by beat

- HOOK  cover headline — matches CHOSEN HOOK exactly. Do not paraphrase.
- GROUND, CONTEXT, STAKES, TWIST — sentence-case body copy.
- SCALE, MECHANISM — small header + Roboto body. The number can be its own
  giant orange line if the design skill picks that layout.
- TURN — a landing-line register: 5-9 words, punchy, uppercase-worthy.
- PROOF — commentary under a real artifact. Sentence case.
- SCENARIO — "Now imagine..." concrete picture, 2-3 short sentences.
- ANALOGY — one clear comparison from everyday life.
- QUOTE — the quote is verbatim from fact_sheet.quotes. You add the
  attribution line.
- THESIS — landing sentence. Editor's voice, no to-do list. 12-20 words.
- DEBATE — a question with two real sides. 8-14 words.
- FOLLOW — story-specific line, NOT "follow for more." 8-12 words.

## Emphasis spans — the three-role color system

Every SpanRun is an array of { text, role }. Roles paint colors when rendered:

- narrative: default. Rendered white on dark, near-black on Helios White.
- hook: the beat's punch phrase. ONE per sentence, never absent, never doubled.
  Numbers, names of the surprise, the payoff phrase.
- pivot: metadata. Dates, named people, company names, and allowed turn
  phrases: "But", "Now imagine", "Here's the kicker", "And it doesn't stop there".

Rules:
- One color per phrase, never per word inside a phrase.
- Never highlight the whole sentence.
- A slide can have zero pivots. Never zero narrative.
- On big landing lines (single-line hero payoff), the whole line may be a hook.

## Voice — humanizer applies at the field level in Stage 6

Do not go out of your way to sound smart or academic. Direct, dry,
Madison-Avenue-marketing intelligence. If a line reads as PR-autopilot
or as an AI tell, rewrite it. Avoid: pivotal, robust, groundbreaking,
unprecedented, delve, testament, reshape, landscape, ecosystem, at scale,
Meanwhile, Additionally, Furthermore, That said, "not X but Y".

## Caption — 500-900 chars (STRICT — the 500 floor is enforced)

Must be at least 500 characters. If your first draft is under 500, add:
- specific reporting context the slides skipped (a related event, a
  historical parallel, a nearby data point)
- the source outlet's name and the date if not already mentioned
- the DEBATE beat's question, phrased for comments
- one caveat about the source's strength (thin/solid/rich) if relevant

News peg + source + one paragraph of context the slides skipped + debate
prompt. No emoji, no exclamation marks. The caption is where the reporting
lives; the slides tell the story. Never cut short at 300-400 chars just
because you feel you've said enough — the 500-char floor is a hard rule.

## Output — STRICT JSON ONLY

**No prose. No reasoning. No analysis. No code fences. No markdown.**
**Never emit meta-commentary about the task itself.** Never write things
like "I'll rewrite it", "Here is the copy", "I'm ready to write", or any
sentence that describes what you're about to do. Emit ONLY the JSON object
below. If you catch yourself typing a response like a chat assistant would,
stop and emit the JSON instead.

Your entire response is a single JSON object with this shape:

{
  "slides": [
    {
      "position": 0,
      "beat": "HOOK",
      "headline": [{ "text": "...", "role": "narrative" | "hook" | "pivot" }, ...],
      "body":     [{ "text": "...", "role": "..." }, ...] | null,
      "bodyBottom": [ ... ] | null,
      "title":    [ ... ] | null,
      "sides":    [{ "label": "...", "text": "..." }, ...] | null,
      "altText":  "screen-reader description of the slide",
      "swipe_reason": "carried over from the plan (short)",
      "asset_needs":  ["carried over from the plan"],
      "facts":        ["carried over from the plan"]
    },
    ...
  ],
  "caption": "the full 500-900 char caption text"
}

Field guidance by beat (which fields to fill):
- HOOK: headline (the chosen hook), body optional (subhead/kicker), altText mandatory.
  Cover uses white + orange ONLY. NO pivot-role spans on the HOOK slide's headline —
  dates, names, and companies stay narrative-role on the cover.
  DO NOT use staged-runup openers on HOOK: no "Here's what X means", "Here's the story",
  "Here's how", "Here's what happens next", "Here's why". State the news directly.
  A hook opens a loop by naming the actor + the news + the tension — it does not
  promise to explain further.
- GROUND, CONTEXT, STAKES, TWIST, SCENARIO: body (primary), bodyBottom optional, altText
- SCALE, MECHANISM: title (the big element like "$2B"), headline (label like "MORE COMPUTE."), body (context sentence)
- TURN: fill headline ONLY. Uppercase-worthy landing line, 3-9 words, ≤ 60 chars.
  Do NOT fill body, bodyBottom, or title on TURN slides — the headline IS the entire
  slide. A body or bodyBottom on a TURN slide will be discarded downstream. If the
  turn needs more explanation, that belongs on the NEXT slide, not here.
- PROOF: headline (short label ≤ 8 words, e.g. "The receipt.", "On the record."),
  body (the commentary under the artifact, 2-3 short sentences).
  NEVER write meta-language like "I'll rewrite" or "Paste the carousel" — those aren't copy.
- QUOTE: body (the verbatim quote, sentence case), headline (the attribution string)
- ANALOGY: body (the comparison), altText
- THESIS: body (the landing sentence)
- DEBATE: headline (the question, ends in "?"),
  sides (a 2-element array — one for each side of the debate).
  Each side is { "label": "SHORT UPPERCASE LABEL", "text": "one-sentence position, 60-140 chars" }.
  Labels can be "FOR" / "AGAINST", or story-specific like "COPING?" / "RIGHT?".
  DO NOT pack both sides into body — use the sides array.
- FOLLOW: body (the story-specific line, 8-12 words)

For SlideCopy fields that aren't relevant to the beat, emit null (not an
empty array, not an empty string). altText is mandatory on every slide.`;

export type BeatCopy = {
  position: number;
  beat: Beat;
  headline: SpanRun | null;
  body: SpanRun | null;
  bodyBottom: SpanRun | null;
  title: SpanRun | null;
  /** Populated for DEBATE beats — two labeled sides that T2 renders. */
  sides: Array<{ label: string; text: string }> | null;
  altText: string;
  swipe_reason: string;
  asset_needs: string[];
  facts: string[];
};

export type EditorialPost = {
  slides: BeatCopy[];
  caption: string;
};

export type CopyUsage = {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  approxCostUsd: number;
};

export type CopyResult = {
  post: EditorialPost;
  usage: CopyUsage;
  raw: Anthropic.Message;
};

// Same structural-recovery ladder as qa.ts. Sonnet occasionally emits an
// extra `}` closing the root early, leaving valid sibling keys (`caption`,
// `slides`) dangling. Fix: brace-depth scan (string-aware), detect early
// root close, delete the premature closer, retry parse.
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
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const candidate = trimmed.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(candidate);
      } catch { /* fall through */ }
      const rerooted = repairEarlyRootClose(candidate);
      if (rerooted) {
        try {
          return JSON.parse(rerooted);
        } catch { /* fall through */ }
      }
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
    throw new Error(`copy: ${mode} — ${head}${tail}`);
  }
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];
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

/**
 * Layer 1 auto-fix: strip hedge adverbs and filler phrases that add nothing.
 * Deterministic — runs on every span after copy stage completes. If Sonnet
 * writes "The fight is really about who writes the rules", this rewrites to
 * "The fight is about who writes the rules" without an API call.
 */
const HEDGE_STRIPS: Array<{ pattern: RegExp; replacement: string }> = [
  // Adverbs used as hedges — strip when followed by common verbs/prepositions.
  { pattern: /\breally\s+(?=(about|is|are|was|were|means|matter|matters|becomes|comes|goes))/gi, replacement: '' },
  { pattern: /\bgenuinely\s+(?=(about|is|are|means))/gi, replacement: '' },
  { pattern: /\btruly\s+(?=(about|is|are|means|matters))/gi, replacement: '' },
  { pattern: /\bessentially\s+/gi, replacement: '' },
  { pattern: /\bactually\s+(?=(is|are|was|were|means))/gi, replacement: '' },
  // Prepositional filler.
  { pattern: /\s*\bat\s+its\s+core\b\s*/gi, replacement: ' ' },
  { pattern: /\s*\bat\s+the\s+heart\s+of\b\s*/gi, replacement: ' ' },
  { pattern: /\s*\bat\s+the\s+center\s+of\b\s*/gi, replacement: ' ' },
  { pattern: /\s*\bcuts?\s+to\s+the\s+core\b\s*/gi, replacement: ' ' },
];

function stripHedges(text: string): string {
  let out = text;
  for (const { pattern, replacement } of HEDGE_STRIPS) {
    out = out.replace(pattern, replacement);
  }
  // Collapse runs of whitespace introduced by the strips.
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
}

function stripHedgesFromRun(run: SpanRun | null): SpanRun | null {
  if (!run) return null;
  const cleaned = run
    .map((s) => ({ ...s, text: stripHedges(s.text) }))
    .filter((s) => s.text.length > 0);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Layer 1 auto-fix: inject date into GROUND body if missing.
 * When fact_sheet.five_ws.when contains a specific date and no GROUND slide
 * body span contains a year or month name, prepend the date to the body.
 */
const DATE_DETECTION = /\b(19|20)\d{2}\b|\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan\.?|Feb\.?|Mar\.?|Apr\.?|Jun\.?|Jul\.?|Aug\.?|Sept\.?|Sep\.?|Oct\.?|Nov\.?|Dec\.?)\b/i;
const DATE_EXTRACTION = /(?:on\s+)?((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,\s*(?:19|20)\d{2})?)|(?:the\s+week\s+of\s+)?((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:19|20)\d{2})|((?:19|20)\d{2})/i;

function extractDateFromWhen(whenText: string): string | null {
  const match = whenText.match(DATE_EXTRACTION);
  if (!match) return null;
  return (match[1] || match[2] || match[3] || '').trim();
}

function formatPublishedAtDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function injectDateIntoGround(slides: BeatCopy[], factSheet: FactSheet, articlePublishedAt: string | null): BeatCopy[] {
  const groundIdx = slides.findIndex((s) => s.beat === 'GROUND');
  if (groundIdx < 0) return slides;
  const ground = slides[groundIdx]!;
  const bodyText = (ground.body ?? []).map((s) => s.text).join(' ');
  const bodyBottomText = (ground.bodyBottom ?? []).map((s) => s.text).join(' ');
  if (DATE_DETECTION.test(bodyText) || DATE_DETECTION.test(bodyBottomText)) return slides;
  const whenText = factSheet.five_ws.when ?? '';
  // Prefer fact_sheet.when when it carries a real date; otherwise fall back
  // to the article's own publication date so QA's "when" five-W is answered
  // even when Sonnet's fact-sheet stage left it blank (common for stories
  // where the body doesn't cite a date explicitly).
  const date = extractDateFromWhen(whenText) ?? formatPublishedAtDate(articlePublishedAt);
  if (!date) return slides;
  // Prepend "On {date}, " to the body's first span as a pivot-role span
  // (dates are always green pivot except on covers, and GROUND isn't a cover).
  const existingBody = ground.body ?? [];
  const dateSpans: SpanRun = [
    { text: 'On ', role: 'narrative' },
    { text: date, role: 'pivot' },
    { text: ', ', role: 'narrative' },
  ];
  // If the first existing span starts uppercase, lowercase it so the sentence flows.
  const withLoweredFirst = existingBody.length > 0
    ? [{ ...existingBody[0]!, text: existingBody[0]!.text.replace(/^([A-Z])/, (_m, c) => c.toLowerCase()) }, ...existingBody.slice(1)]
    : existingBody;
  const newBody = [...dateSpans, ...withLoweredFirst];
  const patched = { ...ground, body: newBody };
  return slides.map((s, i) => (i === groundIdx ? patched : s));
}

function normalize(raw: unknown, plan: StoryPlan, factSheet: FactSheet, articlePublishedAt: string | null): EditorialPost {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('copy: model returned non-object JSON');
  }
  const r = raw as Record<string, unknown>;
  const planSlides = plan.slides;

  const slidesRaw = Array.isArray(r.slides) ? r.slides : [];
  const slides: BeatCopy[] = slidesRaw
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x, idx) => {
      const position = typeof x.position === 'number' ? Math.max(0, Math.round(x.position)) : idx;
      const planSlide = planSlides.find((p) => p.position === position) ?? planSlides[idx];
      const beat = planSlide?.beat ?? (typeof x.beat === 'string' ? x.beat as Beat : 'GROUND' as Beat);
      const asset_needs = asStringArray(x.asset_needs).length > 0
        ? asStringArray(x.asset_needs)
        : (planSlide?.asset_needs ?? []);
      const facts = asStringArray(x.facts).length > 0
        ? asStringArray(x.facts)
        : (planSlide?.facts ?? []);
      const swipe_reason = typeof x.swipe_reason === 'string' && x.swipe_reason.length > 0
        ? x.swipe_reason.trim()
        : (planSlide?.swipe_reason ?? '');
      // Sides array — populated only on DEBATE beats. Each entry has a
      // short label + a short position sentence.
      const sidesRaw = Array.isArray(x.sides) ? x.sides : null;
      const sides = sidesRaw
        ? sidesRaw
            .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
            .map((s) => ({
              label: typeof s.label === 'string' ? s.label.trim() : '',
              text: typeof s.text === 'string' ? s.text.trim() : '',
            }))
            .filter((s) => s.label.length > 0 && s.text.length > 0)
        : null;

      let headline = normalizeSpanRun(x.headline);
      let body = normalizeSpanRun(x.body);
      let bodyBottom = normalizeSpanRun(x.bodyBottom);
      let title = normalizeSpanRun(x.title);

      // TURN beats are type-only landing — headline is the whole slide.
      // If the model also emitted body/bodyBottom/title, drop them so the
      // B5 renderer's landing treatment doesn't fight sentence-length copy.
      if (beat === 'TURN') {
        // If headline is missing but body is populated (model wrote the
        // landing line into body), promote body → headline first.
        if (!headline && body) headline = body;
        body = null;
        bodyBottom = null;
        title = null;
      }

      // Cap hook spans at 1 per run per design skill's three-role system.
      // Extra hook spans are demoted to narrative so the slide isn't a
      // double-orange train wreck.
      const capHooks = (run: SpanRun | null): SpanRun | null => {
        if (!run) return null;
        let seen = 0;
        return run.map((s) => {
          if (s.role === 'hook') {
            seen += 1;
            if (seen > 1) return { ...s, role: 'narrative' as const };
          }
          return s;
        });
      };
      headline = capHooks(headline);
      body = capHooks(body);
      bodyBottom = capHooks(bodyBottom);
      title = capHooks(title);

      return {
        position,
        beat,
        headline,
        body,
        bodyBottom,
        title,
        sides: sides && sides.length > 0 ? sides : null,
        altText: typeof x.altText === 'string' ? x.altText.trim() : '',
        swipe_reason,
        asset_needs,
        facts,
      };
    })
    .sort((a, b) => a.position - b.position);

  const caption = typeof r.caption === 'string' ? r.caption.trim() : '';

  // Prompt-leak guard — Sonnet occasionally emits meta-commentary as if it
  // were mid-conversation instead of writing copy. Detect the tells and
  // throw so the caller can retry or fail loudly instead of persisting
  // garbage into copy_json.
  //
  // Patterns split into two buckets:
  //   openerPatterns  — chat-response openers. Only trigger when text has
  //     lowercase letters. Uppercase landing lines like "HERE'S WHAT COMPANIES
  //     WILL FACE." are legitimate slide copy and must not trip these.
  //   metaPatterns    — task-referring meta-commentary ("Paste the carousel",
  //     "the actual Instagram", etc.) that has no legitimate case-insensitive
  //     use in slide copy. Trigger regardless of case.
  const openerPatterns = [
    /^I['‘’]ll\s+/i,
    /^I['‘’]m\s+(ready|going|looking|not)/i,
    /^I\s+(don['‘’]t|can['‘’]t|see|need|understand|notice|will)\s+/i,
    /^I\s+would\s+(rewrite|need|be)\s+/i,
    /^Here['‘’]s\s+(what|the|how|my)/i,
    /^Sure,?\s+I/i,
    /^Let\s+me\s+/i,
    /^Below\s+is\s+the/i,
    /^Certainly[,.!]/i,
    /^Of\s+course[,.!]/i,
    /^Absolutely[,.!]/i,
    /^Great\s+question/i,
  ];
  const metaPatterns = [
    // Direct requests for input from the "user".
    /Please\s+(share|provide|paste|give)\s+the\s+(actual|real|full|carousel|text|copy)/i,
    /the\s+text\s+you\s+want\s+(me\s+to|cleaned|rewritten)/i,
    /the\s+actual\s+Instagram\s+carousel/i,
    /Paste\s+the\s+(carousel|copy|text)/i,
    /Share\s+the\s+carousel/i,
    /(?:can|could)\s+you\s+(share|paste|provide)\s+the/i,
    // Meta-commentary about the rewriting task.
    /rewrite\s+it[—-]?\s*removing/i,
    /I['‘’]ll\s+(rewrite|clean|remove|edit|polish)\s+it/i,
    /I\s+(can|will)\s+rewrite/i,
    /(remove|removing)\s+(every\s+)?AI\s+tells?/i,
    /keep\s+all\s+the\s+facts/i,
  ];
  const flatText = (run: SpanRun | null) =>
    (run ?? []).map((s) => s.text).join(' ').trim();
  const hasLowercase = (s: string) => /[a-z]/.test(s);
  for (const slide of slides) {
    for (const field of ['headline', 'body', 'bodyBottom', 'title'] as const) {
      const text = flatText(slide[field]);
      if (!text) continue;
      // Openers — skip when text is all-caps (legitimate landing line).
      if (hasLowercase(text)) {
        for (const pat of openerPatterns) {
          if (pat.test(text)) {
            throw new Error(
              `copy: prompt-leak (opener) in slide ${slide.position} (${slide.beat}) ${field}: matched /${pat.source}/ — "${text.slice(0, 100)}..."`,
            );
          }
        }
      }
      // Meta-terminology — check regardless of case.
      for (const pat of metaPatterns) {
        if (pat.test(text)) {
          throw new Error(
            `copy: prompt-leak (meta) in slide ${slide.position} (${slide.beat}) ${field}: matched /${pat.source}/ — "${text.slice(0, 100)}..."`,
          );
        }
      }
    }
  }

  // Caption hard-cap. Editorial skill says 500-900 chars; Sonnet sometimes
  // overshoots. Trim to 900 at the last sentence boundary rather than
  // mid-word.
  let cappedCaption = caption;
  if (cappedCaption.length > 900) {
    const trimTo = 900;
    const trimmed = cappedCaption.slice(0, trimTo);
    const lastPeriod = trimmed.lastIndexOf('.');
    cappedCaption = lastPeriod > 400 ? trimmed.slice(0, lastPeriod + 1) : trimmed;
  }

  // Layer 1 auto-fixes — deterministic transforms that run on every post.
  // Strip hedge adverbs and inject dates into GROUND when missing.
  const hedgeStripped = slides.map((slide) => ({
    ...slide,
    headline: stripHedgesFromRun(slide.headline),
    body: stripHedgesFromRun(slide.body),
    bodyBottom: stripHedgesFromRun(slide.bodyBottom),
    title: stripHedgesFromRun(slide.title),
  }));
  const dateInjected = injectDateIntoGround(hedgeStripped, factSheet, articlePublishedAt);
  const captionHedgeStripped = stripHedges(cappedCaption);

  return { slides: dateInjected, caption: captionHedgeStripped };
}

export type CopyInput = {
  factSheet: FactSheet;
  chosenHook: ChosenHook;
  strategy: StrategyPlan;
  storyPlan: StoryPlan;
  articlePublishedAt: string | null;
};

export async function writeCopy(input: CopyInput): Promise<CopyResult> {
  const userText =
    `FACT SHEET (JSON):\n${JSON.stringify(input.factSheet, null, 2)}\n\n`
    + `CHOSEN HOOK (JSON):\n${JSON.stringify(input.chosenHook, null, 2)}\n\n`
    + `STRATEGY (JSON):\n${JSON.stringify(input.strategy, null, 2)}\n\n`
    + `STORY PLAN (JSON):\n${JSON.stringify(input.storyPlan, null, 2)}`;

  const response = await anthropic.messages.create({
    model: EDITORIAL_MODEL,
    // 11 slides × ~600 tokens each (span-run payload is chatty) + caption
    // + wrapper. 8000 is comfortable headroom for the biggest posts.
    max_tokens: 8000,
    system: cachedSystemText(SYSTEM_PROMPT, '1h'),
    messages: [{ role: 'user', content: userText }],
  });

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === 'text',
  );
  if (!textBlock) throw new Error('copy: model returned no text block');

  const post = normalize(parseJson(textBlock.text), input.storyPlan, input.factSheet, input.articlePublishedAt);
  const cache = cacheUsageFromMessage(response);
  const outputTokens = Math.max(0, Number(response.usage.output_tokens ?? 0));
  const usage: CopyUsage = {
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

  return { post, usage, raw: response };
}
