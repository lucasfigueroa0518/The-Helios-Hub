import { NextResponse } from 'next/server';

import { REVIEW_SIGNED_SECONDS, reviewAudioStoragePath, signedReviewUrl } from '@/lib/reels/review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Signed song preview for a reel on the private review link. The token is the gate. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string; audioId: string }> },
) {
  const { token, audioId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(audioId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const objectPath = await reviewAudioStoragePath(token, audioId);
    if (!objectPath) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const url = await signedReviewUrl(objectPath);
    return NextResponse.redirect(url, {
      status: 302,
      headers: { 'cache-control': `private, max-age=${REVIEW_SIGNED_SECONDS - 300}` },
    });
  } catch {
    return NextResponse.json({ error: 'Could not load this song.' }, { status: 500 });
  }
}
