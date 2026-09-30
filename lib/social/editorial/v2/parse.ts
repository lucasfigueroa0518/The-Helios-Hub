/**
 * Plain-text-with-labeled-lines parser for the v2 stage handoffs.
 *
 * Rules from docs/HELIOS-PIPELINE-V2-HANDOFF.md §Handoff formats:
 *   - Labels are uppercase and followed by a colon.
 *   - Parse ONLY the known labels listed in this section. A line like "AI:"
 *     inside a caption or story is text, not a label.
 *   - A value may run onto following lines until the next known label.
 *   - A line the model didn't need may be missing entirely. Treat that as
 *     empty, not as an error.
 *
 * Real Sonnet output often sneaks in markdown around labels ("**SOURCES:**",
 * "## SOURCES:") and horizontal-rule divider lines ("---") between sections.
 * `normalizeMarkdown` strips those before any downstream regex sees the text
 * so the plain-text contract holds even when the model reaches for markdown.
 */

/**
 * Strip markdown decoration from labeled lines and drop pure-divider lines,
 * so the label-recognition regexes downstream see the plain-text form.
 *
 *   "**SOURCES:**"            → "SOURCES:"
 *   "**SOURCES:** value"      → "SOURCES: value"
 *   "**SOURCES: value**"      → "SOURCES: value"
 *   "## SOURCES:"             → "SOURCES:"
 *   "### SOURCES: value"      → "SOURCES: value"
 *   "---" (any run of 3+ dashes/equals/asterisks/underscores) → dropped
 *
 * Bold/italic markers inside body text (e.g. inside a STORY paragraph) are
 * left alone. Only leading/trailing decoration is stripped.
 */
export function normalizeMarkdown(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*[-—_=*]{3,}\s*$/.test(line))
    .map((line) => {
      // Strip leading heading marker: "## LABEL:" or "### FOO" → "LABEL:" / "FOO"
      let out = line.replace(/^\s*#{1,6}\s+/, '');
      // Strip ALL bold markers on the line. This covers every shape the
      // model might use: "**LABEL:**", "**LABEL:** value", "**LABEL: value**",
      // and stray "**word**" inside body text. Downstream renderers don't
      // support markdown bold anyway.
      out = out.replace(/\*\*/g, '');
      return out;
    })
    .join('\n');
}

/* ── Reporter output (BRIEF) ─────────────────────────────────────────── */

export type Brief = {
  singleStory: { yes: boolean; sourceNote: string };
  news: string;
  story: string;
  terms: BriefTerm[];
  images: BriefImage[];
  sources: BriefSource[];
};

export type BriefTerm = { name: string; description: string };
export type BriefImage = { number: number; description: string; credit: string; link: string };
export type BriefSource = { outlet: string; publishedAt: string; url: string };

const BRIEF_LABELS = new Set([
  'SINGLE STORY',
  'THE NEWS',
  'THE STORY',
  'TERMS',
  'IMAGES',
  'SOURCES',
]);

export function parseBrief(text: string): Brief {
  const normalized = normalizeMarkdown(text);
  const sections = splitByLabels(normalized, BRIEF_LABELS);
  const singleRaw = sections.get('SINGLE STORY') ?? '';
  const singleFirstLine = singleRaw.split('\n')[0] ?? '';
  const isSingle = /^\s*yes/i.test(singleFirstLine);
  const sourceNote = singleFirstLine.replace(/^\s*(yes|no)\s*[,.:-]?\s*/i, '').trim();

  return {
    singleStory: { yes: isSingle, sourceNote },
    news: (sections.get('THE NEWS') ?? '').trim(),
    story: (sections.get('THE STORY') ?? '').trim(),
    terms: parseTerms(sections.get('TERMS') ?? ''),
    images: parseImages(sections.get('IMAGES') ?? ''),
    sources: parseSources(sections.get('SOURCES') ?? ''),
  };
}

