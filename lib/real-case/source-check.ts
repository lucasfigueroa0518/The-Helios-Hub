import type { ClaimCheck, ClaimCheckStatus, StoryClaim, StorySource } from '@/lib/real-case/types';

/**
 * The source check (RC-13): code, never a model, confirms that each claim's excerpt is on its
 * source page. The voiceover tells the story straight, with no attribution (RC-05), so the facts it
 * states must be ones a page really says. Pages are data: they are only searched for the excerpt,
 * never read for instructions.
 */

/** Fewer words than this proves nothing ("the company said"). */
export const MIN_EXCERPT_WORDS = 6;
/** More than this is a paragraph, not an excerpt. */
export const MAX_EXCERPT_WORDS = 60;
/** News pages run large (one 2023 article page was over 4MB). */
const MAX_PAGE_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

// ── Text ────────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', shy: '',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** The visible text of an HTML page: scripts, styles and tags out, entities decoded. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<(br|p|div|li|h[1-6]|tr|td|th|blockquote|section|article)\b[^>]*>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Text as compared: Unicode-folded, lower case, every run of non-letters and non-digits one space.
 * Words must match exactly and in order; punctuation, curly quotes, dashes and spacing may differ.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[­​-‍⁠﻿]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function wordCount(text: string): number {
  const norm = normalizeForMatch(text);
  return norm ? norm.split(' ').length : 0;
}

/** True when the excerpt's words appear, in order and unbroken, in the page's text. */
export function excerptOnPage(pageText: string, excerpt: string): boolean {
  const needle = normalizeForMatch(excerpt);
  if (!needle) return false;
  return ` ${normalizeForMatch(pageText)} `.includes(` ${needle} `);
}

// ── URLs ────────────────────────────────────────────────────────────────────

function privateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/**
 * Why a URL can't be fetched, or null when it can: http(s) only, no credentials, no localhost or
 * private address literal. Hostnames are not resolved, so this is a guard against obvious misuse,
 * not against DNS that points inward.
 */
