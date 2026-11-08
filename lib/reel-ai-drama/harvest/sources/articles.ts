import { JSDOM } from 'jsdom';

import { siteOf } from '@/lib/reel-ai-drama/reporting/validate';

import { getText } from '../fetch';
import { namesIn } from '../filters';
import { officialOwner } from '../plan';
import type { RawCandidate, Source, SourceRun, Want } from '../types';

/**
 * Images on the story's own pages (research 04 §3 D): og:image, `<figure>` photos with their captions
 * and JSON-LD credits. News pages give `article` candidates; a company's own pages and press wires give
 * `newsroom` candidates (press images, usually the cleanest copies).
 */

export const MAX_IMAGES_PER_PAGE = 8;

/** `from_title`: the page has no caption for this image, so its caption is the page title (weak evidence of who is in it). */
export type PageImage = { url: string; caption: string; credit: string | null; width: number | null; from_title?: boolean };
export type PageImages = { images: PageImage[]; published: string | null; publisher: string | null; title: string | null };

const SKIP = /\.svg(\?|$)|\.gif(\?|$)|^data:|logo|icon|avatar|sprite|pixel|placeholder|blank\./i;

function largestFromSrcset(srcset: string | null): string | null {
  if (!srcset) return null;
  let best: { url: string; w: number } | null = null;
  for (const part of srcset.split(',')) {
    const [url, size] = part.trim().split(/\s+/);
    const w = Number.parseFloat(size ?? '1') || 1;
    if (url && (!best || w > best.w)) best = { url, w };
  }
  return best?.url ?? null;
}

/** "Photo: Jane Doe/Reuters", "(Credit: …)", "Image credit …" inside a caption. */
export function creditInCaption(caption: string): string | null {
  const m = /(?:photo(?:graph)?|image|picture|credit)s?(?:\s+credit)?\s*(?:by|:)\s*([^()\n]{2,80}?)\)?\s*$/i.exec(caption.trim());
  return m ? m[1].trim().replace(/[.)]+$/, '') : null;
}

export function parsePageImages(html: string, pageUrl: string): PageImages {
  const doc = new JSDOM(html, { url: pageUrl }).window.document;
  const metaContent = (sel: string) => doc.querySelector(sel)?.getAttribute('content')?.trim() || null;
  const abs = (u: string | null) => {
    if (!u) return null;
    try {
      return new URL(u, pageUrl).toString();
    } catch {
      return null;
    }
  };
  const ldCredits = new Map<string, string>();
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (!node || typeof node !== 'object') return;
        const o = node as Record<string, unknown>;
        if (o['@type'] === 'ImageObject' && typeof (o.url ?? o.contentUrl) === 'string') {
          const creator = o.creator as { name?: string } | string | undefined;
          const credit = (o.creditText as string) || (typeof creator === 'string' ? creator : creator?.name) || (o.copyrightNotice as string) || '';
          const url = abs(String(o.url ?? o.contentUrl));
          if (url && credit) ldCredits.set(url, credit);
        }
        Object.values(o).forEach(walk);
      };
      walk(JSON.parse(script.textContent ?? ''));
    } catch {
      // A broken JSON-LD block only loses its credits.
    }
  }
  const title = metaContent('meta[property="og:title"]') ?? (doc.querySelector('title')?.textContent?.trim() || null);
  const images: PageImage[] = [];
  const push = (raw: string | null, caption: string, width: number | null, fromTitle = false) => {
    const url = abs(raw);
    if (!url || SKIP.test(url) || images.some((i) => i.url === url)) return;
    if (width !== null && width < 300) return;
    images.push({ url, caption: caption.replace(/\s+/g, ' ').trim().slice(0, 400), credit: ldCredits.get(url) ?? creditInCaption(caption), width, ...(fromTitle ? { from_title: true } : {}) });
  };
  const ogAlt = metaContent('meta[property="og:image:alt"]');
  push(metaContent('meta[property="og:image:secure_url"]') ?? metaContent('meta[property="og:image"]') ?? metaContent('meta[name="twitter:image"]'), ogAlt ?? title ?? '', null, !ogAlt);
  for (const fig of doc.querySelectorAll('figure')) {
    const img = fig.querySelector('img');
    if (!img) continue;
    const src = largestFromSrcset(img.getAttribute('srcset') ?? img.getAttribute('data-srcset')) ?? img.getAttribute('data-src') ?? img.getAttribute('src');
    const caption = fig.querySelector('figcaption')?.textContent ?? img.getAttribute('alt') ?? '';
    const width = Number(img.getAttribute('width')) || null;
    push(src, caption, width);
    if (images.length >= MAX_IMAGES_PER_PAGE) break;
  }
  const published =
    metaContent('meta[property="article:published_time"]') ?? metaContent('meta[name="date"]') ?? doc.querySelector('time[datetime]')?.getAttribute('datetime') ?? null;
  return { images, published: published ? (/^\d{4}-\d{2}-\d{2}/.exec(published)?.[0] ?? null) : null, publisher: metaContent('meta[property="og:site_name"]'), title };
}

async function pageCandidates(want: Want, run: SourceRun, source: 'article' | 'newsroom'): Promise<RawCandidate[]> {
  if (!want.url) return [];
  const page = parsePageImages(await getText(run.deps.http, want.url), want.url);
  const owner = source === 'newsroom' ? officialOwner(want.url) : null;
  const publisher = page.publisher ?? siteOf(want.url);
  if (!page.images.length) run.notes.push(`${source} ${want.url}: no images found`);
  return page.images.map((img) => {
    const people = namesIn(img.caption, run.cast);
    return {
      source,
      want: want.id,
      kind: people.length === 1 ? ('person_photo' as const) : ('event_photo' as const),
      url: img.url,
      source_page: want.url ?? null,
      credit: img.credit ? `${img.credit} (via ${publisher})` : owner && owner !== 'press wire' ? `${owner} (press image)` : `${publisher} (article image)`,
      license: null,
      caption: img.caption,
      people,
      qids: [],
      place: null,
      // The page date is only an upper bound on when the photo was taken (research 04 §5.1).
      date_taken: page.published,
      date_basis: page.published ? ('article' as const) : ('unknown' as const),
      width: img.width ?? undefined,
      character_image: false,
      made: false,
      trusted: false,
      flags: [...(owner ? [`official:${owner}`] : []), ...(img.from_title ? ['caption:page_title'] : [])],
    };
  });
}

export const articleSource: Source = (want, run) => pageCandidates(want, run, 'article');
export const newsroomSource: Source = (want, run) => pageCandidates(want, run, 'newsroom');
