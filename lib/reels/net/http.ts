import { execFile } from 'node:child_process';

import { FETCH_RETRIES, FETCH_TIMEOUT_MS, USER_AGENT } from '@/lib/reels/config';

export class HttpError extends Error {
  constructor(readonly status: number, readonly url: string) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const HTTP1_REDIRECTS = 5;
const HTTP1_MARKER = '\n__HELIOS_HTTP1__\n';

/**
 * Cloudflare's bot check challenges Node's TLS handshake and returns 403.
 * The same GET through curl over HTTP/1.1 is a normal page. Node's own
 * `https` client is still challenged, so the retry cannot stay inside Node.
 * A real 403 (no challenge header) is left alone: that is a paywall or a
 * block, not a protocol mismatch.
 */
export function isCloudflareChallenge(
  status: number,
  getHeader: (name: string) => string | null,
): boolean {
  if (status !== 403) return false;
  return (getHeader('cf-mitigated') ?? '').toLowerCase().includes('challenge');
}

type Http1Page = { status: number; body: string; finalUrl: string; contentType: string | null };

function fetchOverHttp1(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Http1Page> {
  const args = [
    '--http1.1',
    '-sS',
    '-L',
    '--max-redirs',
    String(HTTP1_REDIRECTS),
    '--max-time',
    String(Math.max(1, Math.ceil(timeoutMs / 1000))),
    '-A',
    headers['user-agent'] ?? USER_AGENT,
    '-H',
    `Accept: ${headers.accept ?? '*/*'}`,
    '-H',
    `Accept-Language: ${headers['accept-language'] ?? 'en-US,en;q=0.9'}`,
    '-w',
    `${HTTP1_MARKER}%{http_code}\n%{content_type}\n%{url_effective}`,
    url,
  ];

  return new Promise((resolve, reject) => {
    const child = execFile(
      'curl',
      args,
      { maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        const at = stdout.lastIndexOf(HTTP1_MARKER);
        if (at < 0) {
          reject(new Error(`curl did not report a status for ${url}`));
          return;
        }
        const meta = stdout.slice(at + HTTP1_MARKER.length).replace(/^\n/, '');
        const [statusLine, contentTypeLine, ...urlLines] = meta.split('\n');
        const status = Number(statusLine?.trim());
        if (!Number.isFinite(status)) {
          reject(new Error(`curl returned no status for ${url}`));
          return;
        }
        const contentType = contentTypeLine?.trim() || null;
        resolve({
          status,
          body: stdout.slice(0, at),
          finalUrl: urlLines.join('\n').trim() || url,
          contentType,
        });
      },
    );
    const onAbort = () => child.kill();
    signal?.addEventListener('abort', onAbort, { once: true });
    child.on('close', () => signal?.removeEventListener('abort', onAbort));
  });
}

function requestHeaders(options: FetchTextOptions): Record<string, string> {
  return {
    'user-agent': USER_AGENT,
    accept: options.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    ...options.headers,
  };
}

/**
 * A challenged HTTP/2 response is read again over HTTP/1.1. Anything else is
 * returned as the original status so the caller can fail a real 4xx at once.
 */
async function recoverChallenge(
  response: Response,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ status: number; body: string; finalUrl: string; contentType: string | null } | null> {
  if (!isCloudflareChallenge(response.status, (name) => response.headers.get(name))) return null;
  await response.body?.cancel().catch(() => undefined);
  const page = await fetchOverHttp1(url, headers, timeoutMs, signal);
  return { status: page.status, body: page.body, finalUrl: page.finalUrl, contentType: page.contentType };
}

export type FetchTextOptions = {
  accept?: string;
  retries?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
};

/**
 * GET with a Helios user agent, a per-attempt timeout, and bounded retries.
 * 4xx other than 429 fail immediately: a paywall or a 404 will not fix itself.
 */
export async function fetchText(url: string, options: FetchTextOptions = {}): Promise<string> {
  const retries = options.retries ?? FETCH_RETRIES;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const headers = requestHeaders(options);
      const response = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers,
      });
      const recovered = await recoverChallenge(response, url, headers, timeoutMs, options.signal);
      if (recovered) {
        if (recovered.status >= 200 && recovered.status < 300) return recovered.body;
        throw new HttpError(recovered.status, url);
      }
      if (!response.ok) {
        const error = new HttpError(response.status, url);
        if (response.status < 500 && response.status !== 429) throw error;
        lastError = error;
      } else {
        return await response.text();
      }
    } catch (error) {
      if (error instanceof HttpError && error.status < 500 && error.status !== 429) throw error;
      lastError = error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
    if (attempt < retries) await sleep(500 * 2 ** attempt);
  }

  throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${url}`);
}

export async function fetchJson<T>(url: string, options: FetchTextOptions = {}): Promise<T> {
  const text = await fetchText(url, { accept: 'application/json', ...options });
  return JSON.parse(text) as T;
}

export type FetchedPage = { html: string; finalUrl: string; contentType?: string | null };

/**
 * Like `fetchText`, but reports where the request actually landed.
 *
 * Newsletter links are tracking redirects: TLDR items arrive as
 * `tracking.tldrnewsletter.com/CL0/...`, which is a different URL for every
 * recipient and shares nothing with the same article seen elsewhere. Storing
 * the destination instead is what lets those items dedupe and auto-merge.
 */
export async function fetchPageFollowingRedirects(
  url: string,
  options: FetchTextOptions = {},
): Promise<FetchedPage> {
  const retries = options.retries ?? FETCH_RETRIES;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const headers = requestHeaders(options);
      const response = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers,
      });
      const recovered = await recoverChallenge(response, url, headers, timeoutMs, options.signal);
      if (recovered) {
        if (recovered.status >= 200 && recovered.status < 300) {
          return { html: recovered.body, finalUrl: recovered.finalUrl, contentType: recovered.contentType };
        }
        throw new HttpError(recovered.status, url);
      }
      if (!response.ok) {
        const error = new HttpError(response.status, url);
        if (response.status < 500 && response.status !== 429) throw error;
        lastError = error;
      } else {
        return {
          html: await response.text(),
          finalUrl: response.url || url,
          contentType: response.headers.get('content-type'),
        };
      }
    } catch (error) {
      if (error instanceof HttpError && error.status < 500 && error.status !== 429) throw error;
      lastError = error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
    if (attempt < retries) await sleep(500 * 2 ** attempt);
  }

  throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${url}`);
}

/**
 * Drop tracking parameters so the same article arriving from a newsletter and
 * from RSS collapses to one fingerprint and one auto-merge. Fragments are kept:
 * anchor-addressed content such as a dated changelog section is a distinct item.
 */
export function canonicalizeUrl(input: string): string {
  try {
    const url = new URL(input.trim());
    const drop: string[] = [];
    url.searchParams.forEach((_value, key) => {
      if (/^(utm_|ref$|ref_|source$|mc_|fbclid|gclid|igshid|__s$)/i.test(key)) drop.push(key);
    });
    for (const key of drop) url.searchParams.delete(key);
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    url.protocol = url.protocol === 'http:' ? 'https:' : url.protocol;
    url.hostname = url.hostname.replace(/^www\./i, '').toLowerCase();
    return url.toString();
  } catch {
    return input.trim();
  }
}
