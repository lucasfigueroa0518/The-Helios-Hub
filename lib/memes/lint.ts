/**
 * Plain-code checks on what a meme prints (planning/Memes/UPGRADE_PLAN.md
 * U0): hedges, narrated speech, length, and names a casual follower would
 * not know. Each one is measured against Lucas's graded batch
 * (scripts/memes_eval.ts) before any of them may drop a meme. Pure, no
 * model calls.
 */
import { BLUE_CHIP_PLAYERS } from '@/lib/social-hub/blue-chip-players';
import type { Brief } from '@/lib/social/reporter/brief';

import type { SlotFill } from './fill';

/** Words that mark a story about harm, crime or the courts: the off-limits judge bites there (UPGRADE_V5 U5). */
export const INCIDENT = /\b(arrest\w*|charged|court|appeal|lawsuit|sue[sd]?|police|homicide|murder|death|died|kill\w*|crime|criminal|fraud\w*|investigat\w*|subpoena|indict\w*|harass\w*|abuse\w*|victim\w*)\b/i;

export type LintKind = 'hedge' | 'narration' | 'length' | 'obscure-name';
export type LintHit = { kind: LintKind; slot: string | null; match: string };

/** Reporting verbs and modal hedges: graded lines with one were good 29% of the time, 64% without. */
export const HEDGE = /\b(says|said|claims?|claimed|may|might|maybe|reportedly|allegedly|supposedly|according to)\b/i;

