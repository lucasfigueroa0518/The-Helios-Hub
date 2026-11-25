/**
 * Video finder: X posts (lab, 2026-11-23). Lucas asked to close the X gap; this replaces the 2026-11-09 rule
 * "only X posts the article embeds". No X API and no scraping of x.com: Google's index finds the posts
 * (Serper web search with site:x.com), and yt-dlp reads public posts the same way it reads embedded ones.
 * Shared by every caller (Morning Download, Last Few Days); nothing here is product-specific.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export type XPost = { url: string; handle: string; text: string };
export type XVideo = { handle: string; duration: number; height: number; title: string };

const STATUS = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(\w{1,15})\/status\/(\d+)/;

/** Pure: Serper organic results → X status posts, normalised and de-duplicated, in rank order. */
export function xPostsFromResults(organic: { link?: string; title?: string; snippet?: string }[]): XPost[] {
  const out: XPost[] = [];
  const seen = new Set<string>();
  for (const o of organic) {
    const m = o.link?.match(STATUS);
    if (!m || seen.has(m[2]!)) continue;
    seen.add(m[2]!);
    out.push({ url: `https://x.com/${m[1]}/status/${m[2]}`, handle: m[1]!, text: [o.title, o.snippet].filter(Boolean).join(' — ') });
  }
  return out;
}

/** One Serper web search restricted to X ($0.001). */
export async function searchX(query: string, apiKey: string, num = 10): Promise<XPost[]> {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ q: `site:x.com ${query}`, num }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return [];
  const j = (await res.json()) as { organic?: { link?: string; title?: string; snippet?: string }[] };
  return xPostsFromResults(j.organic ?? []);
}

/** Free check through yt-dlp: the post's video metadata, or null when the post has no video (most don't). */
export async function probeXVideo(url: string): Promise<XVideo | null> {
  try {
    const { stdout } = await run('yt-dlp', ['--no-warnings', '--socket-timeout', '20', '--no-playlist', '--print', '%(uploader_id)s\t%(duration)s\t%(height)s\t%(title)s', url], { timeout: 60_000 });
    const [handle = '', dur = '', height = '', title = ''] = stdout.trim().split('\n')[0]!.split('\t');
    const duration = Number(dur);
    return Number.isFinite(duration) && duration > 0 ? { handle, duration, height: Number(height) || 0, title } : null;
  } catch {
    return null;
  }
}
