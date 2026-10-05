/**
 * The Reporter's brief (spec §4, §4.2a, §5.1; prompts file §1 OUTPUT):
 * plain-text sections → a typed Brief, with validation.
 *
 * Parsing is lenient about layout (bullets, "—" vs "|" separators, blank
 * lines) and strict about what later stages rely on: unique IDs, every
 * fact sourced, NUMBERS in the approved format, quotes with a speaker,
 * and THE NEWS / WHY IT MATTERS citing IDs that exist.
 */

export const NUMBER_TYPES = ['money', 'count', 'percent', 'duration', 'date', 'other'] as const;
export type NumberType = (typeof NUMBER_TYPES)[number];

export type BriefFact = {
  id: string; // F1… or B1…
  text: string;
  sources: string[];
  /** Set when the fact is marked [CLAIM: X says] (interested-party rule). */
  claimBy: string | null;
};

export type BriefQuote = {
  id: string; // Q1…
  /** Exact quote text, without the surrounding quotation marks. */
  text: string;
  speaker: string;
  /** Where it was said and via which outlet, as written. */
  where: string | null;
  singleSource: boolean;
  cutOff: boolean;
};

export type BriefNumber = {
  id: string; // N1…
  /** Exactly as the source writes it ("nearly $21 billion"). */
  value: string;
  type: NumberType;
  counts: string;
  source: string;
};

export type BriefPhoto = { caption: string | null; credit: string | null; url: string | null };
export type BriefSource = { outlet: string; date: string | null; url: string | null };
export type BriefSubject = { name: string; role: string | null };
export type BriefTerm = { name: string; description: string };

export type Brief = {
  singleStory: boolean;
  news: { text: string; ids: string[] };
  whyItMatters: Array<{ text: string; ids: string[] }>;
  facts: BriefFact[];
  background: BriefFact[];
  quotes: BriefQuote[];
  numbers: BriefNumber[];
  terms: BriefTerm[];
  subjects: BriefSubject[];
  events: string[];
  articlePhotos: BriefPhoto[];
  notAnswered: string[];
  sources: BriefSource[];
  fetchFailures: string[];
};

export type BriefError = { section: string; message: string };

export class BriefParseError extends Error {
  constructor(readonly errors: BriefError[]) {
    super(`brief invalid: ${errors.map((e) => `${e.section}: ${e.message}`).join('; ')}`);
  }
}

/** Section headings, as the prompt writes them, → keys. Order doesn't matter. */
const SECTIONS: Array<[RegExp, string]> = [
  [/^SINGLE STORY\b/i, 'SINGLE STORY'],
  [/^THE NEWS\b/i, 'THE NEWS'],
  [/^WHY IT MATTERS\b/i, 'WHY IT MATTERS'],
  [/^FACTS\b/i, 'FACTS'],
  [/^BACKGROUND\b/i, 'BACKGROUND'],
  [/^QUOTES\b/i, 'QUOTES'],
  [/^NUMBERS\b/i, 'NUMBERS'],
  [/^TERMS\b/i, 'TERMS'],
  [/^SUBJECTS\b/i, 'SUBJECTS'],
  [/^EVENTS\b/i, 'EVENTS'],
  [/^ARTICLE PHOTOS\b/i, 'ARTICLE PHOTOS'],
  [/^NOT ANSWERED\b/i, 'NOT ANSWERED'],
  [/^SOURCES\b/i, 'SOURCES'],
  [/^FETCH FAILURES\b/i, 'FETCH FAILURES'],
];

export const REQUIRED_SECTIONS = ['SINGLE STORY', 'THE NEWS', 'FACTS', 'SOURCES'];

/** Split into sections. A heading line may carry content after its colon. */
function splitSections(raw: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of raw.replace(/\r\n/g, '\n').split('\n')) {
    const trimmed = line.trim().replace(/^#+\s*/, '').replace(/^\*\*(.+?)\*\*/, '$1');
    const hit = SECTIONS.find(([re]) => re.test(trimmed));
    // Headings are written in capitals ("THE NEWS:", "WHY IT MATTERS (sourced only):"),
    // so a sentence that starts with "Background…" is content, not a heading.
    const heading = trimmed.match(/^[A-Z][A-Z ]*[A-Z](\s*\([^)]*\))?\s*(:|$)\s*/);
    // The tested prompt says "list fetch failures separately", so a
    // "Fetch failures:" line inside SOURCES opens that list in any case.
    const fetchFailures = trimmed.match(/^(?:[-*•]\s*)?(?:fetch failures?|failed fetches|failed to fetch)\s*(?:\([^)]*\))?\s*:\s*/i);
    if (fetchFailures) {
      current = 'FETCH FAILURES';
      const after = trimmed.slice(fetchFailures[0].length);
      out.set(current, after ? [after] : []);
      continue;
    }
    if (hit && heading) {
      current = hit[1];
      const after = trimmed.slice(heading[0].length);
      out.set(current, after ? [after] : []);
      continue;
    }
    if (current && trimmed) out.get(current)!.push(trimmed);
  }
  return out;
}

