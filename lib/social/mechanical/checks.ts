/**
 * Mechanical guarantees (spec §6; plan M7). Plain code, no judgment,
 * nothing that could change meaning; every fix and every failure is
 * returned so it can be logged.
 *
 *   A. Silent fixes (applied to the text the stages wrote, never to the
 *      words of a filled quote):
 *        F1 dashes → approved punctuation
 *        F2 quote marks and apostrophes made consistent (typographic)
 *        F3 whitespace and markdown leftovers removed
 *        F4 trailing comma stripped from a displayed quote (punctuation only)
 *   B. Pass/fail checks (each failure carries what happens next; see
 *      FAILURE_ACTION):
 *        C1 character limits
 *        C2 quotation marks only around quote text from the brief
 *        C3 voice list (banned words, phrases, openers, "!", emoji)
 *        C4 caption: one "Source:" line naming a brief source, no links;
 *           no hashtags
 *        C5 at most 2 background slides
 *        C6 photo credit and licence (credit present, allowed licence, no
 *           agency credit)
 *        C7 every text field reaches the rendered slide (dropped text)
 *   Structure (quote/number IDs, excerpts, claim tags) is checkDraft's job
 *   and runs at the Writer and the Editor; the render-fit check and the
 *   cost cap already run in the design stage and the orchestrator.
 */
import { classifyCredit } from '@/lib/social/photos/credit';
import type { Photo } from '@/lib/social/photos/find';
import type { Brief } from '@/lib/social/reporter/brief';
import { isExactExcerpt, type FilledDraft } from '@/lib/social/writer/draft';

import { voiceHits } from './voice-lists';

// ── A. Silent fixes ───────────────────────────────────────────────────

export type Fix = { id: 'F1' | 'F2' | 'F3' | 'F4'; where: string; before: string; after: string };

/** F1: em dash → comma; en dash in a range → hyphen, otherwise a comma; spaced double hyphen → comma. */
export function fixDashes(s: string): string {
  return s
    .replace(/(\d)\s*–\s*(\d)/g, '$1-$2')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+--\s+/g, ', ')
    .replace(/,\s*,/g, ',');
}

