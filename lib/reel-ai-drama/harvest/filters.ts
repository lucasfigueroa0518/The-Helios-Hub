import sharp from 'sharp';

import { siteOf } from '@/lib/reel-ai-drama/reporting/validate';

import type { RawCandidate } from './types';

/**
 * The harvest's screens (research 04 §4–§5; MD-02, MD-09, MD-16): watermarks (TV channel logos
 * included), AI-made images, identity, recency, size, and near-duplicates. Cheapest first: domains and
 * URL patterns before download, file metadata after, the Haiku look last (look.ts). A watermark is never
 * cropped out; the image is rejected (research 04 §4.2).
 */

// ── Watermark: layer 1 and 2 (before download) ─────────────────────────────

/** Stock and agency preview hosts: their previews are watermarked (research 04 §4.1 layer 1). */
export const STOCK_DOMAINS = [
  'gettyimages.com', 'gettyimages.co.uk', 'gettyimages.ca', 'gettyimages.com.au', 'gettyimages.de', 'gettyimages.fr', 'gettyimages.in', 'gettyimages.ie',
  'istockphoto.com', 'shutterstock.com', 'rexfeatures.com', 'alamy.com', 'alamy.de', 'alamyimages.fr', 'dreamstime.com', '123rf.com',
  'depositphotos.com', 'stock.adobe.com', 'ftcdn.net', 'bigstockphoto.com', 'agefotostock.com', 'superstock.com', 'imago-images.com',
  'imago-images.de', 'picture-alliance.com', 'zumapress.com', 'sipausa.com', 'abacapress.com', 'vecteezy.com', 'freepik.com',
  'pond5.com', 'stocksy.com', 'eyeem.com', 'canstockphoto.com', 'photodune.net', 'pixtastock.com', 'mostphotos.com', 'apimages.com',
  'reutersconnect.com', 'afpforum.com', 'epa.eu', 'newscom.com', 'polarisimages.com', 'wireimage.com',
];

const STOCK_SET = new Set(STOCK_DOMAINS);

/** The stock domain a URL is on (any subdomain), or null. */
export function blockedDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const d of STOCK_SET) if (host === d || host.endsWith(`.${d}`)) return d;
  const site = siteOf(url);
  return STOCK_SET.has(site) ? site : null;
}

/** URL and file-name tells of a preview copy (layer 2: high precision, low recall). */
export const WATERMARK_URL = /watermark|[/_-]wm[._/-]|[?&]wm=|\/comp\/|\/preview[s]?\/|[?&]s=\d+x\d+|_comp\.|-comp\./i;

/** Caption, alt or credit text saying the image was made by a model (research 04 §4.3). */
export const AI_TEXT =
  /\b(ai[- ]generated|generated (with|by|using) (ai|artificial intelligence|midjourney|dall[·.\- ]?e|stable diffusion|firefly|imagen)|midjourney|dall[·.\- ]?e\s?\d?|stable diffusion|adobe firefly|image:\s*ai\b|ai[- ]image|ai[- ]illustration|created with ai|made with ai)\b/i;

/** The reject reason before download, or null. */
export function preScreen(c: Pick<RawCandidate, 'url' | 'source_page' | 'caption' | 'credit' | 'made' | 'trusted'>): string | null {
  if (c.made || c.trusted) return null;
  const host = blockedDomain(c.url) ?? blockedDomain(c.source_page);
  if (host) return `watermark_risk:stock_domain:${host}`;
  if (c.url && WATERMARK_URL.test(c.url)) return 'watermark_risk:url_pattern';
  if (AI_TEXT.test(`${c.caption} ${c.credit}`)) return 'ai_generated:caption';
  return null;
}

// ── Layer 3: file metadata (IPTC, XMP, EXIF, C2PA) ─────────────────────────

export type ImageMeta = {
  width: number;
  height: number;
  format: string;
  /** EXIF/IPTC capture date, YYYY-MM-DD. */
  taken: string | null;
  credit: string | null;
  byline: string | null;
  /** The caption the photographer or agency embedded (IPTC Caption-Abstract or XMP dc:description). */
  caption: string | null;
  copyright: string | null;
  /** IPTC DigitalSourceType when stated (e.g. trainedAlgorithmicMedia). */
  digitalSourceType: string | null;
  /** A C2PA manifest is present / it declares AI generation. */
  c2pa: boolean;
  c2paAi: boolean;
};

