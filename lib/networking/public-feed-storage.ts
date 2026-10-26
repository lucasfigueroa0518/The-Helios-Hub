/**
 * Public feed storage (AI Events plan M3): a PUBLIC Supabase Storage bucket `public-feeds` that
 * heliosgroup.ai reads with a plain GET. Only the snapshot JSON goes here, nothing private. The
 * bucket is created once by scripts/create_public_feeds_bucket.ts (`ensurePublicFeedsBucket`),
 * never during an upload, so a missing bucket fails loudly instead of appearing by accident.
 *
 * Each upload sets the object's cache control to `max-age=300` (Storage takes the bare form; the
 * bucket default would let the CDN keep a stale calendar for a year). Checked 2026-10-21: Storage
 * stores it but currently serves JSON as `private, no-cache`, so every visit reads the latest feed. Retries follow lib/stories/storage.ts, over fetch with normal
 * TLS verification.
 */

import { serviceHeaders } from '@/lib/supabase-service-headers';

export const PUBLIC_FEEDS_BUCKET = 'public-feeds';
/** Where the website reads the events feed (schemaVersion 1). */
export const EVENTS_FEED_OBJECT = 'networking/events.v1.json';
export const PUBLIC_FEED_CACHE_CONTROL = 'max-age=300';

export type PublicFeedStorageConfig = {
  baseUrl: string;
  serviceRole: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const UPLOAD_ATTEMPTS = 4;

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

/** Gateway timeouts and brief outages; other 4xx won't clear by waiting. */
export const isRetryable = (status: number) => [408, 429, 500, 502, 503, 504].includes(status);

export function livePublicFeedStorageConfig(): PublicFeedStorageConfig {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceRole) throw new Error('Supabase Storage is not configured (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)');
  return { baseUrl, serviceRole };
}

/** The URL anyone can GET the object from (what src/constants/feeds.ts on the website points at). */
export function publicFeedUrl(baseUrl: string, objectPath = EVENTS_FEED_OBJECT): string {
  return new URL(`/storage/v1/object/public/${PUBLIC_FEEDS_BUCKET}/${encodePath(objectPath)}`, baseUrl).toString();
}

/** The upload request, built without sending it (tests check its shape). */
export function publicFeedUploadRequest(
  cfg: Pick<PublicFeedStorageConfig, 'baseUrl' | 'serviceRole'>,
  objectPath: string,
  body: string,
): { url: URL; init: RequestInit } {
  return {
    url: new URL(`/storage/v1/object/${PUBLIC_FEEDS_BUCKET}/${encodePath(objectPath)}`, cfg.baseUrl),
    init: {
      method: 'POST',
      headers: {
        ...serviceHeaders(cfg.serviceRole),
        'content-type': 'application/json',
        'cache-control': PUBLIC_FEED_CACHE_CONTROL,
        'x-upsert': 'true',
      },
      body,
    },
  };
}

/** Uploads (upserts) one JSON object to `public-feeds`. Throws with the last error after the retries. */
export async function uploadPublicFeed(
  objectPath: string,
  body: string,
  cfg: PublicFeedStorageConfig = livePublicFeedStorageConfig(),
): Promise<void> {
  const doFetch = cfg.fetch ?? fetch;
  const sleep = cfg.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const { url, init } = publicFeedUploadRequest(cfg, objectPath, body);
  let last = 'upload failed';
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
    try {
      const res = await doFetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
      if (res.ok) return;
      const text = (await res.text()).slice(0, 200);
      if (res.status === 404 || /bucket not found/i.test(text)) {
        last = `the ${PUBLIC_FEEDS_BUCKET} bucket does not exist (${res.status}). Create it with scripts/create_public_feeds_bucket.ts.`;
        break;
      }
      last = /Unregistered API key|Invalid Compact JWS/.test(text)
        ? `storage rejected the Supabase key (${res.status}). The key on this machine is not registered for the project.`
        : `upload failed (${res.status}): ${text}`;
      if (!isRetryable(res.status)) break;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    if (attempt < UPLOAD_ATTEMPTS) await sleep(500 * 2 ** (attempt - 1));
  }
  throw new Error(`${PUBLIC_FEEDS_BUCKET}/${objectPath}: ${last}`);
}

/** Bucket settings: public reads, JSON only, small objects. */
export const PUBLIC_FEEDS_BUCKET_SETTINGS = {
  public: true,
  allowed_mime_types: ['application/json'],
  file_size_limit: 5 * 1024 * 1024,
} as const;

export type EnsureBucketResult = 'created' | 'made_public' | 'already_public';

/**
 * Idempotent: creates the public `public-feeds` bucket, or makes an existing one public with the
 * same settings. Used only by scripts/create_public_feeds_bucket.ts.
 */
export async function ensurePublicFeedsBucket(cfg: PublicFeedStorageConfig = livePublicFeedStorageConfig()): Promise<EnsureBucketResult> {
  const doFetch = cfg.fetch ?? fetch;
  const call = (method: string, pathname: string, body?: unknown) =>
    doFetch(new URL(pathname, cfg.baseUrl), {
      method,
      headers: { ...serviceHeaders(cfg.serviceRole), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });

  const created = await call('POST', '/storage/v1/bucket', { id: PUBLIC_FEEDS_BUCKET, name: PUBLIC_FEEDS_BUCKET, ...PUBLIC_FEEDS_BUCKET_SETTINGS });
  if (created.ok) return 'created';
  const text = await created.text();
  if (!(created.status === 409 || /already exists|duplicate/i.test(text))) {
    throw new Error(`could not create the ${PUBLIC_FEEDS_BUCKET} bucket (${created.status}): ${text.slice(0, 200)}`);
  }

  const existing = await call('GET', `/storage/v1/bucket/${PUBLIC_FEEDS_BUCKET}`);
  if (!existing.ok) throw new Error(`could not read the ${PUBLIC_FEEDS_BUCKET} bucket (${existing.status}): ${(await existing.text()).slice(0, 200)}`);
  const bucket = (await existing.json()) as { public?: boolean };
  if (bucket.public === true) return 'already_public';

  const updated = await call('PUT', `/storage/v1/bucket/${PUBLIC_FEEDS_BUCKET}`, { id: PUBLIC_FEEDS_BUCKET, ...PUBLIC_FEEDS_BUCKET_SETTINGS });
  if (!updated.ok) throw new Error(`could not make the ${PUBLIC_FEEDS_BUCKET} bucket public (${updated.status}): ${(await updated.text()).slice(0, 200)}`);
  return 'made_public';
}
