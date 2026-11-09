import fs from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

/** Wikimedia, Nominatim and most newsrooms block anonymous or generic agents (research 04 §8). */
export const USER_AGENT = 'HeliosHub-ReelAiDrama/1.0 (+https://heliosgroup.ai; helios@heliosgroup.ai)';
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

/** Rate limits (Wikimedia's 429s cost Rosewood five cast photos) are retried after these waits. */
export const RETRY_WAITS_MS = [1500, 5000];
const RETRY_STATUS = new Set([429, 503]);
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type GetOptions = { sleep?: (ms: number) => Promise<void> };

async function get(http: typeof fetch, url: string, accept: string, init: RequestInit = {}, opts: GetOptions = {}): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const res = await http(url, {
      ...init,
      headers: { 'User-Agent': USER_AGENT, Accept: accept, ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) return res;
    if (RETRY_STATUS.has(res.status) && attempt < RETRY_WAITS_MS.length) {
      const after = Number(res.headers.get('retry-after'));
      await (opts.sleep ?? realSleep)(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 10_000) : RETRY_WAITS_MS[attempt]);
      continue;
    }
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
}

export async function getJson<T>(http: typeof fetch, url: string, init: RequestInit = {}): Promise<T> {
  return (await (await get(http, url, 'application/json', init)).json()) as T;
}

export async function getText(http: typeof fetch, url: string): Promise<string> {
  return (await get(http, url, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5')).text();
}

/**
 * Downloads one image into `dest` (extension chosen from the bytes). Formats the kit doesn't need are
 * converted to JPEG; nothing else about the picture changes (research 01 §11: technical edits only).
 */
export async function downloadImage(http: typeof fetch, url: string, destNoExt: string, opts: GetOptions = {}): Promise<{ file: string; bytes: Buffer }> {
  const res = await get(http, url, 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8', {}, opts);
  const type = res.headers.get('content-type') ?? '';
  if (type && !type.startsWith('image/') && !type.startsWith('application/octet-stream')) throw new Error(`not an image (${type})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`image over ${MAX_IMAGE_BYTES} bytes`);
  return saveImage(bytes, destNoExt);
}

export async function saveImage(bytes: Buffer, destNoExt: string): Promise<{ file: string; bytes: Buffer }> {
  const meta = await sharp(bytes).metadata();
  fs.mkdirSync(path.dirname(destNoExt), { recursive: true });
  if (meta.format === 'jpeg' || meta.format === 'png') {
    const file = `${destNoExt}.${meta.format === 'jpeg' ? 'jpg' : 'png'}`;
    fs.writeFileSync(file, bytes);
    return { file, bytes };
  }
  const file = `${destNoExt}.jpg`;
  const out = await sharp(bytes, { animated: false }).rotate().jpeg({ quality: 92 }).toBuffer();
  fs.writeFileSync(file, out);
  // Keep the original bytes for the metadata checks (credits and AI markers live there).
  return { file, bytes };
}

/** Runs `fn` over `items` with at most `n` in flight. */
export async function mapLimit<T, R>(items: readonly T[], n: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
