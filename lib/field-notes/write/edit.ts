/**
 * Cut-only enforcement. The Editor prompt asks for cuts; this code guarantees
 * it: whatever the model returns, each kept field is a word-for-word
 * subsequence of the input field, nothing is added, and the field set never
 * grows. Anything that is not a pure cut is discarded and the input stands.
 */
import type { DraftSlide, PostDraft } from './types';

const tokens = (s: string): string[] => s.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').split(/\s+/).filter(Boolean);

/** True when `cut` is `whole` with words removed (case and punctuation ignored). */
export function isCutOf(cut: string, whole: string): boolean {
  const w = tokens(whole);
  let i = 0;
  for (const t of tokens(cut)) {
    while (i < w.length && w[i] !== t) i++;
    if (i === w.length) return false;
    i++;
  }
  return true;
}

const spansOf = (s: string): string[] => s.match(/`[^`\n]+`/g) ?? [];

/**
 * Backtick spans (commands, keys, flags) survive cutting only whole: every span in the cut is a
 * span of the original, and none of the original's spans is left behind as plain text or half cut.
 * Dropping a span entirely is a legal cut.
 */
export function spansIntact(cut: string, whole: string): boolean {
  if ((cut.match(/`/g) ?? []).length % 2 !== 0) return false;
  const orig = spansOf(whole);
  const kept = spansOf(cut);
  if (kept.some((k) => !orig.includes(k))) return false;
  const stripped = cut.replace(/`[^`\n]+`/g, ' ');
  return !orig.some((o) => stripped.includes(o.slice(1, -1)));
}

/** A pure cut that also leaves every backtick span whole. */
const validCut = (cut: string, whole: string): boolean => isCutOf(cut, whole) && spansIntact(cut, whole);

export type CutResult = { draft: PostDraft; notes: string[] };

/** The fields the Editor may cut. The name is never cut: it is the thing's real name, kept exactly as written. */
const CUTTABLE = ['headline', 'body', 'tryIt'] as const;

/**
 * Slides are matched by tipId, never by position. For each input slide the Editor's version of the
 * same tip is used only where it is a pure cut (headline, body, tryIt, caption); anything else, a missing
 * slide, an emptied field, a changed name or an added slide, falls back to the input.
 */
export function enforceCutOnly(input: PostDraft, proposed: PostDraft): CutResult {
  const notes: string[] = [];
  const out: DraftSlide[] = input.slides.map((slide, i) => {
    const cand = proposed.slides.find((p) => p.tipId === slide.tipId);
    if (!cand) {
      notes.push(`slide ${i + 1} was missing from the Editor output and was kept`);
      return slide;
    }
    const pick = (field: (typeof CUTTABLE)[number]): string => {
      const c = cand[field] ?? '';
      if (c && validCut(c, slide[field])) return c;
      if (c !== slide[field]) notes.push(`slide ${i + 1}: ${field} was not a pure cut; kept as written`);
      return slide[field];
    };
    if (cand.name !== slide.name) notes.push(`slide ${i + 1}: the name is never cut; kept as written`);
    return { kind: 'tip', tipId: slide.tipId, headline: pick('headline'), body: pick('body'), name: slide.name, tryIt: pick('tryIt') };
  });
  // Only input slides are iterated, so a slide the Editor added or reordered never carries over; slides are never deleted.
  if (proposed.slides.some((p) => !input.slides.some((s) => s.tipId === p.tipId))) notes.push('slides the Editor added were discarded');

  const caption = proposed.caption && validCut(proposed.caption, input.caption) ? proposed.caption : input.caption;
  if (caption === input.caption && proposed.caption !== input.caption) notes.push('caption was not a pure cut; kept as written');
  return { draft: { slides: out, caption }, notes };
}
