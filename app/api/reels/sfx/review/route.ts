import { NextResponse } from 'next/server';

import finalsJson from '@/lib/reels/sfx/finals-review.json';
import reviewJson from '@/lib/reels/sfx/review.json';
import { finalsObjectPaths, reviewObjectPaths, type SfxFinalsReview, type SfxReview } from '@/lib/reels/sfx/review';
import { signFrameObject } from '@/lib/reels/visual/storage';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Same pattern as /api/reels/video/[id]: a signed CDN link with range requests. */
const SIGNED_SECONDS = 3600;
const ALLOWED = new Set([
  ...reviewObjectPaths(reviewJson as unknown as SfxReview),
  ...finalsObjectPaths(finalsJson as unknown as SfxFinalsReview),
]);

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const objectPath = new URL(request.url).searchParams.get('path') ?? '';
  if (!ALLOWED.has(objectPath)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
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
