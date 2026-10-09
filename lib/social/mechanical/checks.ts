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
 *        F5 the caption's "Source:" line built by code (spec §6 #5)
 *   B. Pass/fail checks (each failure carries what happens next; see
 *      FAILURE_ACTION):
 *        C1 character limits
 *        C2 quotation marks only around quote text from the brief
 *        C3 voice list (banned words, phrases, openers, "!", emoji)
 *        C4 no hashtags in the caption (the Source line is F5, built by code)
 *        C5 at most 2 background slides
 *        C6 photo credit and licence (credit present, allowed licence, no
 *           agency credit)
 *        C7 every text field reaches the rendered slide (dropped text)
 *        C8 no repetition within a slide: the same number, or a phrase of 4+
 *           words, in two of its fields (Tommy, 2026-10-06)
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

export type Fix = { id: 'F1' | 'F2' | 'F3' | 'F4' | 'F5'; where: string; before: string; after: string };

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

/** An outlet name for display: the brief's note in parentheses dropped ("Yahoo Creators (Noël Burgess)" → "Yahoo Creators"). */
const displayOutlet = (s: string) => s.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
const nameKey = (s: string) => displayOutlet(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Every brief ID the final post's claim tags rest on (chosen cover, slides, quote and number IDs, caption). */
export function citedIds(d: FilledDraft): string[] {
  const ids = [
    ...d.cover_options[d.chosen_cover - 1]!.facts,
    ...d.slides.flatMap((s) => [...s.headline.facts, ...(s.body?.facts ?? []), ...(s.quote_id ? [s.quote_id] : []), ...s.number_ids]),
    ...d.caption.facts,
  ];
  return [...new Set(ids)];
}

/**
 * F5 (Tommy, 2026-10-06; spec §6 #5): the outlets cited by the brief entries
 * in the final post's claim tags, deduped, in the order of the brief's
 * SOURCES list. Null when the tags cite no outlet.
 */
export function buildSourceLine(d: FilledDraft, brief: Brief): string | null {
  const entries = new Map<string, string[]>([
    ...[...brief.facts, ...brief.background].map((f) => [f.id, f.sources] as [string, string[]]),
    ...brief.quotes.map((q) => [q.id, q.via] as [string, string[]]),
    ...brief.numbers.map((n) => [n.id, n.sources] as [string, string[]]),
  ]);
  const cited = new Set(citedIds(d).flatMap((id) => entries.get(id) ?? []).map(nameKey).filter(Boolean));
  if (cited.size === 0) return null;
  const order = brief.sources.map((s) => displayOutlet(s.outlet));
  const named = order.filter((o) => cited.has(nameKey(o)));
  // Outlets cited by an entry but missing from SOURCES keep the order they were cited in.
  for (const id of citedIds(d)) for (const o of entries.get(id) ?? []) if (!named.some((n) => nameKey(n) === nameKey(o))) named.push(displayOutlet(o));
  const list = [...new Set(named)];
  const joined = list.length === 1 ? list[0]! : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
  return `Source: ${joined}.`;
}

/** Replace any "Source:" line the Writer wrote with the code-built one. */
export function withSourceLine(caption: string, line: string | null): string {
  const kept = caption.split('\n').filter((l) => !/^\s*Sources?:/i.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
  return line ? `${kept}\n\n${line}` : kept;
}

/** Apply A to a filled draft (the stages' text only; quote words untouched). F5 needs the brief. */
export function applySilentFixes(draft: FilledDraft, brief?: Brief): { draft: FilledDraft; fixes: Fix[] } {
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
  if (brief) d.caption.text = fix('caption Source line', d.caption.text, (c) => withSourceLine(c, buildSourceLine(d, brief)), 'F5');
  return { draft: d, fixes };
}

// ── B. Pass/fail checks ───────────────────────────────────────────────

export type CheckId = 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7' | 'C8';
export type Failure = { id: CheckId; where: string; detail: string };

/**
 * Spec §6 #7 LIMITS (characters). Copy budget (Tommy, 2026-10-08): the slide
 * copy drops 40%. Headline and body share one budget (`slide`, 60% of the old
 * 60 + 220), elastic within limits: the headline 15–45, the body up to 140,
 * together at most 168. Cover, quote and caption stay.
 */
export const LIMITS = { cover: 90, headline: 45, headlineMin: 15, body: 140, slide: 168, quote: 140, caption: 2200 } as const;

/** C1: character limits, with the exact overage (spec §6: never trimmed). */
export function checkLimits(d: FilledDraft): Failure[] {
  const out: Failure[] = [];
  const over = (where: string, text: string, max: number) => {
    if (text.length > max) out.push({ id: 'C1', where, detail: `${text.length} chars, limit ${max} (${text.length - max} over)` });
  };
  over('cover', d.cover, LIMITS.cover);
  d.slides.forEach((s, i) => {
    const at = `slide ${i + 2}`;
    over(`${at} headline`, s.headline.text, LIMITS.headline);
    if (s.headline.text.length < LIMITS.headlineMin) out.push({ id: 'C1', where: `${at} headline`, detail: `${s.headline.text.length} chars, at least ${LIMITS.headlineMin} (a headline, not a fragment)` });
    if (s.body) over(`${at} body`, s.body.text, LIMITS.body);
    const both = s.headline.text.length + (s.body?.text.length ?? 0);
    if (both > LIMITS.slide) out.push({ id: 'C1', where: `${at} headline + body`, detail: `${both} chars together, limit ${LIMITS.slide} (${both - LIMITS.slide} over): shorten either` });
    if (s.quote) over(`${at} quote`, s.quote.text, LIMITS.quote);
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

/** C4: no hashtags in the caption. */
export function checkCaption(d: FilledDraft): Failure[] {
  const tags = d.caption.text.match(/(^|\s)#[\p{L}_][\p{L}\p{N}_]*/gu);
  return tags ? [{ id: 'C4', where: 'caption', detail: `hashtags: ${tags.map((t) => t.trim()).join(' ')}` }] : [];
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
    // Article photos: the credit itself must be an allowed one (company, government, Commons).
    const v = classifyCredit({ caption: null, credit: photo.credit, page: null, organizations: brief.subjects.map((s) => s.name) });
    if (v.verdict !== 'allowed') out.push({ id: 'C6', where, detail: `article photo credit not allowed: ${v.reason}` });
  } else if (photo.source === 'official') {
    // Official images (photo spec §2): credited by code to a SUBJECTS company, "Image: <Company>".
    const company = photo.credit.replace(/^Image:\s*/, '');
    if (!/^Image:\s/.test(photo.credit) || !brief.subjects.some((s) => s.name === company)) out.push({ id: 'C6', where, detail: `official image credit isn't "Image: <a SUBJECTS company>": "${photo.credit}"` });
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
      ...(s.hook ? [s.hook.text] : []),
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

/** Numbers in a text, normalized ("$4.99" → "4.99", "1,000" → "1000", "38%" → "38"). */
export function numbersIn(text: string): string[] {
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, ''));
}

/** Word 4-grams of a text, lowercased. */
function phrases4(text: string): string[] {
  const w = text.toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter(Boolean);
  return w.length < 4 ? [] : w.slice(0, -3).map((_, i) => w.slice(i, i + 4).join(' '));
}

/**
 * C8 (Tommy, 2026-10-06): every element on a slide adds something new. The
 * same number, or a phrase of four or more words, in two fields of one slide
 * (headline, body, quote, big number, its label) fails.
 */
/**
 * C8. The number check counts only values from the brief's NUMBERS entries,
 * never digits inside names ("Mistral Large 4", "GPT-6") (Tommy, 2026-10-06).
 */
export function checkRepetition(d: FilledDraft, brief: Brief): Failure[] {
  const briefNumbers = new Set(brief.numbers.flatMap((n) => numbersIn(n.value)));
  const out: Failure[] = [];
  d.slides.forEach((s, i) => {
    const fields: Array<[string, string]> = [
      ['headline', s.headline.text],
      ...(s.body ? [['body', s.body.text] as [string, string]] : []),
      ...(s.quote ? [['quote', s.quote.text] as [string, string]] : []),
      ...s.numbers.flatMap((n, k): Array<[string, string]> => [[`number ${k + 1}`, n.value], [`label ${k + 1}`, n.counts]]),
      // The Hook pass line is checked against its own slide too (Tommy, 2026-10-06).
      ...(s.hook ? [['hook', s.hook.text] as [string, string]] : []),
    ];
    const seenNum = new Map<string, string>();
    const seenPhrase = new Map<string, string>();
    for (const [name, text] of fields) {
      for (const n of new Set(numbersIn(text).filter((x) => briefNumbers.has(x)))) {
        const prev = seenNum.get(n);
        if (prev && prev !== name) out.push({ id: 'C8', where: `slide ${i + 2}`, detail: `the number ${n} is in both ${prev} and ${name}` });
        else seenNum.set(n, name);
      }
      for (const p of new Set(phrases4(text))) {
        const prev = seenPhrase.get(p);
        if (prev && prev !== name) out.push({ id: 'C8', where: `slide ${i + 2}`, detail: `"${p}" is in both ${prev} and ${name}` });
        else seenPhrase.set(p, name);
      }
    }
  });
  // One failure per slide and pair is enough for the Editor.
  return out.filter((f, k) => out.findIndex((g) => g.where === f.where && g.detail.split(' is in both ')[1] === f.detail.split(' is in both ')[1]) === k);
}

// ── Where the checks run ──────────────────────────────────────────────

/** C1–C5 and C8: the checks on text, run on the fixed draft. */
export function textChecks(d: FilledDraft, brief: Brief): Failure[] {
  return [...checkLimits(d), ...checkQuoteMarks(d, brief), ...checkVoice(d), ...checkCaption(d), ...checkBackground(d), ...checkRepetition(d, brief)];
}

/**
 * Hard text checks: still failing after the retry, or after the Fact-checker,
 * they stop the story. The rest (C3 voice, C4 hashtags, C5 background
 * slides) are style and become warnings on the review screen (Tommy,
 * 2026-10-06).
 */
export const HARD_CHECKS: ReadonlySet<CheckId> = new Set(['C1', 'C2']);

/**
 * The Writer's and Editor's code check (one retry, spec §7.1): on the first
 * submission every C1–C5 failure goes back to the model; on the retry only
 * the hard ones block, so style can't sink a draft.
 */
export function draftTextFailures(filled: FilledDraft, brief: Brief, attempt: number, stage: 'writer' | 'editor' = 'writer'): Failure[] {
  // C8 sends the draft back to the Editor once (Tommy, 2026-10-06); the Writer is told the rule in its prompt.
  const all = textChecks(applySilentFixes(filled, brief).draft, brief).filter((f) => f.id !== 'C8' || stage === 'editor');
  return attempt <= 1 ? all : all.filter((f) => HARD_CHECKS.has(f.id));
}