function parseTerms(text: string): BriefTerm[] {
  const out: BriefTerm[] = [];
  for (const rawLine of text.split('\n')) {
    const line = stripListMarker(rawLine);
    if (!line) continue;
    const match = line.match(/^([^:]+):\s*(.+)$/);
    if (match) out.push({ name: match[1]!.trim(), description: match[2]!.trim() });
  }
  return out;
}

function parseImages(text: string): BriefImage[] {
  if (/^\s*none found\s*$/i.test(text.trim())) return [];
  const out: BriefImage[] = [];
  const chunks = text.split(/\n(?=IMAGE\s+\d+)/i);
  for (const chunk of chunks) {
    const match = chunk.match(/^IMAGE\s+(\d+):\s*([\s\S]*)$/i);
    if (!match) continue;
    const number = Number(match[1]);
    const body = match[2]!.trim();
    const creditMatch = body.match(/Credit:\s*([^\n]+?)(?:\.\s*Link:|Link:|$)/i);
    const linkMatch = body.match(/Link:\s*(\S+)/i);
    let description = body;
    if (creditMatch) description = body.slice(0, creditMatch.index).trim().replace(/\.$/, '');
    out.push({
      number,
      description,
      credit: (creditMatch?.[1] ?? '').trim(),
      link: (linkMatch?.[1] ?? '').trim(),
    });
  }
  return out;
}

function parseSources(text: string): BriefSource[] {
  const out: BriefSource[] = [];
  for (const rawLine of text.split('\n')) {
    let line = stripListMarker(rawLine);
    if (!line) continue;
    // Scrub any punctuation residue left from a malformed list marker
    // (e.g. a "1." where our stripper only ate the "1" would leave ".").
    line = line.replace(/^[.,;\s]+/, '').trim();
    if (!line) continue;

    // 1. URL — first http(s) token, strip trailing sentence punctuation.
    const urlMatch = line.match(/(https?:\/\/\S+)/);
    const url = urlMatch?.[1]?.replace(/[.,;)\]]+$/, '') ?? '';

    // 2. Date — first date-shaped token anywhere in the line.
    const dateMatch = line.match(
      /\b(?:\d{4}-\d{2}-\d{2}|\d{4}\/\d{2}\/\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?)\b/i,
    );
    const publishedAt = dateMatch?.[0]?.trim() ?? '';

    // 3. Outlet — take the line, drop URL + date, drop everything after
    // the first em/en dash (that's a byline: "Outlet — Ryan Cole"),
    // then take the first comma-separated segment as the outlet name.
    let outletBlob = line;
    if (url) outletBlob = outletBlob.replace(url, '');
    if (publishedAt) outletBlob = outletBlob.replace(publishedAt, '');
    outletBlob = outletBlob.split(/\s+[—–]\s+/)[0] ?? outletBlob;
    const parts = outletBlob.split(',').map((p) => p.trim()).filter(Boolean);
    const outlet = (parts[0] ?? '').replace(/^[.,;\s]+|[.,;\s]+$/g, '');

    out.push({ outlet, publishedAt, url });
  }
  return out;
}

/**
 * Strip common list markers from the start of a line, keeping the rest
 * intact. Handles: "- ", "* ", "• ", "1. ", "1) ", "1.  " (extra spaces),
 * plus any leading whitespace. Multi-char digit markers like "12." are
 * consumed fully, which the earlier `[-*•\\d.]` character class did not —
 * that class matched only ONE character, leaving the "." behind on "1.".
 */
function stripListMarker(line: string): string {
  return line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim();
}

/* ── Writer / Editor output (DRAFT / EDITED POST) ────────────────────── */

export type ParsedPost = {
  cover: ParsedCover;
  slides: ParsedSlide[];
  follow: string;
  editNotes: string[] | null;
  /**
   * Optional OUTLINE the Writer emitted before its slides (2026-09-29
   * late; expanded to content-aware 2026-09-29 late second pass). One
   * entry per story slide, in order, with the kind PLUS the actual
   * short content that will render on that slide. Content-aware fields
   * exist so `validateOutline` can reject an outline whose non-text
   * kinds carry content that already busts a limit (a landing NOTE
   * over 60 chars, a quote over 140, a BIG NUMBER over 12). Prior
   * behavior approved a kind on judgment and then the Editor was
   * forced to convert it to text to fit — breaking rhythm.
   */
  outline?: Array<{
    position: number;
    kind: string;
    beat: string;
    headline?: string;
    note?: string;
    bigNumber?: string;
    numberNote?: string;
    secondNumber?: string;
    secondNote?: string;
    quote?: string;
    quoteBy?: string;
  }>;
};

