/**
 * D-245. A teaser is a feed excerpt or a gated page that stands in for an
 * article: "Read full article", "Continue reading", a WordPress "appeared
 * first on" footer, or a members-only notice. A teaser never enters the pool.
 * The pipeline follows the link for the full article, and drops the item when
 * it cannot get one.
 *
 * Link-style markers only count near the end of the text, where a feed puts
 * them. Gate notices count anywhere, because they replace the article body.
 * Text longer than TEASER_MAX_CHARS is never a teaser: a full article can end
 * on a "Continue reading" link to the next story, and that is not a teaser.
 */

/** A teaser is short. Feed excerpts run under 1,500 characters. */
export const TEASER_MAX_CHARS = 3_000;

/** How much of the end of the text the link-style markers are looked for in. */
export const TEASER_TAIL_CHARS = 400;

const TAIL_MARKERS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'read full article', pattern: /\bread (?:the )?full (?:article|story|post|piece)\b/i },
  { name: 'continue reading', pattern: /\bcontinue reading\b/i },
  { name: 'read more', pattern: /\bread more\b\W*(?:comments\W*)?$/i },
  { name: 'appeared first on', pattern: /\bappeared first on\b/i },
  { name: 'truncation mark', pattern: /\[(?:…|\.\.\.)\]\W*(?:comments\W*)?$/i },
];

const GATE_MARKERS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  {
    name: 'members only',
    pattern: /\bthis (?:post|article|story|issue) is (?:only )?(?:for|available to) (?:paid |paying )?(?:subscribers|members)\b/i,
  },
  {
    name: 'subscribe to read',
    pattern: /\b(?:subscribe|sign up|become a (?:paid )?(?:member|subscriber)|upgrade) to (?:read|continue|keep reading|unlock|get access)\b/i,
  },
];

/** The marker that makes this text a teaser, or null when it reads as a whole piece. */
export function teaserMarker(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > TEASER_MAX_CHARS) return null;
  const tail = trimmed.slice(-TEASER_TAIL_CHARS);
  for (const marker of TAIL_MARKERS) if (marker.pattern.test(tail)) return marker.name;
  for (const marker of GATE_MARKERS) if (marker.pattern.test(trimmed)) return marker.name;
  return null;
}

export function looksLikeTeaser(text: string): boolean {
  return teaserMarker(text) !== null;
}