/** IPTC-IIM record 2 datasets we read: 55 DateCreated, 80 By-line, 110 Credit, 115 Source, 116 Copyright, 120 Caption. */
export function parseIptc(buf: Buffer | undefined): Record<number, string> {
  const out: Record<number, string> = {};
  if (!buf) return out;
  for (let i = 0; i + 5 <= buf.length; ) {
    if (buf[i] !== 0x1c) {
      i += 1;
      continue;
    }
    const record = buf[i + 1];
    const dataset = buf[i + 2];
    const len = buf.readUInt16BE(i + 3);
    const start = i + 5;
    if (record === 2 && len < 0x8000 && start + len <= buf.length) {
      out[dataset] = out[dataset] ? out[dataset] : buf.subarray(start, start + len).toString('utf8').trim();
    }
    i = start + (len < 0x8000 ? len : 0);
  }
  return out;
}

const xmpValue = (xml: string, tag: string): string | null => {
  const attr = new RegExp(`${tag}="([^"]*)"`).exec(xml)?.[1];
  if (attr) return attr.trim();
  const el = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml)?.[1];
  return el ? el.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null : null;
};

const AI_SOURCE = /(composite)?(withTrained|trained)AlgorithmicMedia|algorithmicMedia/i;

export async function readImageMeta(bytes: Buffer): Promise<ImageMeta> {
  const m = await sharp(bytes).metadata();
  const iptc = parseIptc(m.iptc);
  const xmp = m.xmp ? m.xmp.toString('utf8') : '';
  const exif = m.exif ? m.exif.toString('latin1') : '';
  // EXIF holds DateTime (last edit) and DateTimeOriginal; the earliest is the capture.
  const exifDates = [...exif.matchAll(/((?:19|20)\d\d):(\d\d):(\d\d) \d\d:\d\d:\d\d/g)].map((x) => `${x[1]}-${x[2]}-${x[3]}`).sort();
  const iptcDate = /^(\d{4})(\d{2})(\d{2})$/.exec(iptc[55] ?? '');
  const raw = bytes.toString('latin1');
  const c2pa = raw.includes('c2pa') && (raw.includes('jumb') || raw.includes('caBX'));
  const sourceType = xmpValue(xmp, 'Iptc4xmpExt:DigitalSourceType') ?? (AI_SOURCE.exec(xmp)?.[0] ?? null);
  return {
    width: (m.autoOrient?.width ?? m.width) || 0,
    height: (m.autoOrient?.height ?? m.height) || 0,
    format: m.format ?? 'unknown',
    taken: exifDates[0] ?? (iptcDate ? `${iptcDate[1]}-${iptcDate[2]}-${iptcDate[3]}` : null),
    credit: iptc[110] || xmpValue(xmp, 'photoshop:Credit') || null,
    byline: iptc[80] || xmpValue(xmp, 'dc:creator') || null,
    caption: (iptc[120] || xmpValue(xmp, 'dc:description') || '').slice(0, 400) || null,
    copyright: iptc[116] || xmpValue(xmp, 'dc:rights') || null,
    digitalSourceType: sourceType,
    c2pa,
    c2paAi: c2pa && AI_SOURCE.test(raw),
  };
}

/** Agencies whose name in a credit is a flag, not a reject: unwatermarked wire photos are fair game (MD-02). */
export const AGENCY_CREDIT = /\b(getty|shutterstock|alamy|reuters|associated press|ap photo|afp|epa|bloomberg|istock|dreamstime|imago|zuma|sipa|abaca|picture alliance|rex features|wireimage)\b/i;

export function metadataVerdict(meta: ImageMeta): { reject: string | null; flags: string[] } {
  if (meta.digitalSourceType && AI_SOURCE.test(meta.digitalSourceType)) return { reject: `ai_generated:metadata:${meta.digitalSourceType}`, flags: [] };
  if (meta.c2paAi) return { reject: 'ai_generated:c2pa', flags: [] };
  const credit = [meta.credit, meta.byline, meta.copyright].filter(Boolean).join(' ');
  const agency = AGENCY_CREDIT.exec(credit)?.[1];
  return { reject: null, flags: [...(agency ? [`agency_credit:${agency.toLowerCase()}`] : []), ...(meta.c2pa ? ['c2pa'] : [])] };
}

// ── Layer 6: the look (look.ts) ────────────────────────────────────────────

/** What the Haiku look says about one tile. */
export type Look = {
  shows: string;
  watermark: boolean;
  tv_logo: boolean;
  ai_generated: boolean;
  faces: number;
  text_heavy: boolean;
  about_story: boolean;
  key_moment: boolean;
  /** One person's face is the clean, clear subject (anchor material, MD-60). */
  portrait?: boolean;
};

/** Reject reason from a look, or null. Our own captures carry site branding as their subject (§4.2). */
export function lookVerdict(c: Pick<RawCandidate, 'made'>, look: Look): string | null {
  if (c.made) return null;
  if (look.tv_logo) return 'tv_channel_logo';
  if (look.watermark) return 'watermark';
  if (look.ai_generated) return 'ai_generated:look';
  return null;
}