/** A line that narrates someone speaking instead of showing what happened ("Tell dinner…", "Announce…"). */
export const NARRATION = /^\s*["“]?(tell|say|says|announce|add|also say|explain|ask|admit|then admit|mention|so what|so are|so is)\b/i;

/**
 * Names and terms a casual follower of AI news knows without the article.
 * Blue-chip players are added from their own list; the story's headline is
 * added per meme (the follower sees it with the carousel).
 */
export const HOUSEHOLD_NAMES: readonly string[] = [
  'AI', 'AGI', 'API', 'APIs', 'CEO', 'CEOs', 'CFO', 'CTO', 'PhD', 'CV', 'GPU', 'GPUs', 'CPU', 'IPO', 'VC', 'VCs', 'HR', 'IT', 'PR', 'TV', 'OK',
  'GB', 'MB', 'TB', 'AM', 'PM', 'FAQ', 'URL', 'PDF', 'QR', 'ID', 'IQ', 'NYC', 'LA', 'SF', 'DM', 'DMs', 'LLM', 'LLMs', 'App', 'Store',
  'US', 'USA', 'U.S.', 'UK', 'U.K.', 'EU', 'UN', 'NZ', 'NASA', 'FBI', 'DOJ', 'FTC', 'SEC', 'IRS', 'Fed', 'Federal', 'Reserve', 'White', 'House', 'Pentagon', 'Congress', 'Senate', 'Supreme', 'Court',
  'Europe', 'European', 'America', 'American', 'Americans', 'China', 'Chinese', 'Japan', 'Japanese', 'India', 'Indian', 'Canada', 'Canadian', 'Australia', 'Australian',
  'Britain', 'British', 'Ireland', 'Irish', 'Singapore', 'Germany', 'German', 'France', 'French', 'Korea', 'Korean', 'Taiwan', 'Russia', 'New', 'Zealand', 'Kiwis',
  'Paris', 'London', 'Dublin', 'Tokyo', 'York', 'California', 'Silicon', 'Valley', 'Washington', 'Wall', 'Street', 'Hollywood',
  'iPhone', 'iPhones', 'iPad', 'Mac', 'MacBook', 'Windows', 'Android', 'Xbox', 'PlayStation', 'Nintendo', 'TikTok', 'YouTube', 'Netflix', 'Disney', 'Instagram', 'WhatsApp',
  'Facebook', 'Twitter', 'X', 'Reddit', 'Wikipedia', 'Uber', 'Spotify', 'Shopify', 'Zoom', 'Slack', 'Excel', 'Word', 'Linux', 'GitHub', 'Chrome', 'Gmail', 'Siri', 'Alexa',
  'Scale', 'CA', 'Pixel', 'BMW', 'USB', 'IP', 'Police', 'Department', 'University', 'Government', 'Institute', 'Labs', 'Office',
  'Philadelphia', 'Chicago', 'Boston', 'Seattle', 'Texas', 'Florida', 'Ohio', 'ChatGPT', 'Claude', 'Gemini', 'Copilot', 'Grok', 'Llama', 'Opus', 'Sonnet', 'Haiku', 'GPT', 'Character.AI', 'Chapter', 'Visa', 'Mastercard', 'PayPal', 'Venmo',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
];

const norm = (w: string) => w.toLowerCase().replace(/[.’']/g, '');

const PLAYER_WORDS: ReadonlySet<string> = new Set(
  BLUE_CHIP_PLAYERS.flatMap((p) => [p.name, ...(p.aka ?? []), ...p.tokens]).flatMap((n) => n.split(/[\s-]+/)).map(norm),
);
const HOUSEHOLD_WORDS: ReadonlySet<string> = new Set(HOUSEHOLD_NAMES.flatMap((n) => n.split(/[\s-]+/)).map(norm));

/** Version strings and domains never read as plain words ("xtool v1.22.2", "blumify.io"). */
const VERSION_OR_DOMAIN = /\bv\d+(?:\.\d+)+\b|\b[a-z0-9-]+\.(?:io|com|ai|dev|org|net|app|co|so|xyz)\b/g;
const IS_VERSION_OR_DOMAIN = /^(?:v\d+(?:\.\d+)+|[a-z0-9-]+\.(?:io|com|ai|dev|org|net|app|co|so|xyz))$/;

export type NameContext = {
  /** Lowercased words a follower knows here: blue chips, household names, the headline. */
  known: ReadonlySet<string>;
  /** Lowercased words of the people and organizations the story names. */
  storyNames: ReadonlySet<string>;
};

/** What a follower knows for this story: the shared lists plus the headline's own words. */
export function nameContext(headline: string, brief?: Pick<Brief, 'subjects' | 'quotes'> | null): NameContext {
  const known = new Set<string>([...PLAYER_WORDS, ...HOUSEHOLD_WORDS]);
  for (const w of headline.split(/[^A-Za-z0-9.’']+/)) if (w) known.add(norm(w.replace(/['’]s$/, '')));
  const storyNames = new Set<string>();
  // People, and organizations with a one-word name: a word inside a longer organization's name
  // ("Philadelphia Police Department") is usually an ordinary word.
  const names = [
    ...(brief?.subjects ?? []).filter((s) => s.type === 'person' || !/\s/.test(s.name.trim())).map((s) => s.name),
    ...(brief?.quotes ?? []).map((q) => q.speaker),
  ];
  for (const n of names) {
    for (const w of (n ?? '').split(/[^A-Za-z.’']+/)) {
      const k = norm(w);
      if (k.length >= 3 && /^[A-Z]/.test(w) && !known.has(k)) storyNames.add(k);
    }
  }
  return { known, storyNames };
}

/**
 * Names in a line a casual follower would not know. A capitalized word is
 * fine when it is known, starts a sentence, or continues a known name
 * ("Flock Safety", "Muse Wonder Full"). A name the story itself introduces
 * (a person or a small organization) is flagged wherever it sits, and so is
 * an unknown acronym, a version string or a domain.
 */
export function obscureNames(text: string, ctx: NameContext): string[] {
  const hits: string[] = [];
  for (const m of text.matchAll(VERSION_OR_DOMAIN)) hits.push(m[0]);
  let chain = false;
  for (const m of text.matchAll(/[A-Za-z][A-Za-z0-9’'&.]*/g)) {
    const raw = m[0].replace(/[.’']+$/, '').replace(/[’']s$/, '');
    if (raw.length < 2 || !/^[A-Z]/.test(raw)) {
      chain = false;
      continue;
    }
    const w = norm(raw);
    if (ctx.known.has(w)) {
      chain = true;
      continue;
    }
    if (IS_VERSION_OR_DOMAIN.test(raw)) continue;
    if (chain && !/^[A-Z]{2,6}s?$/.test(raw)) continue;
    if (ctx.storyNames.has(w)) {
      hits.push(raw);
      chain = false;
      continue;
    }
    if (/^[A-Z]{2,6}s?$/.test(raw)) {
      hits.push(raw);
      chain = false;
      continue;
    }
    const before = text.slice(0, m.index);
    if (/^\s*["“‘']?$/.test(before) || /[.:!?]\s*["“‘']?$/.test(before)) continue;
    hits.push(raw);
  }
  return [...new Set(hits)];
}

export type LintOptions = {
  names?: NameContext;
  /** The most characters the writer's text may add up to across the meme. */
  budget?: number;
  /** The most characters one slot may hold. */
  slotCap?: number;
  /** Slots where a narrated line is a hit; all text slots when unset. */
  narrationSlots?: ReadonlySet<string>;
};

export const DEFAULT_BUDGET = 90;
export const DEFAULT_SLOT_CAP = 50;

/** The writer's own words in a fill (an entity prints a logo, not text). */
export const writtenText = (f: SlotFill): string => (f.kind === 'entity' ? '' : f.text);

/** Every lint hit for one meme's fills. */
export function lintFills(fills: readonly SlotFill[], opts: LintOptions = {}): LintHit[] {
  const hits: LintHit[] = [];
  const budget = opts.budget ?? DEFAULT_BUDGET;
  const cap = opts.slotCap ?? DEFAULT_SLOT_CAP;
  let total = 0;
  for (const f of fills) {
    const text = writtenText(f);
    if (!text) continue;
    total += text.length;
    const hedge = HEDGE.exec(text);
    if (hedge) hits.push({ kind: 'hedge', slot: f.slot, match: hedge[0] });
    if (!opts.narrationSlots || opts.narrationSlots.has(f.slot)) {
      const n = NARRATION.exec(text);
      if (n) hits.push({ kind: 'narration', slot: f.slot, match: n[1]! });
    }
    if (text.length > cap) hits.push({ kind: 'length', slot: f.slot, match: `${text.length} > ${cap}` });
    if (opts.names) for (const name of obscureNames(text, opts.names)) hits.push({ kind: 'obscure-name', slot: f.slot, match: name });
  }
  if (total > budget) hits.push({ kind: 'length', slot: null, match: `${total} > ${budget}` });
  return hits;
}

/** Characters the writer wrote across the meme. */
export const writtenChars = (fills: readonly SlotFill[]): number => fills.reduce((n, f) => n + writtenText(f).length, 0);
