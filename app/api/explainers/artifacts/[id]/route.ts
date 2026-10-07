import fs from 'node:fs';
import { Readable } from 'node:stream';

import { NextResponse } from 'next/server';

import { explainersDb } from '@/lib/explainers/connection';
import { localArtifactStore } from '@/lib/explainers/storage';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES: Record<string, string> = { mp4: 'video/mp4', jpg: 'image/jpeg', png: 'image/png', json: 'application/json', jsonl: 'application/x-ndjson' };

/**
 * A stored render file (video, contact sheet, captions, transcript), from local
 * storage until E-22 picks the bucket. Byte ranges are served so the video seeks.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const db = await explainersDb();
  const { rows } = await db.query<{ storage_path: string | null }>('SELECT storage_path FROM explainers.artifacts WHERE id = $1', [id]);
  const key = rows[0]?.storage_path;
  const file = key ? localArtifactStore().localPath(key) : null;
  if (!key || !file) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const size = fs.statSync(file).size;
  const type = TYPES[key.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      return new NextResponse(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    }
    const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
    return new NextResponse(stream, {
      status: 206,
      headers: {
        'content-type': type,
        'content-length': String(end - start + 1),
        'content-range': `bytes ${start}-${end}/${size}`,
        'accept-ranges': 'bytes',
        'cache-control': 'private, max-age=3600',
      },
    });
  }
  const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
  return new NextResponse(stream, {
    headers: { 'content-type': type, 'content-length': String(size), 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600' },
  });
}
