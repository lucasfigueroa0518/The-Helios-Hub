import type { NextRequest } from 'next/server';

import { labGet, recordGuess } from '@/lib/stories/roa/lab';
import { storiesRoute } from '@/lib/stories/route';
import { createStoriesStorage } from '@/lib/stories/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Signed image URLs last as long as a batch reasonably takes. */
const SIGN_SECONDS = 3600;

/**
 * The Real or AI? swipe lab (planning/Real or AI/CONTRACT.md §4 B). GET starts a blind batch (or, with `?batch=`,
 * scores one); POST records a guess. Reads the pool, writes only stories.roa_lab (RA-4).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  return storiesRoute(({ db }) => labGet(db, params, { sign: (paths) => createStoriesStorage().signMany(paths, SIGN_SECONDS) }));
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as unknown;
  return storiesRoute(({ db }) => recordGuess(db, body));
}
