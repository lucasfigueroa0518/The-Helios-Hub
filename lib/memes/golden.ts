/**
 * The golden set: real memes from Imgflip, read to learn how each template
 * is used and how real memes are written (planning/Memes/GOLDEN_SET.md).
 * scripts/memes_golden_harvest.ts fetches the pages into .memes-local/golden/
 * (never committed: the captions are other people's). Everything here is
 * pure: parse a page, measure a caption. No model calls.
 */
import fs from 'node:fs';
import path from 'node:path';

export const GOLDEN_DIR = path.join(process.cwd(), '.memes-local', 'golden');

/** One captioned meme as Imgflip lists it. */
export type GoldenPost = {
  id: string;
  /** The poster's title, shown above the image (not part of the image). */
  title: string;
  /** The text boxes, in Imgflip's box order. */
  boxes: string[];
  tags: string[];
  views: number;
  upvotes: number;
  comments: number;
};

/** Where a post was listed: which sort and page. */
export type GoldenListing = { sort: string; page: number };

export type GoldenTemplateFile = {
  templateId: string;
  imgflipSlug: string;
  fetchedAt: string;
  /** Every post seen, deduped by id, with each listing it was seen in. */
  posts: Array<GoldenPost & { seen: GoldenListing[] }>;
};

/** A meme from a tech tag page; templateId when its image tags name one of our templates. */
export type GoldenTechPost = GoldenPost & { tags: string[]; seen: Array<GoldenListing & { tag: string }>; templateId: string | null };

/**
 * Which of our templates a post's own tags name. Imgflip tags every
 * generator meme with the template's lowercased name ("drake hotline bling").
 */
export function templateFromTags(tags: string[], names: Array<{ id: string; name: string }>): string | null {
  const set = new Set(tags.map((t) => t.toLowerCase()));
  return names.find((n) => set.has(n.name.toLowerCase()))?.id ?? null;
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&#039;': "'", '&#39;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };
export const unescapeHtml = (s: string) =>
  s.replace(/&(?:amp|quot|#0?39|lt|gt|nbsp);/g, (m) => ENTITIES[m] ?? m).replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));

const num = (s: string | undefined) => (s ? Number(s.replace(/,/g, '')) : 0);

/**
 * Split an Imgflip alt text ("title | box1; box2 | image tagged in a,b | made
 * w/ Imgflip meme maker") into title, boxes and tags. When the alt holds only
 * one part before the tags, it is the boxes unless it equals the title.
 */
export function parseAlt(alt: string, title: string): { boxes: string[]; tags: string[] } {
  const parts = unescapeHtml(alt).split(' | ');
  const tagsAt = parts.findIndex((p) => p.startsWith('image tagged in '));
  const tags = tagsAt >= 0 ? parts[tagsAt]!.slice('image tagged in '.length).split(',').map((t) => t.trim()).filter(Boolean) : [];
  const head = parts.slice(0, tagsAt >= 0 ? tagsAt : parts.filter((p) => !p.startsWith('made w/')).length).filter((p) => !p.startsWith('made w/'));
  let text: string | null = null;
  if (head.length >= 2) text = head.slice(1).join(' | ');
  else if (head.length === 1 && head[0]!.trim() !== title.trim()) text = head[0]!;
  const boxes = text == null ? [] : text.split('; ').map((b) => b.trim());
  return { boxes: boxes.some(Boolean) ? boxes : [], tags };
}

/** Every meme on one Imgflip listing page (a template page or a tag page). */
export function parseListing(html: string): GoldenPost[] {
  const out: GoldenPost[] = [];
  const units = html.split("<div class='base-unit clearfix'>").slice(1);
  for (const u of units) {
    const id = /href='\/i\/([a-z0-9]+)'/.exec(u)?.[1];
    const titleRaw = /<h2 class='base-unit-title'><a [^>]*>([^<]*)<\/a>/.exec(u)?.[1] ?? '';
    const alt = /<img class='base-img'[^>]*alt='([^']*)'/.exec(u)?.[1];
    if (!id || alt == null) continue;
    const title = unescapeHtml(titleRaw);
    const { boxes, tags } = parseAlt(alt, title);
    const counts = /<div class='base-view-count'>([^<]*)<\/div>/.exec(u)?.[1] ?? '';
    const views = num(/([\d,]+) views?/.exec(counts)?.[1]);
    const upvotes = num(/([\d,]+) upvotes?/.exec(counts)?.[1]);
    const comments = num(/([\d,]+) comments?/.exec(counts)?.[1]);
    out.push({ id, title, boxes, tags, views, upvotes, comments });
  }
  return out;
}

/** Imgflip posts that are about Imgflip itself (upvote begging, "make a meme"), or not in English. */
const META_TAGS = /^(imgflip|imgflip users|imgflip meme|upvote|upvotes|upvote begging|begging|make a meme|stream|streams|comment|comments|front page|featured|freekarma4u|free karma|karma)$/i;
export function isNoise(p: GoldenPost): boolean {
  if (!p.boxes.length) return true;
  if (p.tags.some((t) => META_TAGS.test(t))) return true;
  const text = `${p.title} ${p.boxes.join(' ')}`;
  if (/\b(upvotes?|imgflip|front ?page)\b/i.test(text)) return true;
  const letters = text.replace(/[^\p{L}]/gu, '');
  const latin = letters.replace(/[^A-Za-z]/g, '');
  return letters.length > 0 && latin.length / letters.length < 0.8;
}

export function loadGoldenTemplate(templateId: string, dir = GOLDEN_DIR): GoldenTemplateFile | null {
  const f = path.join(dir, 'imgflip', `${templateId}.json`);
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as GoldenTemplateFile) : null;
}