export type ParsedCover =
  | { kind: 'draft'; options: CoverOption[]; chosen: number; text: string; highlight: string; image: string }
  | { kind: 'edited'; text: string; highlight: string; image: string };

export type CoverOption = { framework: string; text: string };

export type ParsedSlide = {
  position: number;
  headline?: string;
  body?: string;
  note?: string;
  bigNumber?: string;
  numberNote?: string;
  secondNumber?: string;
  secondNote?: string;
  quote?: string;
  quoteBy?: string;
  highlight?: string;
  image?: string;
};

const POST_LABELS = new Set([
  'COVER OPTIONS',
  'CHOSEN',
  'COVER',
  'COVER HIGHLIGHT',
  'COVER IMAGE',
  'HEADLINE',
  'BODY',
  'NOTE',
  'BIG NUMBER',
  'NUMBER NOTE',
  'SECOND NUMBER',
  'SECOND NOTE',
  'QUOTE',
  'QUOTE BY',
  'HIGHLIGHT',
  'IMAGE',
  'FOLLOW',
  'EDIT NOTES',
]);

export function parseDraft(text: string): ParsedPost {
  return parsePost(text, 'draft');
}

export function parseEditedPost(text: string): ParsedPost {
  return parsePost(text, 'edited');
}

/**
 * Parse the OUTLINE: block the Writer emits before its slides (content-
 * aware, 2026-09-29 late second pass). One line per slide; kind + the
 * actual short content that will render on that slide as named fields:
 *
 *   SLIDE 2: text — <beat sentence>
 *   SLIDE 3: landing — HEADLINE: <≤60> | NOTE: <≤60>
 *   SLIDE 4: quote — QUOTE: "<verbatim ≤140>" | BY: <who ≤60>
 *   SLIDE 5: stat — HEADLINE: <≤60> | BIG: <≤12> | NOTE: <≤60>
 *   SLIDE 6: split_stat — HEADLINE: <≤60> | BIG: <≤12> | NOTE: <≤60> | SECOND: <≤12> | SECOND NOTE: <≤60>
 *   SLIDE 7: image — <beat>
 *
 * The named fields use `KEY: value | KEY: value` — pipe-separated so
 * a value can contain hyphens or em dashes without collision. Trailing
 * quotes on QUOTE are stripped.
 */
