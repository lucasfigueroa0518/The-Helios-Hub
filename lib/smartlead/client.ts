/**
 * Smartlead REST client.
 *
 * Mirrors the shape of `agentMailRequest` (fetch wrapper, 30 s timeout, typed
 * errors) with one extra obligation: Smartlead authenticates by query string,
 * so the API key rides in the URL. Nothing that leaves this module — error
 * messages, thrown `url` fields, log lines — may carry the raw key.
 */

export const SMARTLEAD_BASE = 'https://server.smartlead.ai/api/v1';
export const SMARTLEAD_TIMEOUT_MS = 30_000;

/** Longest response body copied into an error message or log line. */
const MAX_BODY_IN_MESSAGE = 500;

const REDACTED = '[redacted]';

/**
 * Strips the API key from any string before it is logged, thrown, or stored.
 * Handles both the query parameter form and a bare occurrence of the key.
 */
export function redactApiKey(value: string): string {
  let out = value.replace(/([?&]api_key=)[^&\s]*/gi, `$1${REDACTED}`);
  const key = process.env.SMARTLEAD_API_KEY?.trim();
  if (key && key.length >= 8) out = out.split(key).join(REDACTED);
  return out;
}

export function truncateBody(body: string, limit = MAX_BODY_IN_MESSAGE): string {
  const redacted = redactApiKey(body);
  return redacted.length > limit ? `${redacted.slice(0, limit)}…` : redacted;
}

export class SmartleadError extends Error {
  /** Always redacted. */
  readonly url: string;
  readonly status: number | null;
  /** Always redacted and truncated. */
  readonly body: string;

  constructor(message: string, options: { url: string; status: number | null; body?: string }) {
    super(redactApiKey(message));
    this.name = 'SmartleadError';
    this.url = redactApiKey(options.url);
    this.status = options.status;
    this.body = truncateBody(options.body ?? '');
  }
}

/** 4xx other than 429 — permanent; the job fails rather than retrying. */
export class SmartleadRequestError extends SmartleadError {
  constructor(options: { url: string; status: number; body: string }) {
    super(`Smartlead ${options.status}: ${truncateBody(options.body)}`, options);
    this.name = 'SmartleadRequestError';
  }
}

/** 429 — retryable after `retryAfterMs`. */
export class SmartleadRateLimitError extends SmartleadError {
  readonly retryAfterMs: number;

  constructor(options: { url: string; body: string; retryAfterMs: number }) {
    super(`Smartlead 429 rate limited: ${truncateBody(options.body)}`, { ...options, status: 429 });
    this.name = 'SmartleadRateLimitError';
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** 5xx or a transport failure — retryable with backoff. */
export class SmartleadServerError extends SmartleadError {
  constructor(options: { url: string; status: number | null; body: string }) {
    super(
      options.status === null
        ? `Smartlead network error: ${truncateBody(options.body)}`
        : `Smartlead ${options.status}: ${truncateBody(options.body)}`,
      options,
    );
    this.name = 'SmartleadServerError';
  }
}

export function smartleadApiKey(): string {
  const key = process.env.SMARTLEAD_API_KEY?.trim();
  if (!key) throw new Error('SMARTLEAD_API_KEY is not configured');
  return key;
}

function parseRetryAfter(header: string | null): number {
  if (!header) return 0;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return 0;
}

export type SmartleadQuery = Record<string, string | number | boolean | undefined | null>;

export type SmartleadRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: SmartleadQuery;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
};

/** URL without credentials — safe to log, and what error objects carry. */
function buildPublicUrl(path: string, query?: SmartleadQuery): URL {
  const url = new URL(`${SMARTLEAD_BASE}${path.startsWith('/') ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

export async function smartleadRequest<T>(
  path: string,
  options: SmartleadRequestOptions = {},
): Promise<T> {
  const publicUrl = buildPublicUrl(path, options.query);
  const loggableUrl = publicUrl.toString();

  // The key is attached here and nowhere earlier, so no caller ever holds a
  // string containing it.
  const authedUrl = new URL(loggableUrl);
  authedUrl.searchParams.set('api_key', smartleadApiKey());

  let response: Response;
  try {
    response = await fetch(authedUrl.toString(), {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal ?? AbortSignal.timeout(options.timeoutMs ?? SMARTLEAD_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error && error.cause ? ` (${String(error.cause)})` : '';
    throw new SmartleadServerError({ url: loggableUrl, status: null, body: `${message}${cause}` });
  }

  const text = await response.text();

  if (response.status === 429) {
    throw new SmartleadRateLimitError({
      url: loggableUrl,
      body: text,
      retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
    });
  }
  if (response.status >= 500) {
    throw new SmartleadServerError({ url: loggableUrl, status: response.status, body: text });
  }
  if (!response.ok) {
    throw new SmartleadRequestError({ url: loggableUrl, status: response.status, body: text });
  }

  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SmartleadServerError({
      url: loggableUrl,
      status: response.status,
      body: `unparseable JSON: ${text}`,
    });
  }
}

/**
 * Walks an offset/limit endpoint until a short page comes back.
 * `maxPages` stops a malformed endpoint from looping forever.
 */
export async function smartleadPaginate<T>(
  path: string,
  options: {
    query?: SmartleadQuery;
    limit?: number;
    maxPages?: number;
    extract?: (page: unknown) => T[];
  } = {},
): Promise<T[]> {
  const limit = options.limit ?? 100;
  const maxPages = options.maxPages ?? 50;
  const extract = options.extract ?? defaultExtract<T>;
  const all: T[] = [];

  for (let page = 0; page < maxPages; page += 1) {
    const chunk = extract(
      await smartleadRequest<unknown>(path, {
        query: { ...options.query, offset: page * limit, limit },
      }),
    );
    all.push(...chunk);
    if (chunk.length < limit) break;
  }
  return all;
}

function defaultExtract<T>(page: unknown): T[] {
  if (Array.isArray(page)) return page as T[];
  if (page && typeof page === 'object') {
    for (const key of ['data', 'results', 'items']) {
      const value = (page as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as T[];
    }
  }
  return [];
}

export { isSmartleadEnabled, isSmartleadConfigured } from '@/lib/smartlead/enabled';
