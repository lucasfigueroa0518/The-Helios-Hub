import type { NextRequest } from 'next/server';

import { generateNow, requestedSeries } from '@/lib/stories/api';
import { storiesRoute } from '@/lib/stories/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Generate: Lucas's click asks the worker for today's set (the approval boundary for its live calls); with the calendar, for the series' first open
 * Stories slot. The body names a Stories-format type (`vertical`, SS-25) or its `series`; the type's own series is requested.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { vertical?: unknown; series?: unknown };
  return storiesRoute(({ db, email }) => generateNow(db, requestedSeries(body), email));
}
