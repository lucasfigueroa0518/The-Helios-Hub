import { NextResponse } from 'next/server';

import { getSession } from '@/lib/session';
import { signFrameObject } from '@/lib/reels/visual/storage';
import { loadVideoObject } from '@/lib/reels/visual/video-run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Signed links last an hour; the browser reuses the redirect a little less than that. */
const SIGNED_SECONDS = 3600;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    const objectPath = await loadVideoObject(id);
    if (!objectPath) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    // Redirect to a signed storage URL: served from the CDN with range
    // requests, so the browser can start playing before the whole file loads.
    const url = await signFrameObject(objectPath, SIGNED_SECONDS);
    return NextResponse.redirect(url, {
      status: 302,
      headers: { 'cache-control': `private, max-age=${SIGNED_SECONDS - 300}` },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