function parseOutlineBlock(text: string): NonNullable<ParsedPost['outline']> | undefined {
  // Pick the LAST OUTLINE: block. The Writer sometimes drafts an initial
  // outline, self-reviews it in prose, and emits a revised OUTLINE block
  // after. Only the final revision counts. Prompt asks for one block; the
  // parser has to tolerate stragglers.
  const allMatches = [...text.matchAll(/(^|\n)OUTLINE:\s*\n([\s\S]*?)(?=\n(?:COVER OPTIONS|COVER):|$)/g)];
  const m = allMatches.length > 0 ? allMatches[allMatches.length - 1]! : null;
  if (!m) return undefined;
  const block = m[2] ?? '';
  const entries: NonNullable<ParsedPost['outline']> = [];
  const lineRe = /^\s*SLIDE\s+(\d+)\s*:\s*([a-z_]+)\s*[-—–:]\s*(.+?)\s*$/gmi;
  let mm: RegExpExecArray | null;
  while ((mm = lineRe.exec(block)) !== null) {
    const position = Number(mm[1]);
    const kind = mm[2]!.toLowerCase();
    let rest = mm[3]!.trim();
    // Strip the fact-first `answers Q?` annotation the Writer adds
    // between the kind and the content: "SLIDE 3: landing — answers Q4 —
    // HEADLINE: …". Everything up to and including the second em/en-dash
    // (or " — ") when it starts with `answers Q\d+` is annotation, not
    // content.
    const annotationRe = /^answers\s+Q\d+\s*[-—–]\s*/i;
    if (annotationRe.test(rest)) rest = rest.replace(annotationRe, '').trim();
    const entry: NonNullable<ParsedPost['outline']>[number] = { position, kind, beat: '' };
    if (kind === 'text' || kind === 'image') {
      entry.beat = rest;
    } else {
      // Named-field format. The Writer sometimes emits a short prose
      // "beat sentence" between the kind separator and the first KEY:
      // pair ("SLIDE 3: stat — <beat>. HEADLINE: X | BIG: Y | NOTE: Z").
      // Scan for known keys and use their positions as split boundaries,
      // rather than a naive `|` split that would treat the beat text as
      // part of the first "key".
      const KNOWN_KEYS = [
        'headline', 'body', 'note', 'number\\s+note', 'quote', 'quote\\s+by', 'by',
        'big', 'big\\s+number', 'second', 'second\\s+number', 'second\\s+note',
        'image',
      ];
      const keyRe = new RegExp(`\\b(${KNOWN_KEYS.join('|')})\\s*:\\s*`, 'gi');
      const fields = new Map<string, string>();
      const matches = [...rest.matchAll(keyRe)];
      for (let mi = 0; mi < matches.length; mi += 1) {
        const mk = matches[mi]!;
        const key = mk[1]!.toLowerCase().replace(/\s+/g, ' ').trim();
        const start = (mk.index ?? 0) + mk[0].length;
        const end = mi + 1 < matches.length ? (matches[mi + 1]!.index ?? rest.length) : rest.length;
        let value = rest.slice(start, end).trim().replace(/\|\s*$/, '').trim();
        // Strip surrounding quotes (curly or straight) from the value.
        value = value.replace(/^[“”"'](.*)[“”"']$/u, '$1').trim();
        fields.set(key, value);
      }
      const g = (k: string): string | undefined => fields.get(k) || undefined;
      entry.headline = g('headline');
      entry.note = g('note');
      entry.bigNumber = g('big') ?? g('big number');
      entry.numberNote = g('number note') ?? g('note');
      entry.secondNumber = g('second') ?? g('second number');
      entry.secondNote = g('second note');
      entry.quote = g('quote');
      entry.quoteBy = g('by') ?? g('quote by');
      // beat is a synthesized description for logging; use headline or quote.
      entry.beat = entry.headline ?? entry.quote ?? rest;
    }
    entries.push(entry);
  }
  return entries.length > 0 ? entries : undefined;
}

function parsePost(rawText: string, kind: 'draft' | 'edited'): ParsedPost {
  const rawNormalized = normalizeMarkdown(rawText);
  // Extract the OUTLINE block (Writer only; Editor doesn't emit one) and
  // remove it from the text before scanning for SLIDE / FOLLOW boundaries
  // — otherwise the OUTLINE's "FOLLOW:" line would be matched as the post's
  // real FOLLOW, truncating the last slide's chunk to nothing.
  const outline = parseOutlineBlock(rawNormalized);
  // Strip every OUTLINE: block (last-wins semantics for parsing content
  // already covered above; here we just need every OUTLINE removed from
  // the text so SLIDE-lines inside those blocks aren't treated as real
  // slide sections).
  const outlineMatches = [...rawNormalized.matchAll(/(^|\n)OUTLINE:\s*\n([\s\S]*?)(?=\n(?:COVER OPTIONS|COVER):|$)/g)];
  let text = rawNormalized;
  for (let i = outlineMatches.length - 1; i >= 0; i -= 1) {
    const om = outlineMatches[i]!;
    const start = om.index ?? 0;
    text = text.slice(0, start) + text.slice(start + om[0].length);
  }
  // Split by "SLIDE N" boundaries first — everything before the first SLIDE
  // is the cover header block; everything after is per-slide sections.
  // Skip "SLIDE 2:" (outline syntax, "SLIDE 2: <kind> — <beat>") — real
  // slide boundaries start their own line without a colon after the number.
  const slideRe = /(^|\n)SLIDE\s+(\d+)\b(?!\s*:)/g;
  const boundaries: Array<{ position: number; textStart: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = slideRe.exec(text)) !== null) {
    // Skip past the "SLIDE N" line itself.
    const lineEnd = text.indexOf('\n', m.index + m[0].length);
    const textStart = lineEnd >= 0 ? lineEnd + 1 : text.length;
    boundaries.push({ position: Number(m[2]), textStart });
  }

  const coverBlockEnd = boundaries.length > 0
    ? text.lastIndexOf('\n', boundaries[0]!.textStart - 1)
    : text.length;
  // Detect FOLLOW / EDIT NOTES sections which live after the last slide.
  const followMatch = text.match(/(^|\n)FOLLOW:\s*([\s\S]*?)(?=\n(?:EDIT NOTES|COVER|SLIDE\s+\d+):|$)/);
  const editNotesMatch = text.match(/(^|\n)EDIT NOTES:\s*([\s\S]*)$/);

  const coverBlock = text.slice(0, coverBlockEnd);
  const cover = kind === 'draft'
    ? parseDraftCover(coverBlock)
    : parseEditedCover(coverBlock);

  // Slides: end of one slide is the start of the next, or FOLLOW/EDIT NOTES, or end of text.
  const slides: ParsedSlide[] = [];
  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i]!.textStart;
    let end: number;
    if (i + 1 < boundaries.length) end = boundaries[i + 1]!.textStart;
    else if (followMatch?.index !== undefined) end = followMatch.index;
    else if (editNotesMatch?.index !== undefined) end = editNotesMatch.index;
    else end = text.length;
    const chunk = text.slice(start, end);
    slides.push(parseSlideChunk(boundaries[i]!.position, chunk));
  }

  const follow = (followMatch?.[2] ?? '').trim();
  const editNotesRaw = (editNotesMatch?.[2] ?? '').trim();
  const editNotes = editNotesRaw
    ? (/^none\s*$/i.test(editNotesRaw)
      ? []
      : editNotesRaw.split('\n').map((l) => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean))
    : null;

  // (Outline was already extracted above and removed from `text` so
  // downstream slide/follow scanning isn't fooled by OUTLINE's FOLLOW: line.)

  return {
    cover: swapCoverPunctuation(cover),
    slides: slides.map(swapSlidePunctuation),
    follow: swapBannedPunctuation(follow) ?? '',
    editNotes,
    outline,
  };
}

