import { NextRequest, NextResponse } from 'next/server';

import { INSIGHTS_REFRESH_BATCH } from '@/lib/reels/media-insights/due';
import { pollDueInsights } from '@/lib/reels/media-insights/poll';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Pull Instagram insights for reels that are still due. Graph only, no model calls. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await request.json().catch(() => null);
  try {
    const status = await pollDueInsights({ limit: INSIGHTS_REFRESH_BATCH, force: true });
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
