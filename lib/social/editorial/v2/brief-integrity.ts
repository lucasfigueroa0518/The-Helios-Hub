/**
 * Brief-integrity gate. Runs immediately after the Reporter, before
 * Writer sees anything.
 *
 * The 2026-09-29 batches showed multiple BIG fact-check flags trace to
 * quotes and specific claims the Reporter put in the brief without a
 * fetched-source anchor:
 *   - Suleyman: "thoughtful, principled, and intellectually honest" —
 *     brief attributes to Suleyman's essay; fetched essay text ends
 *     before that passage.
 *   - Newsom: "a warning shot that today's model capabilities present
 *     the possibility of loss-of-control incidents" — brief attributes
 *     to OpenAI's Aug 26 report; that URL was never fetched.
 *
 * Rule: every QUOTE in THE STORY (any text inside straight or curly
 * quotes ≥ 6 chars) must appear in at least one fetched source's text.
 * If not, cut it from the brief before the Writer sees it.
 *
 * If cutting quotes leaves the brief unable to support 5 story slides,
 * bail the run to "thin brief" (a Writer that can't reach 5 slides on
 * genuine material shouldn't fill the gap with invented content).
 */

import type { Brief } from './parse';
import type { FetchedSource } from './writer';

// Only DOUBLE quotes as delimiters — single quotes / apostrophes appear
// in contractions ("Anthropic's", "Suleyman's") and would otherwise be
// mistaken for quote delimiters (2026-09-29: 14 fragments were dropped
// on the Suleyman run because two possessive apostrophes bracketed
// normal narrative text). Straight " and curly " " both count.
const QUOTE_RE = /["“”]([^"“”\n]{8,400})["“”]/g;

export type BriefIntegrityResult = {
  cleanedBrief: Brief;
  cleanedBriefRaw: string;
  droppedQuotes: Array<{ quote: string; reason: string }>;
};

/**
 * Normalize text for quote comparison. Handles the drift ways a Reporter's
 * brief and a fetched source diverge on the same quote:
 *   - Curly quotes → straight quotes.
 *   - Em / en dashes → regular hyphens.
 *   - Unicode ellipsis / triple-period → space.
 *   - Non-breaking / thin spaces → regular space.
 *   - Collapse whitespace runs.
 *   - Lowercase for case-insensitive match.
 */
function normalizeForMatch(s: string): string {
  return s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[—–]/g, '-')
    .replace(/ | | | | /g, ' ') // non-breaking + narrow spaces
    .replace(/…|\.\.\./g, ' ')                            // ellipsis marks
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * True when `quote` appears in at least one source text after normalization.
 * A 4-word contiguous phrase from the quote also counts (Reporter may have
 * paraphrased whitespace / hyphen / connector words).
 */
function quoteAppearsInSources(quote: string, sourceTexts: FetchedSource[]): boolean {
  const needle = normalizeForMatch(quote);
  if (needle.length < 8) return true; // too short to be a distinctive quote
  for (const s of sourceTexts) {
    const hay = normalizeForMatch(s.text);
    if (hay.includes(needle)) return true;
    // Fallback: first 8 words of the quote as a contiguous match.
    const first8 = needle.split(' ').slice(0, 8).join(' ');
    if (first8.length >= 20 && hay.includes(first8)) return true;
  }
  return false;
}

/**
 * Rewrite THE STORY to remove any quote that has no source anchor. Leaves
 * a marker "[quote redacted: not in fetched sources]" so a reviewer can
 * see what was cut.
 */
function stripUnsourcedQuotesFromStory(story: string, sourceTexts: FetchedSource[]): {
  cleaned: string;
  dropped: Array<{ quote: string; reason: string }>;
} {
  const dropped: Array<{ quote: string; reason: string }> = [];
  const cleaned = story.replace(QUOTE_RE, (match, inner: string) => {
    if (quoteAppearsInSources(inner, sourceTexts)) return match;
    dropped.push({ quote: inner, reason: 'not in any fetched source text' });
    return '[quote redacted: not in fetched sources]';
  });
  return { cleaned, dropped };
}

/**
 * Rewrite BRIEF raw to replace the THE STORY section with the cleaned form.
 * Only touches THE STORY — other sections (TERMS, SOURCES, IMAGES) stay.
 */
function rewriteBriefRawStory(briefRaw: string, cleanedStory: string): string {
  return briefRaw.replace(
    /(THE STORY:\s*\n?)([\s\S]*?)(?=\n(?:TERMS|IMAGES|SOURCES):)/,
    (_, header) => `${header}${cleanedStory}\n`,
  );
}

/**
 * Cut every unsourced quote and return the cleaned brief. The "was the
 * brief so gutted it can't support 5 slides?" question is answered
 * downstream by counting the Writer's slide output — no arbitrary
 * character or term thresholds here (2026-09-29 revision).
 */
export function checkBriefIntegrity(brief: Brief, briefRaw: string, sourceTexts: FetchedSource[]): BriefIntegrityResult {
  const { cleaned, dropped } = stripUnsourcedQuotesFromStory(brief.story ?? '', sourceTexts);
  const cleanedBrief: Brief = { ...brief, story: cleaned };
  const cleanedBriefRaw = rewriteBriefRawStory(briefRaw, cleaned);
  return {
    cleanedBrief,
    cleanedBriefRaw,
    droppedQuotes: dropped,
  };
}
