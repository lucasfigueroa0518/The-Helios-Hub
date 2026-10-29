import fs from 'node:fs';
import { Readable } from 'node:stream';

import { NextResponse } from 'next/server';

import { explainersDb } from '@/lib/explainers/connection';
import { contentTypeFor, localArtifactStore } from '@/lib/explainers/storage';
import { ensureReelAiDramaSchema } from '@/lib/reel-ai-drama/schema';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One Reel AI Drama job artifact: a stored file from this machine's disk (byte ranges, so the video
 * seeks), or a text artifact's content (JSON or Markdown). Local only.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await getSession()) && process.env.NODE_ENV !== 'development') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const db = await explainersDb();
  await ensureReelAiDramaSchema(db);
  const { rows } = await db.query<{ storage_path: string | null; content: string | null }>('SELECT storage_path, content FROM reel_ai_drama.artifacts WHERE id = $1', [id]);
  const row = rows[0];
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!row.storage_path) {
    const text = row.content ?? '';
    const isJson = /^\s*[[{]/.test(text);
    return new NextResponse(text, { headers: { 'content-type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' } });
  }

  const key = row.storage_path;
  const file = localArtifactStore().localPath(key);
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });
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
