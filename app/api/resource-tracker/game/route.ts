import { NextResponse, type NextRequest } from 'next/server';

import { gameStats, liveGameQuery } from '@/lib/resource-tracker/game-stats';
import { parseRange } from '@/lib/resource-tracker/types';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Resource Tracker: "Are you smarter than AI?" players, the AI's results and each day's questions (site Supabase, read-only). */
export async function GET(request: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const range = parseRange(request.nextUrl.searchParams.get('range'));
  try {
    return NextResponse.json(await gameStats(liveGameQuery(), range, new Date()));
  } catch (err) {
    return NextResponse.json({ range, configured: true, error: err instanceof Error ? err.message : String(err), days: [], topPlayers: [], questions: {}, totals: { players: 0, plays: 0, finishRate: null, returningShare: null, beatAiShare: null }, viewsNote: null });
  }
}
