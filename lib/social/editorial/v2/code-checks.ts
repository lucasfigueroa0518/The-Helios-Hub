/**
 * Code checks that run before every Fact-checker round.
 *
 * Rules from docs/HELIOS-PIPELINE-V2-HANDOFF.md §Orchestration rules → Code
 * checks: slide count 4-11 (cover + follow inclusive), char limits per field,
 * HIGHLIGHT must be an exact substring, brief-image-N must exist, caption
 * 400-800 ex-Source, no hashtags, banned phrases split into always-wrong vs
 * judgment, numbers trace against fetched source texts with normalization.
 */

import type { Brief, ParsedPost } from './parse';
import { BANNED_ALWAYS, BANNED_JUDGMENT } from './voice-block';

export type CheckErrorKind =
  | 'slide_count'
  | 'char_limit'
  | 'highlight_substring'
  | 'image_ref'
  | 'caption_length'
  | 'caption_hashtag'
  | 'banned_always'
  | 'banned_judgment'
  | 'number_trace';

export type CheckError = {
  kind: CheckErrorKind;
  target: 'slide' | 'cover' | 'follow' | 'caption';
  slidePosition?: number;
  field?: string;
  message: string;
  /** For banned_judgment: the word so the Editor can decide judgment vs banned use. */
  word?: string;
};

export type CheckReport = { ok: boolean; errors: CheckError[] };

/** Character budgets from §Orchestration rules. */
export const LIMITS = {
  cover: 100,
  headline: 60,
  body: 220,
  bigNumber: 12,
  follow: 100,
  captionMin: 400,
  captionMax: 800,
  slideCountMin: 4,
  slideCountMax: 11,
};