export function urlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'not a URL';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return `${url.protocol} is not a web address`;
  if (url.username || url.password) return 'carries credentials';
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return 'not a public host';
  if (privateIpv4(host)) return 'a private address';
  if (host.includes(':') && (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80') || host === '::')) return 'a private address';
  return null;
}

// ── Fetching ────────────────────────────────────────────────────────────────

export type FetchedPage =
  | { ok: true; url: string; contentType: string; body: string }
  | { ok: false; reason: string; status?: number };

/** One GET, swappable for tests. The real one follows redirects itself, guarding every hop. */
export type PageFetcher = (url: string) => Promise<FetchedPage>;

export const fetchPage: PageFetcher = async (start) => {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const problem = urlProblem(url);
    if (problem) return { ok: false, reason: problem };
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; HeliosSourceCheck/1.0)', accept: 'text/html,application/xhtml+xml,*/*;q=0.5' },
      });
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      if (!next) return { ok: false, reason: 'redirect without a location', status: res.status };
      url = new URL(next, url).toString();
      continue;
    }
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}`, status: res.status };
    const contentType = res.headers.get('content-type') ?? '';
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_PAGE_BYTES) return { ok: false, reason: 'page too large' };
    return { ok: true, url, contentType, body: new TextDecoder('utf-8', { fatal: false }).decode(buf) };
  }
  return { ok: false, reason: 'too many redirects' };
};

/**
 * The Wayback Machine's copy of a page closest to `timestamp` (YYYYMMDD; latest when absent), as its
 * raw original (the `id_` form), or null.
 */
export async function archivedCopyUrl(url: string, fetcher: PageFetcher, timestamp?: string | null): Promise<string | null> {
  const at = timestamp ? `&timestamp=${encodeURIComponent(timestamp)}` : '';
  const res = await fetcher(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}${at}`);
  // The availability API rate-limits (HTTP 429): the snapshot address itself redirects to the nearest copy.
  if (!res.ok) return `https://web.archive.org/web/${timestamp ?? '2'}id_/${url}`;
  try {
    const closest = (JSON.parse(res.body) as { archived_snapshots?: { closest?: { available?: boolean; url?: string; timestamp?: string } } })
      .archived_snapshots?.closest;
    if (!closest?.available || !closest.url || !closest.timestamp) return null;
    return closest.url.replace(`/web/${closest.timestamp}/`, `/web/${closest.timestamp}id_/`);
  } catch {
    return null;
  }
}

type PageText = { text: string; via: 'live' | 'archive' };
type Failure = { status: Exclude<ClaimCheckStatus, 'verified' | 'mismatch'>; detail: string };

function readable(page: Extract<FetchedPage, { ok: true }>): string | null {
  const type = page.contentType.toLowerCase();
  if (type.includes('html') || type.includes('xml')) return htmlToText(page.body);
  if (type.startsWith('text/') || type === '') return page.body;
  return null;
}

/** "2024-05-30" → "20240530", for the archive lookup; null when the date isn't in that form. */
function archiveStamp(published: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(published ?? '');
  return m ? `${m[1]}${m[2]}${m[3]}` : null;
}

/**
 * One source's texts, loaded once and only as far as needed: the live page first, then the archived
 * copy closest to the source's date. The copy is tried when the live page fails, can't be read, or
 * no longer carries an excerpt (pages get edited after the event).
 */
class SourcePages {
  private live?: Promise<PageText | Failure>;
  private archive?: Promise<PageText | null>;

  constructor(private readonly source: StorySource, private readonly fetcher: PageFetcher) {}

  private loadLive(): Promise<PageText | Failure> {
    this.live ??= (async () => {
      const page = await this.fetcher(this.source.url);
      if (!page.ok) return { status: 'unreachable' as const, detail: `source ${this.source.id}: ${page.reason}` };
      const text = readable(page);
      if (text === null) return { status: 'unreadable' as const, detail: `source ${this.source.id} is ${page.contentType || 'not text'}` };
      return { text, via: 'live' as const };
    })();
    return this.live;
  }

  private loadArchive(): Promise<PageText | null> {
    this.archive ??= (async () => {
      const copyUrl = await archivedCopyUrl(this.source.url, this.fetcher, archiveStamp(this.source.published));
      if (!copyUrl) return null;
      const copy = await this.fetcher(copyUrl);
      if (!copy.ok) return null;
      const text = readable(copy);
      return text === null ? null : { text, via: 'archive' as const };
    })();
    return this.archive;
  }

  async check(excerpt: string, at: string): Promise<ClaimCheck> {
    const problem = urlProblem(this.source.url);
    if (problem) return { status: 'invalid', detail: `source ${this.source.id}: ${problem}`, checked_at: at };
    const live = await this.loadLive();
    if ('text' in live && excerptOnPage(live.text, excerpt)) return { status: 'verified', via: 'live', checked_at: at };
    const archive = await this.loadArchive();
    if (archive && excerptOnPage(archive.text, excerpt)) return { status: 'verified', via: 'archive', checked_at: at };
    if ('text' in live || archive) {
      return { status: 'mismatch', via: 'text' in live ? 'live' : 'archive', detail: `excerpt not on source ${this.source.id}`, checked_at: at };
    }
    return { status: live.status, detail: live.detail, checked_at: at };
  }
}

export type StoryCheck = {
  claims: StoryClaim[];
  /** Core claims that failed their check: any one drops the story. */
  failedCore: string[];
  /** Non-core claims that failed: removed from what the reel may say. */
  failedOther: string[];
};

/**
 * Check every claim against its source (each source fetched once). A claim passes only when its
 * excerpt, between MIN and MAX_EXCERPT_WORDS long, is on its own source's page.
 */
export async function checkStoryClaims(
  claims: readonly StoryClaim[],
  sources: readonly StorySource[],
  fetcher: PageFetcher = fetchPage,
  now: Date = new Date(),
): Promise<StoryCheck> {
  const at = now.toISOString();
  const pages = new Map(sources.map((s) => [s.id, new SourcePages(s, fetcher)]));
  const checked: StoryClaim[] = [];
  for (const claim of claims) {
    const words = wordCount(claim.excerpt);
    const source = pages.get(claim.source_id);
    const check: ClaimCheck =
      words < MIN_EXCERPT_WORDS
        ? { status: 'invalid', detail: `excerpt has ${words} words, under ${MIN_EXCERPT_WORDS}`, checked_at: at }
        : words > MAX_EXCERPT_WORDS
          ? { status: 'invalid', detail: `excerpt has ${words} words, over ${MAX_EXCERPT_WORDS}`, checked_at: at }
          : !source
            ? { status: 'invalid', detail: `no source ${claim.source_id}`, checked_at: at }
            : await source.check(claim.excerpt, at);
    checked.push({ ...claim, check });
  }
  const failed = (core: boolean) => checked.filter((c) => c.core === core && c.check?.status !== 'verified').map((c) => c.id);
  return { claims: checked, failedCore: failed(true), failedOther: failed(false) };
}
