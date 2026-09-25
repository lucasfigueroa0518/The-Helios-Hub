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
      const response = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: options.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
          ...options.headers,
        },
      });
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

export type FetchedPage = { html: string; finalUrl: string };

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
      const response = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: options.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
          ...options.headers,
        },
      });
      if (!response.ok) {
        const error = new HttpError(response.status, url);
        if (response.status < 500 && response.status !== 429) throw error;
        lastError = error;
      } else {
        return { html: await response.text(), finalUrl: response.url || url };
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
