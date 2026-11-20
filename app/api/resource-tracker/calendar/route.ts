import { NextResponse, type NextRequest } from 'next/server';

import { liveNetworkingQuery } from '@/lib/networking/repository';
import { calendarStats } from '@/lib/resource-tracker/calendar-stats';
import { parseRange } from '@/lib/resource-tracker/types';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Resource Tracker: networking calendar RSVP click-throughs and page visitors. */
export async function GET(request: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  try {
    return NextResponse.json(await calendarStats(liveNetworkingQuery, parseRange(request.nextUrl.searchParams.get('range')), new Date()));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