export function checkPost(post: ParsedPost, brief: Brief): CheckReport {
  const errors: CheckError[] = [];

  // ── Slide count (cover + follow + slides). "slides" in post excludes the
  // cover; follow is a separate line. Total = 1 (cover) + slides.length + 1 (follow).
  const totalSlides = 1 + post.slides.length + 1;
  if (totalSlides < LIMITS.slideCountMin) {
    const short = LIMITS.slideCountMin - totalSlides;
    errors.push({
      kind: 'slide_count',
      target: 'slide',
      message: `Slide count is ${totalSlides}. The minimum is ${LIMITS.slideCountMin}. Add at least ${short} more slide${short === 1 ? '' : 's'}.`,
    });
  }
  if (totalSlides > LIMITS.slideCountMax) {
    const over = totalSlides - LIMITS.slideCountMax;
    errors.push({
      kind: 'slide_count',
      target: 'slide',
      message: `Slide count is ${totalSlides}. The maximum is ${LIMITS.slideCountMax}. Cut at least ${over} slide${over === 1 ? '' : 's'}.`,
    });
  }

  // ── Cover length + highlight substring + image reference
  const coverText = post.cover.text ?? '';
  if (coverText.length > LIMITS.cover) {
    errors.push({
      kind: 'char_limit',
      target: 'cover',
      field: 'TEXT',
      message: makeCharLimitMessage('COVER TEXT', coverText.length, LIMITS.cover),
    });
  }
  const coverHighlight = post.cover.highlight ?? '';
  if (coverHighlight && !coverText.includes(coverHighlight)) {
    errors.push({
      kind: 'highlight_substring',
      target: 'cover',
      field: 'HIGHLIGHT',
      message: `COVER HIGHLIGHT ("${coverHighlight}") is not an exact substring of the cover text. Rewrite the highlight so it matches a phrase in the cover verbatim, or edit the cover to include the highlight phrase word-for-word.`,
    });
  }
  const coverImageError = checkImageRef(post.cover.image ?? '', brief);
  if (coverImageError) {
    errors.push({ kind: 'image_ref', target: 'cover', field: 'IMAGE', message: coverImageError });
  }
  errors.push(...scanVoiceOnText('cover', 'TEXT', coverText, undefined));

  // ── Per-slide checks
  for (const slide of post.slides) {
    if (slide.headline && slide.headline.length > LIMITS.headline) {
      errors.push({
        kind: 'char_limit',
        target: 'slide',
        slidePosition: slide.position,
        field: 'HEADLINE',
        message: makeCharLimitMessage(`SLIDE ${slide.position} HEADLINE`, slide.headline.length, LIMITS.headline),
      });
    }
    if (slide.body && slide.body.length > LIMITS.body) {
      errors.push({
        kind: 'char_limit',
        target: 'slide',
        slidePosition: slide.position,
        field: 'BODY',
        message: makeCharLimitMessage(`SLIDE ${slide.position} BODY`, slide.body.length, LIMITS.body),
      });
    }
    if (slide.bigNumber && slide.bigNumber.length > LIMITS.bigNumber) {
      errors.push({
        kind: 'char_limit',
        target: 'slide',
        slidePosition: slide.position,
        field: 'BIG NUMBER',
        message: makeCharLimitMessage(`SLIDE ${slide.position} BIG NUMBER`, slide.bigNumber.length, LIMITS.bigNumber),
      });
    }
    // HIGHLIGHT must be an exact substring of HEADLINE or BODY.
    if (slide.highlight) {
      const hay = `${slide.headline ?? ''}\n${slide.body ?? ''}`;
      if (!hay.includes(slide.highlight)) {
        errors.push({
          kind: 'highlight_substring',
          target: 'slide',
          slidePosition: slide.position,
          field: 'HIGHLIGHT',
          message: `SLIDE ${slide.position} HIGHLIGHT ("${slide.highlight}") is not an exact substring of the slide's HEADLINE or BODY. Rewrite the highlight so it matches a phrase in the slide verbatim, or edit the slide to include the highlight phrase word-for-word.`,
        });
      }
    }
    if (slide.image) {
      const err = checkImageRef(slide.image, brief);
      if (err) errors.push({ kind: 'image_ref', target: 'slide', slidePosition: slide.position, field: 'IMAGE', message: err });
    }
    errors.push(...scanVoiceOnText('slide', 'HEADLINE', slide.headline ?? '', slide.position));
    errors.push(...scanVoiceOnText('slide', 'BODY', slide.body ?? '', slide.position));
  }

  // ── FOLLOW
  if (post.follow.length > LIMITS.follow) {
    errors.push({
      kind: 'char_limit',
      target: 'follow',
      field: 'TEXT',
      message: makeCharLimitMessage('FOLLOW TEXT', post.follow.length, LIMITS.follow),
    });
  }
  errors.push(...scanVoiceOnText('follow', 'TEXT', post.follow, undefined));

  return { ok: errors.length === 0, errors };
}

/** Caption checks — length ex-Source, no hashtags, banned phrases. */
export function checkCaption(caption: string): CheckReport {
  const errors: CheckError[] = [];
  const sourceMatch = caption.match(/^(Source:.*)$/m);
  const body = sourceMatch ? caption.slice(0, sourceMatch.index).trimEnd() : caption;
  if (body.length < LIMITS.captionMin) {
    const short = LIMITS.captionMin - body.length;
    errors.push({
      kind: 'caption_length',
      target: 'caption',
      message: `Caption is ${body.length} characters (excluding the "Source:" line). The minimum is ${LIMITS.captionMin}. Add at least ${short} characters (about ${estimateWords(short)} words) of substantive detail.`,
    });
  }
  if (body.length > LIMITS.captionMax) {
    const over = body.length - LIMITS.captionMax;
    errors.push({
      kind: 'caption_length',
      target: 'caption',
      message: `Caption is ${body.length} characters (excluding the "Source:" line). The limit is ${LIMITS.captionMax}. Cut at least ${over} characters (about ${estimateWords(over)} words).`,
    });
  }
  if (/#\w/.test(caption)) {
    errors.push({
      kind: 'caption_hashtag',
      target: 'caption',
      message: 'Caption contains a hashtag. Remove every "#word" — Instagram hashtags are banned in Helios captions.',
    });
  }
  errors.push(...scanVoiceOnText('caption', 'TEXT', body, undefined));
  return { ok: errors.length === 0, errors };
}

