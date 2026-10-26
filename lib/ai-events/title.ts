/**
 * Event title cleaner (plan M5): the listing title as it should read on a slide, the caption and the
 * public calendar. Pure and deterministic, no model.
 *
 *   - emoji, pictographs, decorative symbols and exclamation marks go (AE-15: no emoji, no "!")
 *   - `|` and `•` separate fragments; fragments that are only a city, a date or time, "in person",
 *     "free" or "hosted by …" are dropped wherever they sit; what is left joins with ": " (two) or ", "
 *   - leading and trailing date or city fragments after ":" or a spaced dash go ("Oct 28: …", "… - Boston")
 *   - bracketed fragments of the same kind go ("(Boston)", "[SF]", "(Oct 28)", "(In-Person)")
 *   - a trailing "@ venue" goes (the slide shows the venue on its own line)
 *   - ALL CAPS or all-lowercase titles become title case, keeping acronyms (AI, LLM, NYC…)
 *   - whitespace collapses; stray separators at either end go
 *
 * A city inside a name stays ("AI Tinkerers Boston", "Data Driven NYC"): only whole fragments are dropped.
 */

const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const DAYS = 'mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?';

/** Places a fragment may name on its own (the four metros and their usual localities, AE-02). */
const PLACES = [
  'boston', 'cambridge', 'somerville', 'kendall square', 'seaport', 'greater boston', 'boston ma', 'cambridge ma', 'massachusetts', 'ma',
  'miami', 'miami beach', 'wynwood', 'brickell', 'fort lauderdale', 'south florida', 'miami fl', 'florida', 'fl',
  'nyc', 'ny', 'new york', 'new york city', 'new york ny', 'manhattan', 'brooklyn', 'queens',
  'sf', 'san francisco', 'san francisco ca', 'sf bay area', 'bay area', 'silicon valley', 'palo alto', 'mountain view', 'san jose', 'oakland',
  'berkeley', 'menlo park', 'redwood city', 'sunnyvale', 'santa clara', 'california', 'ca',
];

/** Words that stay upper case when a title is re-cased. */
const ACRONYMS = new Set([
  'AI', 'ML', 'LLM', 'LLMS', 'GPT', 'AGI', 'NLP', 'RAG', 'MCP', 'API', 'APIS', 'GPU', 'GPUS', 'UX', 'UI', 'AR', 'VR', 'XR', 'IOT', 'B2B', 'B2C',
  'SAAS', 'CEO', 'CEOS', 'CTO', 'CTOS', 'VC', 'VCS', 'YC', 'MIT', 'NYU', 'UCSF', 'NYC', 'SF', 'LA', 'DC', 'US', 'USA', 'IRL', 'Q&A', 'AMA', 'DEI',
  'HR', 'PR', 'ROI', 'GTM', 'ML/AI', 'AI/ML', 'NYTW', 'SFTW', 'MA', 'FL', 'CA', 'NY',
]);
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'vs', 'with', 'x']);

const stripSymbols = (s: string) =>
  s
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\p{So}\u{FE0E}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu, ' ')
    .replace(/[!¡]+/g, ' ')
    .replace(/\*{1,3}|_{2,}|~{2,}/g, ' ');

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Trims stray separators and punctuation from both ends. */
const trimEnds = (s: string) => collapse(s).replace(/^[\s|•·:,;\-–—/]+/, '').replace(/[\s|•·:,;\-–—/]+$/, '').trim();

/** True when the fragment says nothing a slide needs: only a date or time, a place, or a format note. */
export function isFluffFragment(fragment: string): boolean {
  let s = ` ${fragment.toLowerCase().replace(/[()[\]{}]/g, ' ')} `;
  if (!/[a-z0-9]/.test(s)) return true;
  if (/^\s*(hosted|presented|organi[sz]ed|powered|sponsored)\s+by\b/.test(s)) return true;
  // Format notes.
  s = s.replace(/\b(?:in[- ]?person|irl|free|free event|rsvp(?: required)?|registration required|limited spots?|tickets?)\b/g, ' ');
  // Dates and times: "Oct 28", "October 28th, 2026", "10/28", "Thu", "6:30 PM ET", "6-9pm".
  s = s
    .replace(new RegExp(`\\b(${DAYS})\\b\\.?`, 'g'), ' ')
    .replace(new RegExp(`\\b(${MONTHS})\\b\\.?`, 'g'), ' ')
    .replace(/\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/g, ' ')
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:-|–|to)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/g, ' ')
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/g, ' ')
    .replace(/\b\d{1,2}(?:st|nd|rd|th)?\b/g, ' ')
    .replace(/\b20\d{2}\b/g, ' ')
    .replace(/\b(?:et|pt|est|edt|pst|pdt|ct|cst|cdt)\b/g, ' ')
    .replace(/\b(?:at|on|from|until|till|thru|through|in|the|@|edition)\b/g, ' ');
  const rest = collapse(s.replace(/[,.:;@&\-–—/+]/g, ' '));
  if (!rest) return true;
  return PLACES.includes(rest);
}

