import { NextResponse } from 'next/server';

import { REVIEW_SIGNED_SECONDS, reviewVideoStoragePath, signedReviewUrl } from '@/lib/reels/review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Signed video for a reel on the private review link. The token is the gate. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const objectPath = await reviewVideoStoragePath(token, id);
    if (!objectPath) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const url = await signedReviewUrl(objectPath);
    return NextResponse.redirect(url, {
      status: 302,
      headers: { 'cache-control': `private, max-age=${REVIEW_SIGNED_SECONDS - 300}` },
    });
  } catch {
    return NextResponse.json({ error: 'Could not load this reel.' }, { status: 500 });
  }
}