/**
 * "SLIDE 7 BODY is 292 characters. The limit is 220. Cut at least 72
 * characters (about 12 words)." — one shape for every char-limit error so
 * the Editor sees an unambiguous, actionable instruction.
 */
function makeCharLimitMessage(field: string, actual: number, limit: number): string {
  const over = actual - limit;
  return `${field} is ${actual} characters. The limit is ${limit}. Cut at least ${over} characters (about ${estimateWords(over)} words).`;
}

/** ~6 chars per word including spaces. Minimum 1. */
function estimateWords(chars: number): number {
  return Math.max(1, Math.round(chars / 6));
}

/**
 * Number-trace check: every number in slides + caption must appear in at
 * least one fetched source text. Normalizes `$21 billion` == `$21B`, etc.
 * Skips the caption's "Source:" line and skips numbers that are clearly
 * slide-count markers (position labels).
 */
export function checkNumberTrace(
  post: ParsedPost,
  caption: string,
  sourceTexts: string[],
): CheckReport {
  const errors: CheckError[] = [];
  const haystack = sourceTexts.map(normalizeNumeric).join('\n');

  const inspect = (targetText: string, target: CheckError['target'], slidePosition?: number, field?: string) => {
    for (const raw of extractNumbers(targetText)) {
      let found = false;
      for (const candidate of numberCandidates(raw)) {
        if (haystack.includes(candidate)) { found = true; break; }
      }
      if (found) continue;
      const location = target === 'slide' && slidePosition !== undefined
        ? `SLIDE ${slidePosition} ${field ?? ''}`.trim()
        : target === 'cover' ? 'COVER TEXT'
        : target === 'follow' ? 'FOLLOW TEXT'
        : 'CAPTION';
      errors.push({
        kind: 'number_trace',
        target,
        slidePosition,
        field,
        message: `${location}: number "${raw}" does not appear in any fetched source. Either remove the number, replace it with one the sources actually state, or drop this slide.`,
      });
    }
  };

  inspect(post.cover.text ?? '', 'cover', undefined, 'TEXT');
  for (const slide of post.slides) {
    inspect(slide.headline ?? '', 'slide', slide.position, 'HEADLINE');
    inspect(slide.body ?? '', 'slide', slide.position, 'BODY');
    inspect(slide.bigNumber ?? '', 'slide', slide.position, 'BIG NUMBER');
  }
  inspect(post.follow, 'follow', undefined, 'TEXT');

  const sourceMatch = caption.match(/^(Source:.*)$/m);
  const captionBody = sourceMatch ? caption.slice(0, sourceMatch.index) : caption;
  inspect(captionBody, 'caption', undefined, 'TEXT');

  return { ok: errors.length === 0, errors };
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

function checkImageRef(ref: string, brief: Brief): string | null {
  if (!ref) return null;
  const m = ref.match(/^brief image\s+(\d+)/i);
  if (!m) return null; // free-text or "type only" — legal
  const n = Number(m[1]);
  const found = brief.images.find((img) => img.number === n);
  if (!found) {
    const available = brief.images.map((img) => img.number).join(', ');
    return available
      ? `IMAGE reference "brief image ${n}" is not in the brief's IMAGES list (available: ${available}). Change the reference to one of the available images, use "type only", or write a description.`
      : `IMAGE reference "brief image ${n}" is invalid because the brief has no IMAGES. Use "type only" or write a description instead.`;
  }
  return null;
}

function scanVoiceOnText(
  target: CheckError['target'],
  field: string,
  text: string,
  slidePosition: number | undefined,
): CheckError[] {
  const out: CheckError[] = [];
  if (!text) return out;
  const location = target === 'slide' && slidePosition !== undefined
    ? `SLIDE ${slidePosition} ${field ?? ''}`.trim()
    : target === 'cover' ? 'COVER TEXT'
    : target === 'follow' ? 'FOLLOW TEXT'
    : 'CAPTION';
  for (const rule of BANNED_ALWAYS) {
    const re = rule.kind === 'literal'
      ? new RegExp(rule.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu')
      : new RegExp(rule.pattern, 'iu');
    if (re.test(text)) {
      out.push({
        kind: 'banned_always',
        target,
        slidePosition,
        field,
        message: `${location}: contains banned ${rule.label}. Remove it (rewrite the phrase without it) — this construction is never allowed in Helios voice.`,
      });
    }
  }
  for (const word of BANNED_JUDGMENT) {
    const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'iu');
    if (re.test(text)) {
      out.push({
        kind: 'banned_judgment',
        target,
        slidePosition,
        field,
        message: `${location}: contains the judgment word "${word}". If it's the inflated marketing use, rewrite; if it's a genuine normal use (e.g. physical "space", a product legitimately "features" X), keep it and note the reason in EDIT NOTES.`,
        word,
      });
    }
  }
  return out;
}

/**
 * Extract number-bearing tokens from text. Catches: percentages, currency
 * ($21B, $3.9M), plain integers, decimals, and 4-digit years. Skips numbers
 * inside "SLIDE N" labels (won't happen post-parse but safe to be defensive).
 */
function extractNumbers(text: string): string[] {
  const out = new Set<string>();
  // Percent
  for (const m of text.matchAll(/\b\d+(?:\.\d+)?\s*%/g)) out.add(m[0]);
  // Currency with unit suffix
  for (const m of text.matchAll(/\$\s*\d+(?:\.\d+)?\s*(?:B|M|K|billion|million|thousand)?\b/gi)) out.add(m[0]);
  // Years (4 digits, 1900-2099)
  for (const m of text.matchAll(/\b(?:19|20)\d{2}\b/g)) out.add(m[0]);
  // Plain integers / decimals (skip years already captured and single digits under 10 that add no evidence value)
  for (const m of text.matchAll(/\b\d{2,}(?:[,\d]*)?(?:\.\d+)?\b/g)) {
    const s = m[0];
    if (/^(?:19|20)\d{2}$/.test(s)) continue;
    out.add(s);
  }
  return [...out];
}

/**
 * Turn one raw number into candidate normalized strings we look for in the
 * source haystack. Covers "$21 billion" ↔ "$21B", "26%" ↔ "26 percent",
 * "1,000" ↔ "1000", "nearly $21 billion" ↔ "$21B", etc.
 */
function numberCandidates(raw: string): string[] {
  const out = new Set<string>();
  const trimmed = raw.trim();
  out.add(trimmed);
  out.add(normalizeNumeric(trimmed));

  // % ↔ percent
  const pct = trimmed.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (pct) {
    out.add(`${pct[1]}percent`);
    out.add(`${pct[1]} percent`);
    out.add(`${pct[1]}%`);
  }

  // $NUM UNIT → $NUM<letter>
  const cur = trimmed.match(/^\$\s*(\d+(?:\.\d+)?)\s*(billion|million|thousand|B|M|K)?$/i);
  if (cur) {
    const num = cur[1]!;
    const unit = (cur[2] ?? '').toLowerCase();
    const letter = unit.startsWith('b') ? 'B' : unit.startsWith('m') ? 'M' : unit.startsWith('k') ? 'K' : '';
    out.add(`$${num}${letter}`);
    if (letter === 'B') out.add(`$${num} billion`);
    if (letter === 'M') out.add(`$${num} million`);
    if (letter === 'K') out.add(`$${num} thousand`);
  }

  // Comma-separated integers → collapsed
  if (/,/.test(trimmed)) out.add(trimmed.replace(/,/g, ''));

  return [...out].map(normalizeNumeric);
}

/** Normalize whitespace and case for number-trace haystack + needle. */
function normalizeNumeric(s: string): string {
  return s
    .replace(/\s+/g, '')
    .toLowerCase();
}
