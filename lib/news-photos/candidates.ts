/**
 * Candidate photos for one story (MD-LFD D17, scripts/md-photo-trial.ts): the article's images (4), two duplicate
 * outlets' images (2 each), one Serper image search on the brief's subject (5), plus any extras the caller has (an
 * LFD lead image, a builder harvest). Each is fetched and turned into the graded JPEG (toJpeg, verbatim geometry).
 *
 * WC12: the used-photo ledger (`usedReason`) and the size floor (`clearsFloor`, SLIDE_MIN_SHORT_SIDE by default) stay in
 * force on every candidate. Credits follow production (lib/social/photos/sources/article.ts + toStoryPhoto in
 * lib/stories/photos.ts): the page's credit, else its caption, else 'Photo'. Nothing else is ever written as a credit.
 */
import sharp from 'sharp';

import { readPage as readPageLive, type PageRead } from '@/lib/social/reporter/read-page';
import { clearsFloor, SLIDE_MIN_SHORT_SIDE } from '@/lib/social/photos/size';

import type { PhotoBrief } from './brief';
import type { FetchedCandidate } from './grade';

export type PhotoStory = { id: string; headline: string; text: string; url: string; duplicateUrls: string[] };
export type Candidate = { src: string; source: 'article' | 'other_outlet' | 'search' | 'extra'; credit: string };

/** A page image: its URL, or its URL with the page's credit/caption text. */
export type PageImage = string | { src: string; credit?: string | null };

export type CandidateDeps = {
  readPage: (url: string) => Promise<{ images: PageImage[] } | null>;
  serper: ((q: string) => Promise<string[]>) | null;
  fetchImage: (url: string) => Promise<Buffer | null>;
  /** WC12 ledger: a reason when the photo is already used/held elsewhere, else null. */
  usedReason?: (src: string) => string | null | Promise<string | null>;
  /** WC12 floor on the original's short side; default SLIDE_MIN_SHORT_SIDE, 0 turns it off. */
  minShortSide?: number;
};

export const ARTICLE_IMAGES = 4;
export const DUPLICATE_PAGES = 2;
export const DUPLICATE_IMAGES = 2;
export const SEARCH_IMAGES = 5;
export const SERPER_USD = 0.001;
/** Tie-break after clarity (md-photo-trial SOURCE_RANK; extras last). */
export const SOURCE_RANK: Record<Candidate['source'], number> = { article: 0, other_outlet: 1, search: 2, extra: 3 };

const NO_CREDIT = 'Photo';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

/**
 * The lab's toJpeg on bytes: white-flattened, at least 400×250, at most 1024 px, a very wide picture (over 3.5:1)
 * padded top and bottom in white. Null when it can't be read or is too small.
 */
export async function toJpeg(bytes: Buffer): Promise<{ jpeg: Buffer; width: number; height: number; origWidth: number; origHeight: number } | null> {
  try {
    const img = sharp(bytes).flatten({ background: '#ffffff' });
    const m = await img.metadata();
    if ((m.width ?? 0) < 400 || (m.height ?? 0) < 250) return null;
    let pipe = img.resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true });
    const w = Math.min(m.width!, 1024), h = Math.round((m.height! * w) / m.width!);
    if (w / h > 3.5) pipe = pipe.extend({ top: Math.ceil((w / 3.5 - h) / 2), bottom: Math.ceil((w / 3.5 - h) / 2), background: '#ffffff' });
    const { data, info } = await pipe.jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
    return { jpeg: data, width: info.width, height: info.height, origWidth: m.width!, origHeight: m.height! };
  } catch { return null; }
}