export const isTopListing = (l: GoldenListing) => l.sort !== 'latest';

/**
 * Winners: listed under a Top sort and in the template's top third by
 * upvotes. Flops: listed under Latest with at most 2 upvotes and never under
 * a Top sort. Everything else is neither.
 */
export function splitWinnersFlops<T extends GoldenPost & { seen: GoldenListing[] }>(posts: T[]): { winners: T[]; flops: T[] } {
  const clean = posts.filter((p) => !isNoise(p));
  const top = clean.filter((p) => p.seen.some(isTopListing)).sort((a, b) => b.upvotes - a.upvotes);
  const winners = top.slice(0, Math.max(1, Math.ceil(top.length / 3)));
  const flops = clean.filter((p) => !p.seen.some(isTopListing) && p.upvotes <= 2);
  return { winners, flops };
}

// ── How a caption is written (G2) ──────────────────────────────────────────

export type BoxCase = 'upper' | 'lower' | 'title' | 'sentence' | 'none';

export type BoxFeatures = {
  chars: number;
  words: number;
  case: BoxCase;
  /** The last mark: '.', '!', '?', '…' or '' for none. */
  end: string;
  /** More than one sentence in the box ("Robots run on the cloud. Network issues."). */
  multiSentence: boolean;
  firstPerson: boolean;
  secondPerson: boolean;
  /** Opens with a frame: "when", "me when", "pov", "nobody:", "me:", "them:", "that moment", "how". */
  opener: string | null;
  /** A speaker label ("Me:", "Teacher:") or quoted speech. */
  dialogue: boolean;
  digit: boolean;
  question: boolean;
  exclaim: boolean;
};

export type MemeFeatures = {
  boxes: BoxFeatures[];
  /** Boxes with text. */
  filled: number;
  totalChars: number;
  longest: number;
  /** Share of box 2's content words already in box 1: the parallel-structure signal. */
  overlap: number;
  /** The first word is the same in two boxes ("Using …" / "Using …"). */
  sameFirstWord: boolean;
  /** Every filled box ends without a mark. */
  noEndMarks: boolean;
};

const STOP = new Set('a an the of to in on at for and or but is are was be it its this that with my me i you your we our they their he she his her by as from not no so do does did just when'.split(' '));
const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).filter(Boolean);
const contentWords = (s: string) => words(s).filter((w) => !STOP.has(w) && w.length > 2);

export function boxCase(s: string): BoxCase {
  const letters = s.replace(/[^\p{L}]/gu, '');
  if (letters.length < 2) return 'none';
  if (letters === letters.toUpperCase()) return 'upper';
  if (letters === letters.toLowerCase()) return 'lower';
  const ws = s.split(/\s+/).filter((w) => /^\p{L}/u.test(w));
  const caps = ws.filter((w) => /^\p{Lu}/u.test(w)).length;
  return ws.length >= 3 && caps / ws.length >= 0.75 ? 'title' : 'sentence';
}

const OPENERS: Array<[string, RegExp]> = [
  ['me when', /^me when\b/i],
  ['when', /^when\b/i],
  ['pov', /^pov\b/i],
  ['nobody:', /^nobody\s*:/i],
  ['me:', /^me\s*:/i],
  ['them:', /^(them|my (mom|dad|friend|teacher|boss)|teacher|boss)\s*:/i],
  ['that moment', /^that (moment|feeling)\b/i],
  ['how', /^how\b/i],
  ['me', /^me\b/i],
];

