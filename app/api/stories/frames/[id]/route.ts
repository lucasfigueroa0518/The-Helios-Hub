import { NextResponse, type NextRequest } from 'next/server';

import { liveStoriesDb } from '@/lib/stories/db';
import { createStoriesStorage } from '@/lib/stories/storage';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A frame's rendered JPEG, through a short signed URL (the bucket stays private). An AI Trivia frame is a clip:
 * this serves its poster (what an <img> can show); `?media=video` serves the MP4 itself. Poster read through
 * to_jsonb so the route works before db/stories_ai_trivia.sql is applied.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;
  const { rows } = await liveStoriesDb.query<{ storage_path: string | null; poster_path: string | null }>(
    `SELECT storage_path, to_jsonb(f)->>'poster_path' AS poster_path FROM stories.frames f WHERE id = $1`,
    [id],
  );
  const wantVideo = request.nextUrl.searchParams.get('media') === 'video';
  const path = wantVideo ? rows[0]?.storage_path : (rows[0]?.poster_path ?? rows[0]?.storage_path);
  if (!path) return NextResponse.json({ error: 'Not rendered yet.' }, { status: 404 });
  const response = NextResponse.redirect(await createStoriesStorage().sign(path, 600));
  // The signature lasts 600s. The browser may reuse this redirect for a little less, so it doesn't follow an expired URL.
  response.headers.set('Cache-Control', 'private, max-age=540');
  return response;
}
