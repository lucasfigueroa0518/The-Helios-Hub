import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { parseRankMove, recordRankMove } from '@/lib/content-type/idea-rank';
import { HUB_DATA_TAG } from '@/lib/social-hub/views/cached-dataset';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Body: `{ vertical, ideaId, kind: 'promote' | 'demote' }`. Moves this idea in today's ranking only. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let move;
  try {
    move = parseRankMove(await request.json().catch(() => null));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
  try {
    const out = await recordRankMove(move, session.email);
    revalidateTag(HUB_DATA_TAG);
    return NextResponse.json({ ok: true, ...out });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