function recase(title: string): string {
  const letters = title.replace(/[^\p{L}]/gu, '');
  if (letters.length < 4) return title;
  const upper = letters.replace(/[^\p{Lu}]/gu, '').length / letters.length;
  const lower = letters.replace(/[^\p{Ll}]/gu, '').length / letters.length;
  if (upper < 0.8 && lower < 1) return title;
  let first = true;
  return title
    .split(' ')
    .map((word) => {
      const bare = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      const isFirst = first;
      if (bare) first = false;
      if (!bare) return word;
      if (ACRONYMS.has(bare.toUpperCase())) return word.replace(bare, bare.toUpperCase());
      if (/\d/.test(bare)) return word;
      if (!isFirst && SMALL_WORDS.has(bare.toLowerCase())) return word.toLowerCase();
      return word.replace(bare, bare[0]!.toUpperCase() + bare.slice(1).toLowerCase());
    })
    .join(' ');
}

/** Drops bracketed fragments that are only a place, a date or a format note. */
function dropBracketed(s: string): string {
  return s.replace(/\s*[([{]([^()[\]{}]*)[)\]}]/g, (whole, inner: string) => (isFluffFragment(inner) ? ' ' : whole));
}

export function cleanEventTitle(raw: string): string {
  const base = collapse(stripSymbols(raw ?? ''));
  let s = dropBracketed(base);

  // `|` and `•` fragments: drop the fluff anywhere, join the rest.
  const parts = s.split(/\s*[|•]\s*/).map((p) => trimEnds(p)).filter(Boolean);
  const kept = parts.filter((p) => !isFluffFragment(p));
  s = kept.length <= 1 ? (kept[0] ?? '') : kept.length === 2 ? `${kept[0]}: ${kept[1]}` : kept.join(', ');

  // Leading and trailing fragments after ":" or a spaced dash.
  const SEP = /(\s+[-–—]\s+|:\s+|\s+@\s+)/;
  let pieces = s.split(SEP);
  // pieces alternates text, separator, text…
  const trailingVenue = () => pieces.length >= 3 && /@/.test(pieces[pieces.length - 2]!) && pieces[pieces.length - 1]!.length <= 48;
  for (let guard = 0; guard < 8 && pieces.length >= 3; guard++) {
    if (isFluffFragment(pieces[0]!)) pieces = pieces.slice(2);
    else if (isFluffFragment(pieces[pieces.length - 1]!) || trailingVenue()) pieces = pieces.slice(0, -2);
    else break;
  }
  s = pieces.map((p) => (/^\s+[-—]\s+$/.test(p) ? ' – ' : p)).join('');

  // A leading bare date with no separator ("10/28 AI Breakfast", "Oct 28 AI Breakfast")…
  const BARE_DATE = `(?:(?:${DAYS})\\.?,?\\s+)?(?:(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+20\\d{2})?|\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?)`;
  s = s.replace(new RegExp(`^${BARE_DATE}\\b[,:]?\\s+`, 'i'), '');
  // …and a trailing one ("AI Breakfast Oct 28", "AI Breakfast 10/28").
  s = s.replace(new RegExp(`[\\s,]+(?:on\\s+)?${BARE_DATE}$`, 'i'), '');

  s = trimEnds(s.replace(/\(\s*\)|\[\s*\]/g, ' '));
  if (!s) s = trimEnds(base);
  return recase(s);
}

/** A name for a slide or caption line (organizer, venue): no emoji, no "!", collapsed. */
export function cleanName(raw: string | null | undefined): string {
  return trimEnds(stripSymbols(raw ?? ''));
}

/** Shortens `text` to at most `max` characters at a word boundary, with an ellipsis when cut. */
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:–—\-·]+$/, '')}…`;
}
