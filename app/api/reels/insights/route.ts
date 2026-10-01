import { NextRequest, NextResponse } from 'next/server';

import { performancePeriod, periodDays, publishedSince } from '@/lib/reels/analytics/performance';
import { pollMediaInsights } from '@/lib/reels/media-insights/poll';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Pull Instagram insights for the window open on Performance Analytics. Graph only, no model calls. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { period?: unknown } | null;
  const period = performancePeriod(typeof body?.period === 'string' ? body.period : undefined);
  try {
    const status = await pollMediaInsights({
      since: publishedSince(periodDays(period), new Date()),
    });
    return NextResponse.json({
      blocked: status.blocked,
      message: status.message,
      considered: status.considered,
      written: status.written,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
