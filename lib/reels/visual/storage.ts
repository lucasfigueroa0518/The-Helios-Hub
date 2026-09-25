import https from 'node:https';

const FRAME_BUCKET = 'reels-frames';

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
        rejectUnauthorized: false,
        headers: {
          apikey: serviceRole,
          authorization: `Bearer ${serviceRole}`,
          ...headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          resolve({ status: response.statusCode ?? 500, body: Buffer.concat(chunks) });
        });
      },
    );
    req.setTimeout(UPLOAD_TIMEOUT_MS, () => {
      req.destroy(new Error('Frame upload timed out.'));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureBucket(): Promise<void> {
  const payload = JSON.stringify({ id: FRAME_BUCKET, name: FRAME_BUCKET, public: false });
  const created = await request('POST', '/storage/v1/bucket', payload, {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(payload)),
  });
  if (created.status >= 200 && created.status < 300) return;
  const text = created.body.toString('utf8');
  if (created.status === 409 || /already exists|duplicate/i.test(text)) return;
  throw new Error(`Could not create the reels frame bucket (${created.status}): ${text.slice(0, 200)}`);
}

export async function uploadFrameObject(
  objectPath: string,
  body: Buffer,
  contentType = 'image/png',
): Promise<void> {
  const upload = () =>
    request('POST', `/storage/v1/object/${FRAME_BUCKET}/${encodePath(objectPath)}`, body, {
      'content-type': contentType,
      'content-length': String(body.byteLength),
      'x-upsert': 'true',
    });

  let lastError = 'Frame upload failed.';
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      let result = await upload();
      if (result.status === 404 || /bucket not found/i.test(result.body.toString('utf8'))) {
        await ensureBucket();
        result = await upload();
      }
      if (result.status >= 200 && result.status < 300) return;
      lastError = `Frame upload failed (${result.status}): ${result.body.toString('utf8').slice(0, 200)}`;
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
 * onto a base that already has a path drops `/storage/v1`, so Fal fetches a
 * URL that 404s. Prefix the storage route, then resolve against the project.
 */
export function frameSignedUrl(baseUrl: string, signedPath: string): string {
  const absolute = signedPath.startsWith('http');
  const pathAndQuery = absolute ? `${new URL(signedPath).pathname}${new URL(signedPath).search}` : signedPath;
  const path = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
  const storagePath = path.startsWith('/storage/v1/') ? path : `/storage/v1${path}`;
  return new URL(storagePath, baseUrl).toString();
}

/** Short-lived URL so Fal can fetch the background still. The bucket stays private. */
export async function signFrameObject(objectPath: string, expiresIn = 3600): Promise<string> {
  const { baseUrl } = getSettings();
  const payload = JSON.stringify({ expiresIn });
  const result = await request(
    'POST',
    `/storage/v1/object/sign/${FRAME_BUCKET}/${encodePath(objectPath)}`,
    payload,
    {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(payload)),
    },
  );
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Frame sign failed (${result.status}): ${result.body.toString('utf8').slice(0, 200)}`);
  }
  const parsed = JSON.parse(result.body.toString('utf8')) as { signedURL?: string };
  if (!parsed.signedURL) throw new Error('Frame sign returned no URL.');
  return frameSignedUrl(baseUrl, parsed.signedURL);
}

export async function downloadFrameObject(objectPath: string): Promise<Buffer> {
  const result = await request('GET', `/storage/v1/object/${FRAME_BUCKET}/${encodePath(objectPath)}`, undefined, {});
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Frame download failed (${result.status})`);
  }
  return result.body;
}
