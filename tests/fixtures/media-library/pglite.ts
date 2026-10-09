/**
 * Offline database for the photo bank tests: PGlite loaded with the real,
 * unmodified schema files (db/social_schema.sql for social.used_photos, and
 * db/media_library_schema.sql). Plus offline stand-ins: test images made
 * with sharp, an HTTP stub that serves them, and an in-memory bucket.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Query } from '@/lib/media-library/types';

function schemaSql(file: string): string {
  return readFileSync(path.join(process.cwd(), 'db', file), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('\\'))
    .join('\n');
}

async function open(opts: { withBank?: boolean; withSocial?: boolean }): Promise<{ pg: PGlite; query: Query }> {
  const pg = new PGlite();
  if (opts.withSocial !== false) await pg.exec(schemaSql('social_schema.sql'));
  if (opts.withBank !== false) await pg.exec(schemaSql('media_library_schema.sql'));
  const query: Query = async (text, params) => ({ rows: (await pg.query(text, params as unknown[])).rows as any[] });
  return { pg, query };
}

/** One database per test file (each file runs in its own process), emptied and reset to the shipped settings for every test. */
let shared: Promise<{ pg: PGlite; query: Query }> | null = null;

export async function openBankTestDb(opts: { withBank?: boolean; withSocial?: boolean } = {}): Promise<{ pg: PGlite; query: Query }> {
  if (opts.withBank === false || opts.withSocial === false) return open(opts);
  shared ??= open(opts);
  const db = await shared;
  await db.pg.exec(`
    TRUNCATE media_library.sightings, media_library.photo_sources, media_library.photos, media_library.settings, social.used_photos RESTART IDENTITY CASCADE;
    INSERT INTO media_library.settings (key, value) VALUES ('capture', 'false'::jsonb), ('finder_source', '"off"'::jsonb), ('used_photos_after_id', '0'::jsonb);`);
  return db;
}

export async function setSetting(query: Query, key: string, value: unknown): Promise<void> {
  await query(`UPDATE media_library.settings SET value = $2::jsonb WHERE key = $1`, [key, JSON.stringify(value)]);
}

/** A small test image (sharp); `seed` changes its colour, so different seeds are different bytes. */
export async function testImage(opts: { seed?: number; width?: number; height?: number; format?: 'jpeg' | 'png' } = {}): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const s = opts.seed ?? 1;
  const img = sharp({ create: { width: opts.width ?? 64, height: opts.height ?? 48, channels: 3, background: { r: (s * 53) % 256, g: (s * 101) % 256, b: (s * 197) % 256 } } });
  return opts.format === 'png' ? img.png().toBuffer() : img.jpeg({ quality: 90 }).toBuffer();
}

export type Served = { status?: number; body?: Buffer; type?: string };

/** HTTP stub: URL → response. Unknown URLs throw, so a test can never reach the network. */
export function stubHttp(routes: Record<string, Served | (() => Served)>): { http: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const http = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const r = routes[url];
    if (!r) throw new Error(`stub http: unexpected request ${url}`);
    const s = typeof r === 'function' ? r() : r;
    return new Response(s.body ? new Uint8Array(s.body) : null, { status: s.status ?? 200, headers: s.type === undefined ? { 'content-type': 'image/jpeg' } : s.type ? { 'content-type': s.type } : {} });
  }) as typeof fetch;
  return { http, calls };
}

/** An in-memory bucket; `fail` makes every upload throw. */
export function memoryBucket(opts: { fail?: boolean } = {}) {
  const objects = new Map<string, { body: Buffer; type: string }>();
  let uploads = 0;
  return {
    objects,
    get uploads() {
      return uploads;
    },
    async upload(objectPath: string, body: Buffer, contentType: string) {
      uploads++;
      if (opts.fail) throw new Error('bucket down');
      objects.set(objectPath, { body, type: contentType });
    },
  };
}
