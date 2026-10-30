import { execFile } from 'node:child_process';
import { lookup as dnsLookup } from 'node:dns/promises';

import { isPrivateHost } from '@/lib/net/private-host';
import { FETCH_RETRIES, FETCH_TIMEOUT_MS, USER_AGENT } from '@/lib/reels/config';

export class HttpError extends Error {
  constructor(readonly status: number, readonly url: string) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpError';
  }
}

/** A fetch was refused because the address (or a redirect hop, or a resolved IP) is private. Never retried. */
export class PrivateAddressError extends Error {
  constructor(readonly url: string, why: string) {
    super(`Refusing to fetch ${url}: ${why}`);
    this.name = 'PrivateAddressError';
  }
}

/** The IP addresses a host name resolves to. Injectable so tests need no network. */
export type HostLookup = (hostname: string) => Promise<string[]>;
const defaultLookup: HostLookup = async (hostname) => (await dnsLookup(hostname, { all: true })).map((a) => a.address);

/** An IPv4-mapped IPv6 address (`::ffff:127.0.0.1`, which URL parsing rewrites to `::ffff:7f00:1`) as its IPv4 form, else null. */
function mappedIpv4(address: string): string | null {
  const h = address.replace(/^\[|\]$/g, '').toLowerCase();
  const dotted = h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return dotted[1]!;
  const hex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const [a, b] = [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16)];
  return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
}

const privateAddress = (address: string) => address === '::' || isPrivateHost(mappedIpv4(address) ?? address);

/**
 * Throws PrivateAddressError unless `url` is http(s) to a public address: not a private literal, and (for a host name) no
 * address it resolves to is private. The lookup and the fetch are separate, so a host that changes its answer between them
 * is not caught; this closes the redirect and the name-points-at-localhost cases.
 */
export async function assertPublicUrl(url: string, lookup: HostLookup = defaultLookup): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PrivateAddressError(url, 'not a URL');
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new PrivateAddressError(url, 'only http and https');
  const host = parsed.hostname;
  if (isPrivateHost(host) || privateAddress(host)) throw new PrivateAddressError(url, 'private address');
  if (/^[\d.]+$/.test(host) || host.includes(':')) return;
  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch {
    throw new PrivateAddressError(url, 'host does not resolve');
  }
  if (addresses.length === 0 || addresses.some(privateAddress)) throw new PrivateAddressError(url, 'resolves to a private address');
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
  follow = true,
): Promise<Http1Page> {
  const args = [
    '--http1.1',
    '-sS',
    // A guarded fetch has already followed the redirects itself, hop by hop; curl must not follow another unchecked one.
    ...(follow ? ['-L', '--max-redirs', String(HTTP1_REDIRECTS)] : []),
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
  follow = true,
): Promise<{ status: number; body: string; finalUrl: string; contentType: string | null } | null> {
  if (!isCloudflareChallenge(response.status, (name) => response.headers.get(name))) return null;
  await response.body?.cancel().catch(() => undefined);
  const page = await fetchOverHttp1(url, headers, timeoutMs, signal, follow);
  return { status: page.status, body: page.body, finalUrl: page.finalUrl, contentType: page.contentType };
}

export type FetchTextOptions = {
  accept?: string;
  retries?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /**
   * Only for fetchPageFollowingRedirects. Fetch a URL a person (or a model) supplied: refuse private addresses at the first
   * URL and at every redirect hop, following redirects here instead of in the runtime. Off by default.
   */
  blockPrivate?: boolean;
  /** The address lookup the guard uses. Default: DNS. */
  lookup?: HostLookup;
};

/** Follow redirects one hop at a time, checking each URL before it is requested. Returns the final response and its URL. */
async function fetchGuarded(url: string, headers: Record<string, string>, signal: AbortSignal, lookup?: HostLookup): Promise<{ response: Response; landed: string }> {
  let current = url;
  for (let hop = 0; hop <= HTTP1_REDIRECTS; hop += 1) {
    await assertPublicUrl(current, lookup);
    const response = await fetch(current, { redirect: 'manual', signal, headers });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel().catch(() => undefined);
      current = new URL(location, current).toString();
      continue;
    }
    return { response, landed: current };
  }
  throw new Error(`Too many redirects from ${url}`);
}

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
      const guarded = options.blockPrivate ? await fetchGuarded(url, headers, controller.signal, options.lookup) : null;
      const response = guarded?.response ?? (await fetch(url, { redirect: 'follow', signal: controller.signal, headers }));
      const recovered = await recoverChallenge(response, guarded?.landed ?? url, headers, timeoutMs, options.signal, !guarded);
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
          finalUrl: guarded?.landed ?? (response.url || url),
          contentType: response.headers.get('content-type'),
        };
      }
    } catch (error) {
      if (error instanceof PrivateAddressError) throw error;
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