/** Fetch and convert every candidate in the lab's order; skips are logged. */
export async function gatherCandidates(s: PhotoStory, brief: PhotoBrief, deps: CandidateDeps, extra: Candidate[] = []): Promise<{ fetched: FetchedCandidate[]; serperCalls: number; log: string[] }> {
  const fetched: FetchedCandidate[] = [];
  const log: string[] = [];
  const seen = new Set<string>();
  const floor = deps.minShortSide ?? SLIDE_MIN_SHORT_SIDE;
  let serperCalls = 0;

  const add = async (c: Candidate) => {
    if (!c.src || seen.has(c.src) || /\.(svg|gif)(?:$|[?#])/i.test(c.src)) return;
    seen.add(c.src);
    const used = deps.usedReason ? await deps.usedReason(c.src) : null;
    if (used) { log.push(`skip ${c.source} ${c.src}: used (${used})`); return; }
    const bytes = await deps.fetchImage(c.src).catch(() => null);
    const j = bytes ? await toJpeg(bytes) : null;
    if (!j) { log.push(`skip ${c.source} ${c.src}: unreadable or under 400×250`); return; }
    const f = await clearsFloor({ url: c.src, width: j.origWidth, height: j.origHeight }, floor, undefined);
    if (!f.ok) { log.push(`skip ${c.source} ${c.src}: too small (${f.size}; needs ${floor})`); return; }
    fetched.push({ ...c, jpeg: j.jpeg, width: j.width, height: j.height });
  };

  const pagePhotos = async (url: string, n: number, source: 'article' | 'other_outlet') => {
    if (!url || url.startsWith('search:')) return;
    const page = await deps.readPage(url).catch(() => null);
    if (!page) { log.push(`page unread: ${url}`); return; }
    for (const im of page.images.slice(0, n)) {
      const src = typeof im === 'string' ? im : im.src;
      const credit = (typeof im === 'string' ? '' : (im.credit ?? '')).trim() || NO_CREDIT;
      await add({ src, source, credit });
    }
  };

  await pagePhotos(s.url, ARTICLE_IMAGES, 'article');
  for (const d of s.duplicateUrls.slice(0, DUPLICATE_PAGES)) await pagePhotos(d, DUPLICATE_IMAGES, 'other_outlet');
  if (deps.serper) {
    serperCalls++;
    for (const u of (await deps.serper(brief.subject).catch(() => [] as string[])).slice(0, SEARCH_IMAGES)) await add({ src: u, source: 'search', credit: NO_CREDIT });
  } else log.push('no image search (Serper not configured)');
  for (const c of extra) await add({ ...c, source: 'extra', credit: c.credit.trim() || NO_CREDIT });
  log.push(`${fetched.length} candidates`);
  return { fetched, serperCalls, log };
}

/** `readPage` for PhotoDeps from lib/social/reporter/read-page: image URLs with the page's credit, else caption. */
export function readPageImages(read: (url: string) => Promise<PageRead> = readPageLive): CandidateDeps['readPage'] {
  return async (url) => {
    const p = await read(url).catch(() => null);
    if (!p?.ok) return null;
    return { images: p.photos.filter((ph) => ph.src).map((ph) => ({ src: ph.src, credit: (ph.credit ?? ph.caption ?? '').trim() })) };
  };
}

/** `serper` for PhotoDeps: Serper /images, first five image URLs (md-photo-trial serper()). */
export function serperImages(apiKey: string, http: typeof fetch = fetch): (q: string) => Promise<string[]> {
  return async (q) => {
    const res = await http('https://google.serper.dev/images', { method: 'POST', headers: { 'X-API-KEY': apiKey, 'content-type': 'application/json' }, body: JSON.stringify({ q, num: 10 }), signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return [];
    const j = (await res.json()) as { images?: { imageUrl?: string }[] };
    return (j.images ?? []).map((x) => x.imageUrl).filter((x): x is string => Boolean(x)).slice(0, SEARCH_IMAGES);
  };
}

/** `fetchImage` for PhotoDeps: the lab's browser user agent and 15 s timeout. */
export function fetchImageLive(http: typeof fetch = fetch): (url: string) => Promise<Buffer | null> {
  return async (url) => {
    try {
      const res = await http(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15_000) });
      return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    } catch { return null; }
  };
}