/**
 * Deterministic banned-punctuation swap. Runs after parse so every
 * downstream stage (code checks, adapter, renderer) sees the compliant
 * form. Sonnet self-deceives on em-dash rewrites (2026-09-29 batch
 * story 1: EDIT NOTES claimed "replaced with a comma" but returned the
 * em-dash form; 2 Haiku CHECK ERRORS retries also failed). Solve
 * mechanically instead of prompt-wrestling.
 *
 * NOT applied to QUOTE / QUOTE BY — those stay verbatim per the "quotes
 * word for word" rule; a fact-check quote-verbatim miss is a legitimate
 * flag if the source itself uses an em dash.
 */
export function swapBannedPunctuation(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  return text
    // Spaced em dash → clean comma (" — " → ", "), bare em dash → comma
    .replace(/\s*—\s*/g, ', ')
    // Spaced en dash → clean hyphen (" – " → " - "), bare en dash → hyphen
    .replace(/\s*–\s*/g, ' - ')
    // Spaced double hyphen (" -- ") → clean comma. Leaves "AI-driven".
    .replace(/\s+--\s+/g, ', ');
}

function swapSlidePunctuation(s: ParsedSlide): ParsedSlide {
  return {
    ...s,
    headline: swapBannedPunctuation(s.headline),
    body: swapBannedPunctuation(s.body),
    note: swapBannedPunctuation(s.note),
    bigNumber: swapBannedPunctuation(s.bigNumber),
    numberNote: swapBannedPunctuation(s.numberNote),
    secondNumber: swapBannedPunctuation(s.secondNumber),
    secondNote: swapBannedPunctuation(s.secondNote),
    // quote + quoteBy intentionally NOT swapped — verbatim rule.
    highlight: swapBannedPunctuation(s.highlight),
  };
}

