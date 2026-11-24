import { TIP_SLIDES_MAX } from '@/lib/field-notes/types';
import type { DraftSlide, InsufficientSource, PostDraft } from './types';

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;

export type ParseResult = { ok: true; draft: PostDraft } | { ok: false; problems: string[] };

/** The three required text fields of a slide (tipId is checked separately). */
const TEXT_FIELDS = ['headline', 'body', 'name'] as const;

/**
 * Slide-by-slide shape check shared by the Writer and Editor parsers. Only tipId and the four text fields (tryIt may be
 * empty or absent)
 * are read: any other field (a stray `emphasis`, an old `solves` or `how`) is ignored and never reaches the draft.
 */
function readSlides(raw: unknown[], problems: string[]): DraftSlide[] {
  const slides: DraftSlide[] = [];
  const seen = new Set<string>();
  raw.forEach((s, i) => {
    const r = rec(s);
    if (typeof r.tipId !== 'string' || !r.tipId.trim()) return void problems.push(`slide ${i + 1}: tipId must be a string`);
    const missing = TEXT_FIELDS.find((f) => typeof r[f] !== 'string');
    if (missing) return void problems.push(`slide ${i + 1}: ${missing} must be a string`);
    // tryIt is optional: the exact usage when the source states it, otherwise empty (the caption links the source).
    if (r.tryIt !== undefined && r.tryIt !== null && typeof r.tryIt !== 'string') return void problems.push(`slide ${i + 1}: tryIt must be a string`);
    const tipId = r.tipId.trim();
    if (seen.has(tipId)) return void problems.push(`slide ${i + 1}: tip ${tipId} already has a slide`);
    seen.add(tipId);
    const text = (f: (typeof TEXT_FIELDS)[number]) => (r[f] as string).trim();
    slides.push({ kind: 'tip', tipId, headline: text('headline'), body: text('body'), name: text('name'), tryIt: typeof r.tryIt === 'string' ? r.tryIt.trim() : '' });
  });
  return slides;
}

/**
 * The Editor's output: structure only (strings in place, one slide per tip). Length and style are
 * the gates' business, and how many slides there are is the Writer parse's.
 */
export function parseDraft(input: unknown): ParseResult {
  const problems: string[] = [];
  const obj = rec(input);
  const rawSlides = Array.isArray(obj.slides) ? obj.slides : null;
  if (!rawSlides) problems.push('slides must be an array');
  if (typeof obj.caption !== 'string') problems.push('caption must be a string');
  const slides = readSlides(rawSlides ?? [], problems);
  if (problems.length) return { ok: false, problems };
  return { ok: true, draft: { slides, caption: (obj.caption as string).trim() } };
}

export type WriterParse =
  | { ok: true; draft: PostDraft; skipped: InsufficientSource[] }
  | { ok: false; problems: string[] };

/**
 * The Writer's tool answer for a known set of tips: `{ slides: [{tipId, headline, body, name, tryIt}], skipped:
 * [{tipId, missing}], caption }`. Every tipId must be one of `tipIds`; a tip with no slide and no
 * skipped entry is recorded as skipped (never padded, never invented). A tip is skipped only when its source does
 * not say what the thing is and what it does for the reader, or it is not about AI (a missing install command is no
 * reason; tryIt is then empty). Whether enough slides remain
 * is the caller's decision (fewer than TIP_SLIDES_MIN ends the run as insufficient_source).
 */
export function parseWriterOutput(input: unknown, tipIds: string[]): WriterParse {
  const problems: string[] = [];
  const obj = rec(input);
  const rawSlides = Array.isArray(obj.slides) ? obj.slides : null;
  if (!rawSlides) problems.push('slides must be an array');
  const rawSkipped = obj.skipped === undefined ? [] : Array.isArray(obj.skipped) ? obj.skipped : null;
  if (!rawSkipped) problems.push('skipped must be an array');
  if (obj.caption !== undefined && typeof obj.caption !== 'string') problems.push('caption must be a string');
  const slides = readSlides(rawSlides ?? [], problems);
  const known = new Set(tipIds);
  for (const s of slides) if (!known.has(s.tipId)) problems.push(`slide for unknown tip ${s.tipId}`);
  if (slides.length > TIP_SLIDES_MAX) problems.push(`at most ${TIP_SLIDES_MAX} tip slides`);

  const skipped: InsufficientSource[] = [];
  (rawSkipped ?? []).forEach((s, i) => {
    const r = rec(s);
    if (typeof r.tipId !== 'string' || !known.has(r.tipId.trim())) return void problems.push(`skipped ${i + 1}: unknown tip`);
    const tipId = r.tipId.trim();
    if (slides.some((x) => x.tipId === tipId) || skipped.some((x) => x.tipId === tipId)) return; // a slide wins; duplicates collapse
    const missing = typeof r.missing === 'string' && r.missing.trim() ? r.missing.trim() : 'no reason given';
    skipped.push({ tipId, missing });
  });
  if (problems.length) return { ok: false, problems };
  for (const id of tipIds) {
    if (!slides.some((s) => s.tipId === id) && !skipped.some((s) => s.tipId === id)) {
      skipped.push({ tipId: id, missing: 'the Writer did not write a slide for this tip' });
    }
  }
  const caption = typeof obj.caption === 'string' ? obj.caption.trim() : '';
  if (slides.length > 0 && !caption) return { ok: false, problems: ['caption must not be empty when slides are written'] };
  return { ok: true, draft: { slides, caption }, skipped };
}
