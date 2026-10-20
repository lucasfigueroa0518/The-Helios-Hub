import type { NextRequest } from 'next/server';

import { previewPost } from '@/lib/memes/api';
import { memesRoute } from '@/lib/memes/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const postRef = request.nextUrl.searchParams.get('postRef') ?? '';
  return memesRoute(({ db }) => previewPost(db, postRef));
}
