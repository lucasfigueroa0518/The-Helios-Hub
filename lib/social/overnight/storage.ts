import https from 'node:https';

import { SLIDE_BUCKET } from './config';

/**
 * Carousel slide JPEGs in a private Supabase Storage bucket, signed for Meta
 * at publish time. Copied from lib/reels/visual/storage.ts (its bucket is
 * fixed to reels-frames).
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

function isRetryableUploadStatus(status: number): boolean {
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
        rejectUnauthorized: false,
        headers: { apikey: serviceRole, authorization: `Bearer ${serviceRole}`, ...headers },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 500, body: Buffer.concat(chunks) }));
      },
    );
    req.setTimeout(UPLOAD_TIMEOUT_MS, () => req.destroy(new Error('Slide upload timed out.')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function ensureBucket(): Promise<void> {
  const payload = JSON.stringify({ id: SLIDE_BUCKET, name: SLIDE_BUCKET, public: false });
  const created = await request('POST', '/storage/v1/bucket', payload, {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(payload)),
  });
  if (created.status >= 200 && created.status < 300) return;
  const text = created.body.toString('utf8');
  if (created.status === 409 || /already exists|duplicate/i.test(text)) return;
  throw new Error(`Could not create the ${SLIDE_BUCKET} bucket (${created.status}): ${text.slice(0, 200)}`);
}

export async function uploadSlideObject(objectPath: string, body: Buffer, contentType = 'image/jpeg'): Promise<void> {
  const upload = () =>
    request('POST', `/storage/v1/object/${SLIDE_BUCKET}/${encodePath(objectPath)}`, body, {
      'content-type': contentType,
      'content-length': String(body.byteLength),
      'x-upsert': 'true',
    });

  let lastError = 'Slide upload failed.';
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      let result = await upload();
      if (result.status === 404 || /bucket not found/i.test(result.body.toString('utf8'))) {
        await ensureBucket();
        result = await upload();
      }
      if (result.status >= 200 && result.status < 300) return;
      lastError = `Slide upload failed (${result.status}): ${result.body.toString('utf8').slice(0, 200)}`;
      if (!isRetryableUploadStatus(result.status)) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < UPLOAD_ATTEMPTS) await sleep(500 * 2 ** (attempt - 1));
  }
  throw new Error(lastError);
}

/** Same `/storage/v1` prefix fix as the reels frames (lib/reels/visual/storage.ts frameSignedUrl). */
export function slideSignedUrl(baseUrl: string, signedPath: string): string {
  const absolute = signedPath.startsWith('http');
  const pathAndQuery = absolute ? `${new URL(signedPath).pathname}${new URL(signedPath).search}` : signedPath;
  const p = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
  const storagePath = p.startsWith('/storage/v1/') ? p : `/storage/v1${p}`;
  return new URL(storagePath, baseUrl).toString();
}

/** Short-lived URL Meta can fetch. The bucket stays private. */
export async function signSlideObject(objectPath: string, expiresIn = 3600): Promise<string> {
  const { baseUrl } = getSettings();
  const payload = JSON.stringify({ expiresIn });
  const result = await request('POST', `/storage/v1/object/sign/${SLIDE_BUCKET}/${encodePath(objectPath)}`, payload, {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(payload)),
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Slide sign failed (${result.status}): ${result.body.toString('utf8').slice(0, 200)}`);
  }
  const parsed = JSON.parse(result.body.toString('utf8')) as { signedURL?: string };
  if (!parsed.signedURL) throw new Error('Slide sign returned no URL.');
  return slideSignedUrl(baseUrl, parsed.signedURL);
}