function swapCoverPunctuation(cover: ParsedCover): ParsedCover {
  if (cover.kind === 'draft') {
    return {
      ...cover,
      text: swapBannedPunctuation(cover.text) ?? '',
      highlight: swapBannedPunctuation(cover.highlight) ?? '',
      options: cover.options.map((o) => ({ ...o, text: swapBannedPunctuation(o.text) ?? '' })),
    };
  }
  return {
    ...cover,
    text: swapBannedPunctuation(cover.text) ?? '',
    highlight: swapBannedPunctuation(cover.highlight) ?? '',
  };
}

function parseDraftCover(block: string): ParsedCover {
  const options = parseCoverOptions(block);
  const chosen = Number((block.match(/(^|\n)CHOSEN:\s*(\d+)/) ?? [])[2] ?? 1);
  const highlight = extractLabel(block, 'COVER HIGHLIGHT') ?? '';
  const image = extractLabel(block, 'COVER IMAGE') ?? '';
  const chosenOption = options[chosen - 1] ?? options[0] ?? { framework: '', text: '' };
  return { kind: 'draft', options, chosen, text: chosenOption.text, highlight, image };
}

function parseEditedCover(block: string): ParsedCover {
  const text = extractLabel(block, 'COVER') ?? '';
  const highlight = extractLabel(block, 'COVER HIGHLIGHT') ?? '';
  const image = extractLabel(block, 'COVER IMAGE') ?? '';
  return { kind: 'edited', text, highlight, image };
}

function parseCoverOptions(block: string): CoverOption[] {
  const start = block.match(/(^|\n)COVER OPTIONS:\s*/);
  if (!start) return [];
  const from = start.index! + start[0].length;
  const nextLabelMatch = block.slice(from).match(/(^|\n)(CHOSEN|COVER HIGHLIGHT|COVER IMAGE|SLIDE\s+\d+|FOLLOW|EDIT NOTES):/);
  const to = nextLabelMatch ? from + nextLabelMatch.index! : block.length;
  const listBlock = block.slice(from, to);
  const options: CoverOption[] = [];
  for (const rawLine of listBlock.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(/^\d+\.\s*(?:\[([^\]]+)\]\s*)?(.+)$/);
    if (!m) continue;
    options.push({ framework: (m[1] ?? '').trim(), text: (m[2] ?? '').trim() });
  }
  return options;
}

function parseSlideChunk(position: number, chunk: string): ParsedSlide {
  return {
    position,
    headline: extractLabel(chunk, 'HEADLINE'),
    body: extractLabel(chunk, 'BODY'),
    note: extractLabel(chunk, 'NOTE'),
    bigNumber: extractLabel(chunk, 'BIG NUMBER'),
    numberNote: extractLabel(chunk, 'NUMBER NOTE'),
    secondNumber: extractLabel(chunk, 'SECOND NUMBER'),
    secondNote: extractLabel(chunk, 'SECOND NOTE'),
    quote: extractLabel(chunk, 'QUOTE'),
    quoteBy: extractLabel(chunk, 'QUOTE BY'),
    highlight: extractLabel(chunk, 'HIGHLIGHT'),
    image: extractLabel(chunk, 'IMAGE'),
  };
}

/* ── Caption output ──────────────────────────────────────────────────── */

export function parseCaption(text: string): string {
  // The single label CAPTION: introduces the whole payload. Everything after
  // it is the caption body verbatim, up to and INCLUDING the "Source:"
  // line — that's part of the caption per handoff §CAPTION. Anything after
  // the Source line (Haiku sometimes emits internal deliberation past it,
  // see 2026-09-29 pm Google re-run) gets stripped.
  const normalized = normalizeMarkdown(text);
  const match = normalized.match(/(^|\n)CAPTION:\s*([\s\S]*)$/);
  const body = match ? match[2]! : normalized;
  return swapBannedPunctuation(stripAfterSourceLine(body).trim()) ?? '';
}