/** F2: straight quotes → typographic; apostrophes → ’. */
export function fixQuoteMarks(s: string): string {
  return s
    .replace(/(^|[\s([{])"/g, '$1“')
    .replace(/"/g, '”')
    .replace(/(\w)'(\w)/g, '$1’$2')
    .replace(/(^|[\s([{])'/g, '$1‘')
    .replace(/'/g, '’');
}

/** F3: markdown leftovers and stray whitespace. */
export function fixWhitespace(s: string): string {
  return s
    .replace(/\*\*|__|`/g, '')
    .replace(/^[ \t]*(?:#{1,6}[ \t]+|[-*•][ \t]+)/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([,.;:!?])/g, '$1')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** F4 (Tommy, 2026-10-05): a displayed quote never ends on a comma. */
export function fixTrailingComma(s: string): string {
  return s.replace(/\s*,\s*$/, '');
}

/** Apply A to a filled draft (the stages' text only; quote words untouched). */
export function applySilentFixes(draft: FilledDraft): { draft: FilledDraft; fixes: Fix[] } {
  const d: FilledDraft = structuredClone(draft);
  const fixes: Fix[] = [];
  const fix = (where: string, before: string, fn: (s: string) => string, id: Fix['id']) => {
    const after = fn(before);
    if (after !== before) fixes.push({ id, where, before, after });
    return after;
  };
  const all = (where: string, s: string) => fix(where, fix(where, fix(where, s, fixDashes, 'F1'), fixQuoteMarks, 'F2'), fixWhitespace, 'F3');

  d.cover_options.forEach((c, i) => (c.text = all(`cover option ${i + 1}`, c.text)));
  d.cover = d.cover_options[d.chosen_cover - 1]!.text;
  d.slides.forEach((s, i) => {
    const at = `slide ${i + 2}`;
    s.headline.text = all(`${at} headline`, s.headline.text);
    if (s.body) s.body.text = all(`${at} body`, s.body.text);
    if (s.quote) s.quote.text = fix(`${at} quote`, s.quote.text, fixTrailingComma, 'F4');
  });
  d.follow = all('follow', d.follow);
  d.caption.text = all('caption', d.caption.text);
  return { draft: d, fixes };
}

// ── B. Pass/fail checks ───────────────────────────────────────────────

export type CheckId = 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7';
export type Failure = { id: CheckId; where: string; detail: string };

/** Spec §6 #7 LIMITS (characters). */
export const LIMITS = { cover: 90, headline: 60, body: 220, quote: 140, caption: 2200 } as const;

/** C1: character limits, with the exact overage (spec §6: never trimmed). */
export function checkLimits(d: FilledDraft): Failure[] {
  const out: Failure[] = [];
  const over = (where: string, text: string, max: number) => {
    if (text.length > max) out.push({ id: 'C1', where, detail: `${text.length} chars, limit ${max} (${text.length - max} over)` });
  };
  over('cover', d.cover, LIMITS.cover);
  d.slides.forEach((s, i) => {
    over(`slide ${i + 2} headline`, s.headline.text, LIMITS.headline);
    if (s.body) over(`slide ${i + 2} body`, s.body.text, LIMITS.body);
    if (s.quote) over(`slide ${i + 2} quote`, s.quote.text, LIMITS.quote);
  });
  over('caption', d.caption.text, LIMITS.caption);
  return out;
}

/** Quoted spans in a text: “…”, "…", and ‘…’ / '…' used as quote pairs (not apostrophes). */
export function quotedSpans(s: string): string[] {
  const spans = [...s.matchAll(/[“"]([^“”"]+)[”"]/g)].map((m) => m[1]!);
  for (const m of s.matchAll(/(?:^|[\s(])[‘']([^‘’']+)[’'](?=[\s.,;:!?)]|$)/g)) spans.push(m[1]!);
  return spans;
}

/**
 * C2 (Tommy, 2026-10-05): quotation marks only around quote text from the
 * brief. A quoted span in a cover, headline, body, follow or caption passes
 * only if it is a word-for-word excerpt of a QUOTES entry (spec §5.3);
 * quote slides' quotes are filled by code and carry no typed marks.
 */
export function checkQuoteMarks(d: FilledDraft, brief: Brief): Failure[] {
  const out: Failure[] = [];
  const fromBrief = (span: string) => brief.quotes.some((q) => isExactExcerpt(span.replace(/[.,;:]$/, ''), q.text));
  const scan = (where: string, text: string) => {
    for (const span of quotedSpans(text)) {
      if (!fromBrief(span)) out.push({ id: 'C2', where, detail: `quotation marks around "${span}", which isn't a QUOTES entry word for word` });
    }
  };
  scan('cover', d.cover);
  d.slides.forEach((s, i) => {
    scan(`slide ${i + 2} headline`, s.headline.text);
    if (s.body) scan(`slide ${i + 2} body`, s.body.text);
  });
  scan('follow', d.follow);
  scan('caption', d.caption.text);
  return out;
}

/** Remove the parts of a text that are a speaker's words (exempt from the voice list). */
function withoutQuotes(text: string): string {
  return text.replace(/[“"][^“”"]*[”"]/g, ' ').replace(/(^|[\s(])[‘'][^‘’']*[’'](?=[\s.,;:!?)]|$)/g, '$1 ');
}

/** C3: the voice list, on the stages' own words (quoted speech exempt). */
export function checkVoice(d: FilledDraft): Failure[] {
  const out: Failure[] = [];
  const scan = (where: string, text: string) => {
    for (const h of voiceHits(withoutQuotes(text))) out.push({ id: 'C3', where, detail: `${h.kind}: "${h.match}"` });
  };
  scan('cover', d.cover);
  d.slides.forEach((s, i) => {
    scan(`slide ${i + 2} headline`, s.headline.text);
    if (s.body) scan(`slide ${i + 2} body`, s.body.text);
  });
  scan('follow', d.follow);
  scan('caption', d.caption.text);
  return out;
}

const outletKey = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '');

/** C4: one "Source:" line naming at least one brief source, no links; no hashtags anywhere in the caption. */
export function checkCaption(d: FilledDraft, brief: Brief): Failure[] {
  const out: Failure[] = [];
  const lines = d.caption.text.split('\n').map((l) => l.trim());
  const source = lines.filter((l) => /^Source:/i.test(l));
  if (source.length !== 1) out.push({ id: 'C4', where: 'caption', detail: `${source.length} "Source:" lines (need exactly 1)` });
  else {
    const line = source[0]!;
    if (/https?:\/\/|www\./i.test(line)) out.push({ id: 'C4', where: 'caption', detail: 'link in the Source line' });
    const outlets = brief.sources.map((s) => outletKey(s.outlet)).filter((k) => k.length >= 2);
    if (!outlets.some((k) => outletKey(line).includes(k))) out.push({ id: 'C4', where: 'caption', detail: `Source line names no outlet from the brief's SOURCES: "${line}"` });
  }
  const tags = d.caption.text.match(/(^|\s)#[\p{L}\p{N}_]+/gu);
  if (tags) out.push({ id: 'C4', where: 'caption', detail: `hashtags: ${tags.map((t) => t.trim()).join(' ')}` });
  return out;
}

/** C5: a background slide rests only on BACKGROUND entries (B#). At most 2. */
export function checkBackground(d: FilledDraft): Failure[] {
  const bg = d.slides
    .map((s, i) => ({ i, ids: [...s.headline.facts, ...(s.body?.facts ?? [])] }))
    .filter((x) => x.ids.length > 0 && x.ids.every((id) => /^B\d+$/.test(id)));
  return bg.length > 2 ? [{ id: 'C5', where: bg.map((x) => `slide ${x.i + 2}`).join(', '), detail: `${bg.length} background slides (max 2)` }] : [];
}

const LICENCE_RE = /\b(cc0|cc by(?:-sa)?|public domain)\b/i;

/** C6: every photo has a credit, an allowed licence, and no agency credit. */
export function checkPhotoCredit(photo: Photo, where: string, brief: Brief): Failure[] {
  const out: Failure[] = [];
  if (!photo.credit.trim()) return [{ id: 'C6', where, detail: 'photo without a credit' }];
  const agency = classifyCredit({ caption: null, credit: photo.credit, page: null, organizations: [] });
  if (agency.verdict === 'rejected') out.push({ id: 'C6', where, detail: `rejected credit: ${agency.reason}` });
  if (photo.source === 'article') {
    const v = classifyCredit({ caption: null, credit: photo.credit, page: null, organizations: brief.subjects.map((s) => s.name) });
    if (v.verdict !== 'allowed') out.push({ id: 'C6', where, detail: `article photo credit not allowed: ${v.reason}` });
  } else if (!LICENCE_RE.test(photo.credit)) {
    out.push({ id: 'C6', where, detail: `no allowed licence in the credit: "${photo.credit}"` });
  }
  return out;
}

/** The text a reader must see, per rendered slide (cover = 0). */
export function expectedSlideText(d: FilledDraft): string[][] {
  return [
    [d.cover],
    ...d.slides.map((s) => [
      s.headline.text,
      ...(s.body ? [s.body.text] : []),
      ...(s.quote ? [s.quote.text, s.quote.speaker] : []),
      ...s.numbers.flatMap((n) => [n.value, n.counts]),
    ]),
    [d.follow],
  ];
}

const flat = (s: string) => s.toLowerCase().replace(/[“”"‘’'…]/g, '').replace(/\s+/g, ' ').trim();

/** C7 (Tommy, 2026-10-06): every text field in the final draft appears on its rendered slide. */
export function checkDroppedText(d: FilledDraft, renderedText: string[]): Failure[] {
  const out: Failure[] = [];
  expectedSlideText(d).forEach((fields, i) => {
    const shown = flat(renderedText[i] ?? '');
    for (const f of fields) {
      if (f && !shown.includes(flat(f))) out.push({ id: 'C7', where: `slide ${i + 1}`, detail: `not on the rendered slide: "${f.slice(0, 80)}"` });
    }
  });
  return out;
}
