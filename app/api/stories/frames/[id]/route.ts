import { NextResponse, type NextRequest } from 'next/server';

import { liveStoriesDb } from '@/lib/stories/db';
import { createStoriesStorage } from '@/lib/stories/storage';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A frame's rendered JPEG, through a short signed URL (the bucket stays private). */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;
  const { rows } = await liveStoriesDb.query<{ storage_path: string | null }>(`SELECT storage_path FROM stories.frames WHERE id = $1`, [id]);
  const path = rows[0]?.storage_path;
  if (!path) return NextResponse.json({ error: 'Not rendered yet.' }, { status: 404 });
  return NextResponse.redirect(await createStoriesStorage().sign(path, 600));
}
