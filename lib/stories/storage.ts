/**
 * Stories frame storage (plan §2): a private Supabase Storage bucket
 * `stories`. Frames are uploaded after render; Instagram fetches each one
 * from a short-lived signed URL when the worker creates its container.
 * Modeled on lib/reels/visual/storage.ts (copied, not imported), over fetch
 * with normal TLS verification.
 */

import { serviceHeaders } from '@/lib/supabase-service-headers';

export const STORIES_BUCKET = 'stories';

export type StorageConfig = { baseUrl: string; serviceRole: string; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> };

export type StoriesStorage = {
  upload(objectPath: string, body: Buffer, contentType?: string): Promise<void>;
  /** A URL Instagram can fetch for `expiresIn` seconds; the bucket stays private. */
  sign(objectPath: string, expiresIn?: number): Promise<string>;
  download(objectPath: string): Promise<Buffer>;
  remove(objectPaths: string[]): Promise<void>;
};

/** Where a frame's JPEG lives: one folder per set. */
export function frameObjectPath(setId: string, seq: number, role: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(setId)) throw new Error(`bad set id: ${setId}`);
  return `sets/${setId}/${String(seq).padStart(2, '0')}-${role.replace(/[^a-z_]/g, '')}.jpg`;
}

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

/** Gateway timeouts and brief outages; other 4xx won't clear by waiting. */
export const isRetryable = (status: number) => [408, 429, 500, 502, 503, 504].includes(status);

/** Supabase answers `/object/sign/...`; the public URL needs the `/storage/v1` prefix. */
export function signedUrl(baseUrl: string, signedPath: string): string {
  const u = signedPath.startsWith('http') ? new URL(signedPath) : null;
  const pathAndQuery = u ? `${u.pathname}${u.search}` : signedPath;
  const p = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
  return new URL(p.startsWith('/storage/v1/') ? p : `/storage/v1${p}`, baseUrl).toString();
}

export function liveStorageConfig(): StorageConfig {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceRole) throw new Error('Supabase Storage is not configured (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)');
  return { baseUrl, serviceRole };
}

export function createStoriesStorage(cfg: StorageConfig = liveStorageConfig()): StoriesStorage {
  const doFetch = cfg.fetch ?? fetch;
  const sleep = cfg.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const call = (method: string, pathname: string, body?: Buffer | string, headers: Record<string, string> = {}) =>
    doFetch(new URL(pathname, cfg.baseUrl), {
      method,
      headers: { ...serviceHeaders(cfg.serviceRole), ...headers },
      body: body as BodyInit | undefined,
      signal: AbortSignal.timeout(60_000),
    });
  const json = (o: unknown) => ({ body: JSON.stringify(o), headers: { 'content-type': 'application/json' } });

  async function ensureBucket(): Promise<void> {
    const req = json({ id: STORIES_BUCKET, name: STORIES_BUCKET, public: false });
    const res = await call('POST', '/storage/v1/bucket', req.body, req.headers);
    if (res.ok) return;
    const text = await res.text();
    if (res.status === 409 || /already exists|duplicate/i.test(text)) return;
    throw new Error(`could not create the stories bucket (${res.status}): ${text.slice(0, 200)}`);
  }

  return {
    async upload(objectPath, body, contentType = 'image/jpeg') {
      const put = () => call('POST', `/storage/v1/object/${STORIES_BUCKET}/${encodePath(objectPath)}`, body, { 'content-type': contentType, 'x-upsert': 'true' });
      let last = 'upload failed';
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          let res = await put();
          if (res.status === 404 || /bucket not found/i.test(await res.clone().text())) {
            await ensureBucket();
            res = await put();
          }
          if (res.ok) return;
          const text = (await res.text()).slice(0, 200);
          last = /Unregistered API key|Invalid Compact JWS/.test(text)
            ? `storage rejected the Supabase key (${res.status}). The key on this machine is not registered for the project.`
            : `upload failed (${res.status}): ${text}`;
          if (!isRetryable(res.status)) break;
        } catch (err) {
          last = err instanceof Error ? err.message : String(err);
        }
        if (attempt < 4) await sleep(500 * 2 ** (attempt - 1));
      }
      throw new Error(`${objectPath}: ${last}`);
    },
    async sign(objectPath, expiresIn = 3600) {
      const req = json({ expiresIn });
      const res = await call('POST', `/storage/v1/object/sign/${STORIES_BUCKET}/${encodePath(objectPath)}`, req.body, req.headers);
      if (!res.ok) throw new Error(`sign failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
      const parsed = (await res.json()) as { signedURL?: string };
      if (!parsed.signedURL) throw new Error('sign returned no URL');
      return signedUrl(cfg.baseUrl, parsed.signedURL);
    },
    async download(objectPath) {
      const res = await call('GET', `/storage/v1/object/${STORIES_BUCKET}/${encodePath(objectPath)}`);
      if (!res.ok) throw new Error(`download failed (${res.status})`);
      return Buffer.from(await res.arrayBuffer());
    },
    async remove(objectPaths) {
      if (!objectPaths.length) return;
      const req = json({ prefixes: objectPaths });
      const res = await call('DELETE', `/storage/v1/object/${STORIES_BUCKET}`, req.body, req.headers);
      if (!res.ok) throw new Error(`delete failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    },
  };
}