const NONE = /^(none|n\/a|-|—)\.?$/i;

/** Section lines with bullets stripped, "none" dropped. */
function items(lines: string[] | undefined): string[] {
  return (lines ?? []).map((l) => l.replace(/^[-*•]\s+/, '').trim()).filter((l) => l && !NONE.test(l));
}

const ID_REF = /\b([FBQN]\d+)\b/g;
const refs = (text: string) => [...new Set([...text.matchAll(ID_REF)].map((m) => m[1]!))];

/** "F1: text (src, src)" or "F1. text (src)" */
function parseFact(line: string, prefix: 'F' | 'B', errors: BriefError[], section: string): BriefFact | null {
  const m = line.match(new RegExp(`^(${prefix}\\d+)\\s*[:.)\\-]\\s*(.+)$`));
  if (!m) {
    errors.push({ section, message: `line has no ${prefix}# id: "${line.slice(0, 60)}"` });
    return null;
  }
  let text = m[2]!.trim();
  let sources: string[] = [];
  const src = text.match(/\(([^()]*)\)\s*\.?$/);
  if (src) {
    sources = src[1]!.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    text = text.slice(0, src.index).trim();
  }
  const claim = text.match(/\[CLAIM:\s*([^\]]+?)\s+says\]/i);
  return { id: m[1]!, text, sources, claimBy: claim ? claim[1]!.trim() : null };
}

/** 'Q1: "exact text" — Speaker, where (via Outlet) ⚠ [cut off]' */
function parseQuote(line: string, errors: BriefError[]): BriefQuote | null {
  const m = line.match(/^(Q\d+)\s*[:.)\-]\s*["“](.+)["”]\s*(?:[—–-]|\|)\s*(.+)$/);
  if (!m) {
    errors.push({ section: 'QUOTES', message: `expected Q#: "quote" — speaker: "${line.slice(0, 60)}"` });
    return null;
  }
  let rest = m[3]!.trim();
  const singleSource = rest.includes('⚠');
  const cutOff = /\[cut off\]/i.test(rest);
  rest = rest.replace(/⚠/g, '').replace(/\[cut off\]/gi, '').replace(/\[\s*\]/g, '').trim().replace(/[,;]$/, '');
  const comma = rest.indexOf(',');
  const speaker = (comma === -1 ? rest : rest.slice(0, comma)).trim();
  const where = comma === -1 ? null : rest.slice(comma + 1).trim() || null;
  return { id: m[1]!, text: m[2]!, speaker, where, singleSource, cutOff };
}

/** "N1: value | type | what it counts | source" (approved 2026-10-04). */
function parseNumber(line: string, errors: BriefError[]): BriefNumber | null {
  const m = line.match(/^(N\d+)\s*[:.)\-]?\s*(.+)$/);
  const parts = m ? m[2]!.split('|').map((p) => p.trim()) : [];
  if (!m || parts.length !== 4 || parts.some((p) => !p)) {
    errors.push({ section: 'NUMBERS', message: `expected "N#: value | type | what it counts | source": "${line.slice(0, 70)}"` });
    return null;
  }
  const type = parts[1]!.toLowerCase();
  if (!(NUMBER_TYPES as readonly string[]).includes(type)) {
    errors.push({ section: 'NUMBERS', message: `${m[1]} has type "${parts[1]}"; allowed: ${NUMBER_TYPES.join(', ')}` });
    return null;
  }
  return { id: m[1]!, value: parts[0]!, type: type as NumberType, counts: parts[2]!, source: parts[3]! };
}

const pipeOrDash = (line: string) => line.split(/\s+\|\s+|\s+[—–]\s+/).map((p) => p.trim());

function parseSubject(line: string): BriefSubject {
  const paren = line.match(/^(.+?)\s*\((.+)\)$/);
  if (paren) return { name: paren[1]!.trim(), role: paren[2]!.trim() };
  const [name, ...role] = pipeOrDash(line);
  const colon = !role.length ? line.match(/^([^:]+):\s*(.+)$/) : null;
  if (colon) return { name: colon[1]!.trim(), role: colon[2]!.trim() };
  return { name: name!, role: role.join(' | ') || null };
}

function parseTerm(line: string, errors: BriefError[]): BriefTerm | null {
  const m = line.match(/^([^:]+?):\s*(.+)$/) ?? line.match(/^(.+?)\s+[—–]\s+(.+)$/);
  if (!m) {
    errors.push({ section: 'TERMS', message: `expected "Name: description": "${line.slice(0, 60)}"` });
    return null;
  }
  return { name: m[1]!.trim(), description: m[2]!.trim() };
}