/**
 * Cut anything after the "Source:" line — the caption ends there per the
 * handoff format. Case-insensitive, tolerates leading whitespace. If no
 * Source line exists, return the input unchanged.
 *
 * Exported for direct testing.
 */
export function stripAfterSourceLine(text: string): string {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*Source:/i.test(lines[i]!)) {
      return lines.slice(0, i + 1).join('\n');
    }
  }
  return text;
}

/* ── Fact-checker output ─────────────────────────────────────────────── */

export type FactCheckVerdict = 'PASS' | 'FLAGGED';
export type FactCheckFlagSize = 'SMALL' | 'BIG';
export type FactCheckFlag = {
  where: string;
  text: string;
  problem: string;
  sourcesSay: string;
  size: FactCheckFlagSize;
};
export type FactCheckResult = { verdict: FactCheckVerdict; flags: FactCheckFlag[] };

const FC_FLAG_LABELS = new Set(['WHERE', 'TEXT', 'PROBLEM', 'SOURCES SAY', 'SIZE']);

export function parseFactCheck(text: string): FactCheckResult {
  const normalized = normalizeMarkdown(text);
  const verdictMatch = normalized.match(/VERDICT:\s*(PASS|FLAGGED)/i);
  const verdict = (verdictMatch?.[1]?.toUpperCase() ?? 'PASS') as FactCheckVerdict;
  const flagsSection = normalized.match(/FLAGS:\s*([\s\S]*)$/i)?.[1] ?? '';
  // Split into per-flag records: each record starts at WHERE:, runs until next WHERE: or end.
  const records = flagsSection
    .split(/(?=^\s*WHERE:)/m)
    .map((r) => r.trim())
    .filter((r) => /^WHERE:/i.test(r));
  const flags: FactCheckFlag[] = records.map((record) => {
    const fields = splitByLabels(record, FC_FLAG_LABELS);
    return {
      where: (fields.get('WHERE') ?? '').trim(),
      text: (fields.get('TEXT') ?? '').trim(),
      problem: (fields.get('PROBLEM') ?? '').trim(),
      sourcesSay: (fields.get('SOURCES SAY') ?? '').trim(),
      size: /^\s*BIG/i.test(fields.get('SIZE') ?? '') ? 'BIG' : 'SMALL',
    };
  });
  return { verdict, flags };
}

/* ── Shared label-splitting helper ───────────────────────────────────── */

/**
 * Walk the text line by line. When a line starts with `LABEL:` for a label
 * in the known set, open that section. Otherwise, append to whichever
 * section is open. Returns `Map(label → value)` with keys in insertion order.
 */
function splitByLabels(text: string, knownLabels: Set<string>): Map<string, string> {
  const out = new Map<string, string>();
  let currentLabel: string | null = null;
  const buffer: string[] = [];
  const flush = () => {
    if (currentLabel !== null) {
      out.set(currentLabel, buffer.join('\n'));
      buffer.length = 0;
    }
  };
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z][A-Z0-9 ]{1,30}):\s?(.*)$/);
    if (m) {
      const label = m[1]!.trim();
      if (knownLabels.has(label)) {
        flush();
        currentLabel = label;
        if (m[2]) buffer.push(m[2]);
        continue;
      }
    }
    if (currentLabel !== null) buffer.push(line);
  }
  flush();
  return out;
}

/**
 * Extract a single labeled line's value. Value may run onto following lines
 * until the next known post-format label OR the next "SLIDE N" header
 * (which has no colon after N — a plain "SLIDE 2\n" line).
 */
function extractLabel(block: string, label: string): string | undefined {
  const re = new RegExp(
    `(^|\\n)${label.replace(/ /g, '\\s')}:\\s*([\\s\\S]*?)(?=\\n[A-Z][A-Z0-9 ]{1,30}:|\\nSLIDE\\s+\\d+\\b|$)`,
  );
  const m = block.match(re);
  if (!m) return undefined;
  const value = m[2]!.trim();
  return value.length > 0 ? value : undefined;
}
