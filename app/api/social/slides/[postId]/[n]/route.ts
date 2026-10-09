import { NextResponse, type NextRequest } from 'next/server';

import { dbQuery } from '@/lib/db';
import { mediaBucket } from '@/lib/media-bucket';
import { SLIDE_BUCKET } from '@/lib/social/overnight/config';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A carousel slide's rendered JPEG, through a short signed URL (the bucket stays private). */
export async function GET(_request: NextRequest, context: { params: Promise<{ postId: string; n: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { postId, n } = await context.params;
  const index = Number(n);
  if (!/^[0-9a-f-]{36}$/i.test(postId) || !Number.isInteger(index) || index < 0) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  const { rows } = await dbQuery<{ slide_objects: unknown }>(`SELECT slide_objects FROM social.posts WHERE id = $1`, [postId]);
  const objects = rows[0]?.slide_objects;
  const path = Array.isArray(objects) && typeof objects[index] === 'string' ? (objects[index] as string) : null;
  if (!path) return NextResponse.json({ error: 'Not rendered yet.' }, { status: 404 });
  return NextResponse.redirect(await mediaBucket(SLIDE_BUCKET).sign(path, 600));
}