// ── Identity (research 04 §5.2) ────────────────────────────────────────────

/** Cast names a caption mentions (full name, or a surname of five letters or more). */
export function namesIn(caption: string, names: readonly string[]): string[] {
  const text = caption.toLowerCase();
  return names.filter((name) => {
    const n = name.toLowerCase();
    if (text.includes(n)) return true;
    const last = (n.split(/\s+/).pop() ?? '').replace(/[^a-z0-9]/g, '');
    return n.includes(' ') && last.length >= 5 && new RegExp(`\\b${last}\\b`).test(text);
  });
}

export type IdentityResult = { reject: string | null; people: string[]; flags: string[] };

/** Sources whose caption is an editorial claim about the picture itself (a Commons file description, a press or news caption). */
const CURATED_CAPTION: readonly RawCandidate['source'][] = ['commons', 'wikidata', 'newsroom', 'article'];

/** The URL itself names the person (a file or page slug such as `greg-brockman` or `Brockman_2019.jpg`). */
export function nameInUrl(name: string, ...urls: (string | null | undefined)[]): boolean {
  const parts = name.toLowerCase().split(/\s+/).map((w) => w.replace(/[^a-z0-9]/g, '')).filter(Boolean);
  const last = parts[parts.length - 1] ?? '';
  return urls.some((u) => {
    if (!u) return false;
    let text = u.toLowerCase();
    try {
      text = decodeURIComponent(text);
    } catch {
      // keep the raw text
    }
    const flat = text.replace(/[^a-z0-9]+/g, ' ');
    return flat.includes(parts.join(' ')) || text.includes(parts.join('')) || (last.length >= 5 && new RegExp(`\\b${last}\\b`).test(flat));
  });
}

/**
 * Who a picture shows, from evidence a reader can check (MD-60: every main character needs a confirmed image).
 * Verified: a QID-tied source (Wikidata P18/P180, the bank); or a face the look sees plus a name stated about
 * this picture itself (a Commons file description, a news or press caption, the IPTC caption embedded in the
 * file, or a search result whose title and URL both name them). Probable: only a search title or a page title
 * names them. Anything else never claims the person; a photo whose only job was to show that person is rejected.
 */
export function identityVerdict(
  c: Pick<RawCandidate, 'people' | 'qids' | 'source' | 'caption' | 'kind' | 'flags'> & Partial<Pick<RawCandidate, 'url' | 'source_page' | 'embedded_caption'>>,
  look: Look | null,
): IdentityResult {
  if (!c.people.length) return { reject: null, people: [], flags: [] };
  const personShot = c.kind === 'person_photo';
  const facesSeen = look ? look.faces : null;
  if (c.qids.length && (c.source === 'bank' || c.source === 'wikidata')) {
    if (personShot && facesSeen === 0 && !c.flags.includes('cutout')) return { reject: 'identity:no_face', people: [], flags: [] };
    const flags = ['identity:verified'];
    if (facesSeen !== null && facesSeen > c.people.length) flags.push(`group_photo:${facesSeen}_faces`);
    return { reject: null, people: c.people, flags };
  }
  const inCaption = namesIn(c.caption, c.people);
  const embedded = c.embedded_caption ? namesIn(c.embedded_caption, c.people) : [];
  const named = c.people.filter((p) => inCaption.includes(p) || embedded.includes(p));
  if (!named.length) {
    if (personShot) return { reject: `identity:unverified (caption does not name ${c.people.join(', ')})`, people: [], flags: [] };
    return { reject: null, people: [], flags: ['identity:unverified'] };
  }
  if (facesSeen === 0) {
    if (personShot) return { reject: 'identity:no_face', people: [], flags: [] };
    return { reject: null, people: [], flags: ['identity:named_but_no_face'] };
  }
  const titleOnly = c.flags.includes('caption:page_title');
  const basis = (p: string): string | null => {
    if (embedded.includes(p)) return 'embedded_caption';
    if (CURATED_CAPTION.includes(c.source) && !titleOnly) return 'caption';
    if (nameInUrl(p, c.url, c.source_page)) return 'title_and_url';
    return null;
  };
  const bases = named.map(basis);
  const flags = facesSeen !== null && bases.every(Boolean) ? ['identity:verified', `identity_basis:${[...new Set(bases)].join('+')}`] : ['identity:probable'];
  if (facesSeen !== null && facesSeen > named.length) flags.push(`group_photo:${facesSeen}_faces`);
  return { reject: null, people: named, flags };
}

// ── Recency (MD-09; research 04 §5.1) ──────────────────────────────────────

