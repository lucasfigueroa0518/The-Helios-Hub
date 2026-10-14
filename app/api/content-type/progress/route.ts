import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { isPostingType } from '@/lib/content-type/posting';
import { readAllProgress, readProgress } from '@/lib/content-type/progress';
import { getSession } from '@/lib/session';
import { HUB_DATA_TAG } from '@/lib/social-hub/views/cached-dataset';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const type = new URL(request.url).searchParams.get('type');
  // One request for every type's in-flight items (failed ones dropped), for pages that watch all three.
  if (type === 'all') {
    try {
      return NextResponse.json({ all: await readAllProgress() });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  }
  if (!isPostingType(type)) return NextResponse.json({ error: 'Unknown type' }, { status: 400 });
  try {
    return NextResponse.json({ items: await readProgress(type) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

/**
 * Progress moved (a run finished, a setting changed): mark the shared hub read
 * stale (views/cached-dataset.ts) so the router.refresh() that follows shows it
 * instead of the cached minute-old read.
 */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  revalidateTag(HUB_DATA_TAG);
  return NextResponse.json({ ok: true });
}
