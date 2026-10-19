/**
 * Stories source-page reader. Reads a candidate's cited page as raw text:
 * Readability first, then plain body text for docs/reference pages that have
 * no article markup (a model-card table, a pricing page). Pages are untrusted
 * web content; this module only extracts text, it never follows instructions
 * in it. Code only, no AI.
 */
import { JSDOM } from 'jsdom';

import {
  fetchHtmlLive,
  MAX_TEXT_CHARS,
  MIN_TEXT_CHARS,
  parseArticleHtml,
  type FetchHtml,
} from '@/lib/social/reporter/read-page';

export type SourcePage =
  | { ok: true; url: string; text: string; publishedTime: string | null; via: 'article' | 'plain' }
  | { ok: false; url: string; error: string };

export type SourceReader = (url: string) => Promise<SourcePage>;

/** Characters of page text handed to the gate judge. */
export const GATE_EXCERPT_CHARS = 24_000;

function plainText(html: string, url: string): { text: string; publishedTime: string | null } {
  const doc = new JSDOM(html, { url }).window.document;
  const publishedTime =
    doc.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ??
    doc.querySelector('time[datetime]')?.getAttribute('datetime') ??
    null;
  for (const el of doc.querySelectorAll('script, style, noscript, svg')) el.remove();
  const raw = doc.body?.textContent ?? '';
  const text = raw
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
  return { text: text.slice(0, MAX_TEXT_CHARS), publishedTime };
}

export async function readSourcePage(url: string, fetchHtml: FetchHtml = fetchHtmlLive): Promise<SourcePage> {
  const html = await fetchHtml(url);
  if (!html) return { ok: false, url, error: 'fetch failed' };
  try {
    const article = parseArticleHtml(html, url, url);
    if (article && article.text.length >= MIN_TEXT_CHARS) {
      return { ok: true, url, text: article.text, publishedTime: article.publishedTime, via: 'article' };
    }
    const plain = plainText(html, url);
    if (plain.text.length < MIN_TEXT_CHARS) return { ok: false, url, error: 'no readable text' };
    return { ok: true, url, text: plain.text, publishedTime: plain.publishedTime, via: 'plain' };
  } catch (err) {
    return { ok: false, url, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The slice of a page the gate judge sees: a window centred on the first place
 * the answer's digits appear (separators ignored, so "3,072" finds "3072" and
 * "$200/mo" finds "200 dollars"). No digits or no hit: the start of the page.
 */
export function gateExcerpt(text: string, answer: string, max: number = GATE_EXCERPT_CHARS): string {
  if (text.length <= max) return text;
  const needle = answer.replace(/\D/g, '');
  if (!needle) return text.slice(0, max);
  // Search a copy with commas between digits removed, mapping hits back to `text`.
  let stripped = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === ',' && /\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? '')) continue;
    stripped += ch;
    map.push(i);
  }
  const hit = stripped.indexOf(needle);
  if (hit < 0) return text.slice(0, max);
  const centre = map[hit] + Math.floor(needle.length / 2);
  const start = Math.max(0, Math.min(text.length - max, centre - Math.floor(max / 2)));
  return text.slice(start, start + max);
}