const DAY = 86_400_000;

/** A ranking weight, never a gate. News prefers recent photos; history prefers photos from its era. */
export function recencyScore(date: string | null, now: Date, isNews: boolean, eventDate: string | null): number {
  const t = date ? Date.parse(date) : NaN;
  if (!Number.isFinite(t)) return 0.4;
  if (isNews) {
    const age = (now.getTime() - t) / DAY;
    return age <= 60 ? 1 : age <= 90 ? 0.8 : age <= 365 ? 0.5 : 0.3;
  }
  const e = eventDate ? Date.parse(eventDate) : NaN;
  if (!Number.isFinite(e)) return 0.5;
  const years = Math.abs(t - e) / (365 * DAY);
  return years <= 1 ? 1 : years <= 3 ? 0.7 : 0.4;
}

export function recencyFlags(c: Pick<RawCandidate, 'kind'>, date: string | null, now: Date, isNews: boolean, eventDate: string | null): string[] {
  const t = date ? Date.parse(date) : NaN;
  if (!Number.isFinite(t)) return [];
  const year = date!.slice(0, 4);
  if (isNews && (now.getTime() - t) / DAY > 365) return [`old_photo:${year}`];
  const e = eventDate ? Date.parse(eventDate) : NaN;
  if (!isNews && Number.isFinite(e) && t - e > 2 * 365 * DAY && c.kind === 'event_photo') return [`later_than_event:${year}`];
  return [];
}

// ── Size (research 04 §7.3; MD-16) ─────────────────────────────────────────

/** Framed print / board / polaroid floor; full-bleed needs more, which the director judges per frame. */
export const MIN_SHORT_SIDE = 600;
/** Upscaling invents detail, so it stays small and rare (MD-16). */
export const MAX_UPSCALE = 2;

export function sizeFloor(c: Pick<RawCandidate, 'made' | 'trusted' | 'kind'>): number {
  return c.made || c.trusted || c.kind === 'logo' ? 0 : MIN_SHORT_SIDE;
}

/** The upscale factor that reaches the floor, or null when even MAX_UPSCALE falls short. */
export function upscaleFactor(shortSide: number, floor: number = MIN_SHORT_SIDE): number | null {
  if (shortSide >= floor) return 1;
  const f = Math.ceil((floor / shortSide) * 10) / 10;
  return f <= MAX_UPSCALE ? f : null;
}

// ── Perceptual hash and dedupe ─────────────────────────────────────────────

/** Hamming distance at or under which two 64-bit pHashes are the same picture (starting value; tune). */
export const NEAR_DUPLICATE = 8;

const N = 32;
const COS = Array.from({ length: 8 }, (_, u) => Array.from({ length: N }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N))));

/** 64-bit DCT pHash as 16 hex characters (transparent pixels count as white). */
export async function phash(input: Buffer | string): Promise<string> {
  const px = await sharp(input).flatten({ background: '#ffffff' }).greyscale().resize(N, N, { fit: 'fill' }).raw().toBuffer();
  const dct: number[] = [];
  for (let u = 0; u < 8; u += 1) {
    for (let v = 0; v < 8; v += 1) {
      let sum = 0;
      for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) sum += px[y * N + x] * COS[u][y] * COS[v][x];
      dct.push(sum);
    }
  }
  const ac = dct.slice(1);
  const median = [...ac].sort((a, b) => a - b)[Math.floor(ac.length / 2)];
  let hex = '';
  for (let i = 0; i < 64; i += 4) {
    let nibble = 0;
    for (let b = 0; b < 4; b += 1) nibble = (nibble << 1) | (dct[i + b] > median ? 1 : 0);
    hex += nibble.toString(16);
  }
  return hex;
}

export function hamming(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) {
    let x = Number.parseInt(a[i], 16) ^ Number.parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

export const isPhash = (key: string) => /^[0-9a-f]{16}$/.test(key);

/**
 * Groups near-identical images and keeps the best of each group (`better(a, b) > 0` when a is better).
 * Returns the keepers and, for each dropped item, the keeper it duplicates.
 */
export function dedupeByHash<T extends { phash: string | null }>(items: readonly T[], better: (a: T, b: T) => number): { keep: T[]; dropped: { item: T; of: T }[] } {
  const sorted = [...items].sort((a, b) => better(b, a));
  const keep: T[] = [];
  const dropped: { item: T; of: T }[] = [];
  for (const item of sorted) {
    const of = item.phash ? keep.find((k) => k.phash && hamming(k.phash, item.phash!) <= NEAR_DUPLICATE) : undefined;
    if (of) dropped.push({ item, of });
    else keep.push(item);
  }
  return { keep, dropped };
}
