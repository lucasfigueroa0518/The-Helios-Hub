/**
 * Video finder, step 2a (lab, 2026-11-23): videos the story's own article embeds.
 * Pure: HTML in, candidate URLs out. Code only, no AI. The outlet already chose these clips,
 * so they rank first (VIDEO-SLIDES-PLAN.md §1).
 *
 * Kinds found: <video>/<source> files, og:video, YouTube / Vimeo iframes (Vimeo keeps its
 * privacy hash), and embedded X posts (status URLs; yt-dlp pulls their video if they have one).
 * Only the article body is searched for iframes and links, so site-wide chrome videos are skipped.
 */
import { JSDOM, VirtualConsole } from 'jsdom';

export type EmbedKind = 'file' | 'og_video' | 'youtube' | 'vimeo' | 'x';
export type Embed = { url: string; kind: EmbedKind };

const YT_ID = /(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?v=|shorts\/)|youtu\.be\/)([\w-]{11})/;
const VIMEO = /player\.vimeo\.com\/video\/(\d+)(?:\?[^"'\s]*?\bh=([\da-f]+))?/;
const X_STATUS = /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/(\w+)\/status\/(\d+)/;

function abs(src: string | null | undefined, base: string): string | null {
  if (!src) return null;
  try {
    return new URL(src.trim(), base).toString();
  } catch {
    return null;
  }
}

/** Classify one URL as a video embed, or null. */
export function classifyVideoUrl(url: string): Embed | null {
  const yt = url.match(YT_ID);
  if (yt) return { url: `https://www.youtube.com/watch?v=${yt[1]}`, kind: 'youtube' };
  const vm = url.match(VIMEO);
  if (vm) return { url: `https://player.vimeo.com/video/${vm[1]}${vm[2] ? `?h=${vm[2]}` : ''}`, kind: 'vimeo' };
  const x = url.match(X_STATUS);
  if (x) return { url: `https://x.com/${x[1]}/status/${x[2]}`, kind: 'x' };
  if (/\.(mp4|webm|mov|m3u8)(?:$|[?#])/i.test(url)) return { url, kind: 'file' };
  return null;
}

/** Every video embedded in the article, in page order, de-duplicated. */
export function extractEmbeds(html: string, baseUrl: string): Embed[] {
  // Pages ship CSS jsdom cannot parse; its console noise is not our concern.
  const doc = new JSDOM(html, { virtualConsole: new VirtualConsole() }).window.document;
  const out: Embed[] = [];
  const seen = new Set<string>();
  const push = (e: Embed | null) => {
    if (!e || seen.has(e.url)) return;
    seen.add(e.url);
    out.push(e);
  };
  const body = doc.querySelector('article') ?? doc.querySelector('main') ?? doc.body;

  for (const el of Array.from(doc.querySelectorAll('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"]'))) {
    const u = abs(el.getAttribute('content'), baseUrl);
    if (u) push(classifyVideoUrl(u) ?? { url: u, kind: 'og_video' });
  }
  if (!body) return out;
  for (const el of Array.from(body.querySelectorAll('video, video source'))) {
    const u = abs(el.getAttribute('src') ?? el.getAttribute('data-src'), baseUrl);
    if (u && !u.startsWith('blob:')) push(classifyVideoUrl(u) ?? { url: u, kind: 'file' });
  }
  for (const el of Array.from(body.querySelectorAll('iframe'))) {
    const u = abs(el.getAttribute('src') ?? el.getAttribute('data-src'), baseUrl);
    if (u) push(classifyVideoUrl(u));
  }
  // Embedded X posts: the status link inside the blockquote (the last link is the post itself).
  for (const bq of Array.from(body.querySelectorAll('blockquote.twitter-tweet, blockquote[class*="twitter"]'))) {
    const links = Array.from(bq.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '');
    const status = links.reverse().find((h) => X_STATUS.test(h));
    if (status) push(classifyVideoUrl(status));
  }
  // Plain YouTube links in the article text.
  for (const a of Array.from(body.querySelectorAll('a[href]'))) {
    const u = abs(a.getAttribute('href'), baseUrl);
    if (u && YT_ID.test(u)) push(classifyVideoUrl(u));
  }
  return out;
}
