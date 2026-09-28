import { NextResponse } from 'next/server';

import { songPreviewPath } from '@/lib/reels/music/store';
import { signFrameObject } from '@/lib/reels/visual/storage';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SIGNED_SECONDS = 3600;

/** The cached preview of a pool song (D-154), by signed redirect like the reel video. */
export async function GET(_request: Request, context: { params: Promise<{ audioId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { audioId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(audioId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const objectPath = await songPreviewPath(audioId);
    if (!objectPath) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const url = await signFrameObject(objectPath, SIGNED_SECONDS);
    return NextResponse.redirect(url, {
      status: 302,
      headers: { 'cache-control': `private, max-age=${SIGNED_SECONDS - 300}` },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
