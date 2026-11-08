import fs from 'node:fs';
import { Readable } from 'node:stream';

import { NextResponse } from 'next/server';

import type { Queryable } from '@/lib/explainers/db';
import { contentTypeFor, localArtifactStore, type ArtifactStore } from '@/lib/explainers/storage';
import { ensureReelAiDramaSchema, SchemaNotAppliedError } from '@/lib/reel-ai-drama/schema';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ArtifactRouteOpts = {
  session?: () => Promise<{ email: string } | null>;
  db?: () => Promise<Queryable>;
  store?: Pick<ArtifactStore, 'localPath'>;
  sign?: (key: string) => Promise<string>;
};

/**
 * One AI Drama job artifact (the explainers artifacts route pattern): a text artifact's content; a stored file from
 * this disk (byte ranges, so the video seeks); else, when the file's copy is in the bucket, a 302 to a short-lived signed URL.
 */
export async function dramaArtifactResponse(request: Request, id: string, opts: ArtifactRouteOpts = {}): Promise<Response> {
  let session = opts.session ? await opts.session() : await (await import('@/lib/session')).getSession();
  if (!session && !opts.session && process.env.NODE_ENV === 'development') session = { email: 'local' };
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!UUID.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let rows: Array<{ storage_path: string | null; storage_location: string | null; content: string | null }>;
  try {
    const db = opts.db ? await opts.db() : await (await import('@/lib/explainers/connection')).explainersDb();
    await ensureReelAiDramaSchema(db);
    ({ rows } = await db.query('SELECT storage_path, storage_location, content FROM reel_ai_drama.artifacts WHERE id = $1', [id]));
  } catch (error) {
    if (error instanceof SchemaNotAppliedError) return NextResponse.json({ error: error.message }, { status: 503 });
    throw error;
  }
  const row = rows[0];
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!row.storage_path) {
    const text = row.content ?? '';
    const isJson = /^\s*[[{]/.test(text);
    return new NextResponse(text, { headers: { 'content-type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' } });
  }

  const key = row.storage_path;
  const file = (opts.store ?? localArtifactStore()).localPath(key);
  if (!file) {
    if (row.storage_location !== 'bucket') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    try {
      const sign = opts.sign ?? (async (k: string) => (await import('@/lib/explainers/storage')).signArtifact(k));
      return NextResponse.redirect(await sign(key), { status: 302, headers: { 'cache-control': 'private, no-store' } });
    } catch (error) {
      return NextResponse.json({ error: `The file is in Storage but could not be opened (${error instanceof Error ? error.message : String(error)}).` }, { status: 502 });
    }
  }
  const size = fs.statSync(file).size;
  const type = contentTypeFor(key);
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new NextResponse(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
    return new NextResponse(stream, {
      status: 206,
      headers: { 'content-type': type, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600' },
    });
  }
  const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
  return new NextResponse(stream, { headers: { 'content-type': type, 'content-length': String(size), 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600' } });
}