const nullable = (s: string | undefined) => (s && !/^\(?(none|no caption|no credit|n\/a|unknown)\)?$/i.test(s) ? s : null);

function parsePhoto(line: string): BriefPhoto {
  const [caption, credit, url] = line.split('|').map((p) => p.trim());
  return { caption: nullable(caption), credit: nullable(credit), url: nullable(url) };
}

function parseSource(line: string): BriefSource {
  const url = line.match(/https?:\/\/\S+/)?.[0]?.replace(/[),.]+$/, '') ?? null;
  const head = (url ? line.replace(url, '') : line).replace(/[,\s]+$/, '').trim();
  const [outlet, ...rest] = head.split(',').map((p) => p.trim());
  return { outlet: outlet ?? head, date: rest.join(', ') || null, url };
}

export function parseBrief(raw: string): Brief {
  const errors: BriefError[] = [];
  const s = splitSections(raw);
  for (const name of REQUIRED_SECTIONS) {
    if (!s.has(name)) errors.push({ section: name, message: 'section missing' });
  }

  const single = (s.get('SINGLE STORY') ?? []).join(' ').trim().toLowerCase();
  if (s.has('SINGLE STORY') && !/^(yes|no)\b/.test(single)) {
    errors.push({ section: 'SINGLE STORY', message: `expected yes/no, got "${single}"` });
  }

  const newsText = (s.get('THE NEWS') ?? []).join(' ').trim();
  const whyItMatters = items(s.get('WHY IT MATTERS')).map((t) => ({ text: t, ids: refs(t) }));
  const facts = items(s.get('FACTS')).map((l) => parseFact(l, 'F', errors, 'FACTS')).filter((f): f is BriefFact => !!f);
  const background = items(s.get('BACKGROUND')).map((l) => parseFact(l, 'B', errors, 'BACKGROUND')).filter((f): f is BriefFact => !!f);
  const quotes = items(s.get('QUOTES')).map((l) => parseQuote(l, errors)).filter((q): q is BriefQuote => !!q);
  const numbers = items(s.get('NUMBERS')).map((l) => parseNumber(l, errors)).filter((n): n is BriefNumber => !!n);
  const terms = items(s.get('TERMS')).map((l) => parseTerm(l, errors)).filter((t): t is BriefTerm => !!t);
  const sourcesLines = items(s.get('SOURCES'));

  const brief: Brief = {
    singleStory: single.startsWith('yes'),
    news: { text: newsText, ids: refs(newsText) },
    whyItMatters,
    facts,
    background,
    quotes,
    numbers,
    terms,
    subjects: items(s.get('SUBJECTS')).map(parseSubject),
    events: items(s.get('EVENTS')),
    articlePhotos: items(s.get('ARTICLE PHOTOS')).map(parsePhoto),
    notAnswered: items(s.get('NOT ANSWERED')),
    sources: sourcesLines.map(parseSource),
    fetchFailures: items(s.get('FETCH FAILURES')),
  };

  // ── Validation ──
  if (s.has('THE NEWS') && !newsText) errors.push({ section: 'THE NEWS', message: 'empty' });
  if (s.has('FACTS') && facts.length === 0) errors.push({ section: 'FACTS', message: 'no facts' });
  if (s.has('SOURCES') && brief.sources.length === 0) errors.push({ section: 'SOURCES', message: 'no sources' });
  if (background.length > 2) errors.push({ section: 'BACKGROUND', message: `max 2, got ${background.length}` });

  const ids = [...facts, ...background, ...quotes, ...numbers].map((x) => x.id);
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) errors.push({ section: 'IDS', message: `duplicate id ${id}` });
    seen.add(id);
  }
  for (const f of [...facts, ...background]) {
    if (f.sources.length === 0) errors.push({ section: f.id.startsWith('B') ? 'BACKGROUND' : 'FACTS', message: `${f.id} has no source` });
  }
  for (const q of quotes) {
    if (!q.speaker) errors.push({ section: 'QUOTES', message: `${q.id} has no speaker` });
  }
  for (const [where, list] of [['THE NEWS', brief.news.ids], ['WHY IT MATTERS', whyItMatters.flatMap((w) => w.ids)]] as const) {
    for (const id of list) {
      if (!seen.has(id)) errors.push({ section: where, message: `cites ${id}, which isn't in the brief` });
    }
  }

  if (errors.length > 0) throw new BriefParseError(errors);
  return brief;
}

/** Lookup by ID for copy-by-ID (spec §4.2a). */
export function briefIndex(brief: Brief) {
  return {
    quote: new Map(brief.quotes.map((q) => [q.id, q])),
    number: new Map(brief.numbers.map((n) => [n.id, n])),
    fact: new Map([...brief.facts, ...brief.background].map((f) => [f.id, f])),
  };
}
