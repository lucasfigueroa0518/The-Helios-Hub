import { serviceHeaders } from '@/lib/supabase-service-headers';
import https from 'node:https';

/**
 * Private Supabase Storage buckets for social media files (carousel slides,
 * explainer videos, Trial Reels frames and videos), signed for Meta at
 * publish time. lib/reels/visual/storage.ts is this client on `reels-frames`.
 */

function getSettings() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceRole) throw new Error('Supabase Storage is not configured');
  return { baseUrl, serviceRole };
}

function encodePath(objectPath: string) {
  return objectPath.split('/').map(encodeURIComponent).join('/');
}

const UPLOAD_ATTEMPTS = 4;
const UPLOAD_TIMEOUT_MS = 60_000;

/** Gateway timeouts and brief storage outages. A 4xx other than 408/429 will not clear by waiting. */
export function isRetryableUploadStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function request(
  method: string,
  pathname: string,
  body: Buffer | string | undefined,
  headers: Record<string, string>,
): Promise<{ status: number; body: Buffer }> {
  const { baseUrl, serviceRole } = getSettings();
  const url = new URL(pathname, baseUrl);
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method,
        headers: { ...serviceHeaders(serviceRole), ...headers },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 500, body: Buffer.concat(chunks) }));
      },
    );
    req.setTimeout(UPLOAD_TIMEOUT_MS, () => req.destroy(new Error('Upload timed out.')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function ensureBucket(bucket: string): Promise<void> {
  const payload = JSON.stringify({ id: bucket, name: bucket, public: false });
  const created = await request('POST', '/storage/v1/bucket', payload, {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(payload)),
  });
  if (created.status >= 200 && created.status < 300) return;
  const text = created.body.toString('utf8');
  if (created.status === 409 || /already exists|duplicate/i.test(text)) return;
  throw new Error(`Could not create the ${bucket} bucket (${created.status}): ${text.slice(0, 200)}`);
}

async function uploadObject(bucket: string, objectPath: string, body: Buffer, contentType: string): Promise<void> {
  const upload = () =>
    request('POST', `/storage/v1/object/${bucket}/${encodePath(objectPath)}`, body, {
      'content-type': contentType,
      'content-length': String(body.byteLength),
      'x-upsert': 'true',
    });

  let lastError = 'Upload failed.';
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      let result = await upload();
      if (result.status === 404 || /bucket not found/i.test(result.body.toString('utf8'))) {
        await ensureBucket(bucket);
        result = await upload();
      }
      if (result.status >= 200 && result.status < 300) return;
      lastError = `Upload to ${bucket} failed (${result.status}): ${result.body.toString('utf8').slice(0, 200)}`;
      if (!isRetryableUploadStatus(result.status)) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < UPLOAD_ATTEMPTS) await sleep(500 * 2 ** (attempt - 1));
  }
  throw new Error(lastError);
}

/**
 * Supabase returns a path that starts with `/object/sign/...`. Joining that
 * onto a base that already has a path drops `/storage/v1`, so the fetcher gets
 * a URL that 404s. Prefix the storage route, then resolve against the project.
 */
export function bucketSignedUrl(baseUrl: string, signedPath: string): string {
  const absolute = signedPath.startsWith('http');
  const pathAndQuery = absolute ? `${new URL(signedPath).pathname}${new URL(signedPath).search}` : signedPath;
  const p = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
  const storagePath = p.startsWith('/storage/v1/') ? p : `/storage/v1${p}`;
  return new URL(storagePath, baseUrl).toString();
}

async function signObject(bucket: string, objectPath: string, expiresIn: number): Promise<string> {
  const { baseUrl } = getSettings();
  const payload = JSON.stringify({ expiresIn });
  const result = await request('POST', `/storage/v1/object/sign/${bucket}/${encodePath(objectPath)}`, payload, {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(payload)),
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Sign in ${bucket} failed (${result.status}): ${result.body.toString('utf8').slice(0, 200)}`);
  }
  const parsed = JSON.parse(result.body.toString('utf8')) as { signedURL?: string };
  if (!parsed.signedURL) throw new Error('Sign returned no URL.');
  return bucketSignedUrl(baseUrl, parsed.signedURL);
}

async function downloadObject(bucket: string, objectPath: string): Promise<Buffer> {
  const result = await request('GET', `/storage/v1/object/${bucket}/${encodePath(objectPath)}`, undefined, {});
  if (result.status < 200 || result.status >= 300) throw new Error(`Download from ${bucket} failed (${result.status})`);
  return result.body;
}

async function removeObjects(bucket: string, objectPaths: string[]): Promise<void> {
  if (objectPaths.length === 0) return;
  const payload = JSON.stringify({ prefixes: objectPaths });
  const result = await request('DELETE', `/storage/v1/object/${bucket}`, payload, {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(payload)),
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Delete in ${bucket} failed (${result.status}): ${result.body.toString('utf8').slice(0, 200)}`);
  }
}

export type MediaBucket = {
  upload(objectPath: string, body: Buffer, contentType: string): Promise<void>;
  /** Short-lived URL Meta (or a reviewer's browser) can fetch. The bucket stays private. */
  sign(objectPath: string, expiresIn?: number): Promise<string>;
};

/** The full client: also reads objects back and deletes them (Trial Reels retention). */
export type ManagedMediaBucket = MediaBucket & {
  download(objectPath: string): Promise<Buffer>;
  /** Hard-delete objects. Missing objects are not an error. */
  remove(objectPaths: string[]): Promise<void>;
};

/** A private bucket, created on first upload. */
export function mediaBucket(bucket: string): ManagedMediaBucket {
  return {
    upload: (objectPath, body, contentType) => uploadObject(bucket, objectPath, body, contentType),
    sign: (objectPath, expiresIn = 3600) => signObject(bucket, objectPath, expiresIn),
    download: (objectPath) => downloadObject(bucket, objectPath),
    remove: (objectPaths) => removeObjects(bucket, objectPaths),
  };
}