export function boxFeatures(s: string): BoxFeatures {
  const t = s.trim();
  const end = /\.\.\.$|…$/.test(t) ? '…' : /[.!?]$/.test(t) ? t.slice(-1) : '';
  return {
    chars: t.length,
    words: words(t).length,
    case: boxCase(t),
    end,
    multiSentence: /[.!?]\s+\p{L}/u.test(t.replace(/\b(?:mr|mrs|dr|vs|st|etc|e\.g|i\.e|u\.s)\./gi, '')),
    firstPerson: /\b(i|me|my|mine|myself|i'm|im|i've|ive|i'll)\b/i.test(t),
    secondPerson: /\b(you|your|you're|youre|u|ur|yourself)\b/i.test(t),
    opener: OPENERS.find(([, re]) => re.test(t))?.[0] ?? null,
    dialogue: /^[\p{L} ]{1,20}:\s/u.test(t) || /["“][^"”]{3,}["”]/.test(t),
    digit: /\d/.test(t),
    question: /\?\s*$/.test(t),
    exclaim: /!/.test(t),
  };
}

export function memeFeatures(boxes: string[]): MemeFeatures {
  const filled = boxes.map((b) => b.trim()).filter(Boolean);
  const fs_ = filled.map(boxFeatures);
  const [a, b] = filled;
  let overlap = 0;
  if (a && b) {
    const wa = new Set(contentWords(a));
    const wb = contentWords(b);
    overlap = wb.length ? wb.filter((w) => wa.has(w)).length / wb.length : 0;
  }
  const first = filled.map((x) => words(x)[0] ?? '');
  return {
    boxes: fs_,
    filled: filled.length,
    totalChars: filled.reduce((n, x) => n + x.length, 0),
    longest: Math.max(0, ...filled.map((x) => x.length)),
    overlap,
    sameFirstWord: first.length >= 2 && first.some((w, i) => w && first.indexOf(w) !== i),
    noEndMarks: fs_.length > 0 && fs_.every((f) => f.end === ''),
  };
}

/** Percentile of a list (p in 0–100), nearest rank. */
export function pct(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
}

export type FeatureSummary = {
  n: number;
  boxes: number;
  chars: { p50: number; p75: number; p90: number };
  totalChars: { p50: number; p75: number; p90: number };
  /** Shares of boxes (0–1). */
  box: Record<'upper' | 'lower' | 'title' | 'sentence' | 'endNone' | 'endPeriod' | 'endBang' | 'endQuestion' | 'endEllipsis' | 'multiSentence' | 'firstPerson' | 'secondPerson' | 'opener' | 'dialogue' | 'digit', number>;
  /** Shares of memes (0–1). */
  meme: Record<'parallel' | 'sameFirstWord' | 'noEndMarks' | 'oneBox', number>;
  openers: Record<string, number>;
};

/** The writing profile of a set of memes, each given as its box texts. */
export function summarize(memes: string[][]): FeatureSummary {
  const fs_ = memes.map(memeFeatures).filter((m) => m.filled > 0);
  const boxes = fs_.flatMap((m) => m.boxes);
  const share = (k: (b: BoxFeatures) => boolean) => (boxes.length ? boxes.filter(k).length / boxes.length : 0);
  const mshare = (k: (m: MemeFeatures) => boolean) => (fs_.length ? fs_.filter(k).length / fs_.length : 0);
  const cs = boxes.map((b) => b.chars);
  const ts = fs_.map((m) => m.totalChars);
  const openers: Record<string, number> = {};
  for (const b of boxes) if (b.opener) openers[b.opener] = (openers[b.opener] ?? 0) + 1 / boxes.length;
  return {
    n: fs_.length,
    boxes: boxes.length,
    chars: { p50: pct(cs, 50), p75: pct(cs, 75), p90: pct(cs, 90) },
    totalChars: { p50: pct(ts, 50), p75: pct(ts, 75), p90: pct(ts, 90) },
    box: {
      upper: share((b) => b.case === 'upper'),
      lower: share((b) => b.case === 'lower'),
      title: share((b) => b.case === 'title'),
      sentence: share((b) => b.case === 'sentence'),
      endNone: share((b) => b.end === ''),
      endPeriod: share((b) => b.end === '.'),
      endBang: share((b) => b.end === '!'),
      endQuestion: share((b) => b.end === '?'),
      endEllipsis: share((b) => b.end === '…'),
      multiSentence: share((b) => b.multiSentence),
      firstPerson: share((b) => b.firstPerson),
      secondPerson: share((b) => b.secondPerson),
      opener: share((b) => b.opener != null),
      dialogue: share((b) => b.dialogue),
      digit: share((b) => b.digit),
    },
    meme: {
      parallel: mshare((m) => m.filled >= 2 && m.overlap >= 0.25),
      sameFirstWord: mshare((m) => m.sameFirstWord),
      noEndMarks: mshare((m) => m.noEndMarks),
      oneBox: mshare((m) => m.filled === 1),
    },
    openers,
  };
}
