import { NextResponse, type NextRequest } from 'next/server';

import { liveStoriesDb } from '@/lib/stories/db';
import { exportAuthorized as authorized } from '@/lib/stories/trivia/export-auth';
import { exportDays } from '@/lib/stories/trivia/game-days';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/public/trivia-game/days?after=YYYY-MM-DD: the "Are you Smarter Than AI?" game's locked days for
 * heliosgroup.ai (planning/AI Trivia/Game/HUB-PLAN.md, BUILD-PLAN.md §6.2). Bearer HUB_GAME_EXPORT_TOKEN.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request.headers.get('authorization'), process.env.HUB_GAME_EXPORT_TOKEN)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const after = request.nextUrl.searchParams.get('after');
  if (after !== null && !/^\d{4}-\d{2}-\d{2}$/.test(after)) return NextResponse.json({ error: 'after must be YYYY-MM-DD' }, { status: 400 });
  try {
    return NextResponse.json(await exportDays(liveStoriesDb, after), { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.error('trivia-game export failed', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'export failed' }, { status: 500 });
  }
}
