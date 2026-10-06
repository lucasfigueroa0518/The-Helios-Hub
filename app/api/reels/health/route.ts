import { NextRequest, NextResponse } from 'next/server';

import { loadHealthPage } from '@/lib/reels/health';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Live health snapshot. The page polls this while a night or a reel is in progress. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const days = request.nextUrl.searchParams.get('days') === '30' ? 30 : 7;
  try {
    const page = await loadHealthPage(days);
    return NextResponse.json(page);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
