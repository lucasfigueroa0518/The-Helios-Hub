import { NextRequest, NextResponse } from 'next/server';

import { setSetting } from '@/lib/reels/music/store';
import { scheduleLatestToday } from '@/lib/reels/publish/schedule';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Live is the nightly auto-schedule. Turning it on also places today's
 * still-unpublished selected reels into open slots. Reels already on the
 * clock stay there if it is turned off.
 *
 * Review open is separate: it only decides whether the private review link
 * plays reels or shows the coming-soon line.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    publishing_live?: unknown;
    review_open?: unknown;
  } | null;
  const publishingLive = typeof body?.publishing_live === 'boolean' ? body.publishing_live : null;
  const reviewOpen = typeof body?.review_open === 'boolean' ? body.review_open : null;
  if (publishingLive === null && reviewOpen === null) {
    return NextResponse.json({ error: 'Expected a true or false setting.' }, { status: 400 });
  }
  try {
    if (reviewOpen !== null) await setSetting('review_open', reviewOpen);
    if (publishingLive === null) {
      return NextResponse.json({ reviewOpen });
    }
    await setSetting('publishing_live', publishingLive);
    const scheduled = publishingLive ? await scheduleLatestToday() : { scheduled: 0 };
    return NextResponse.json({
      publishingLive,
      scheduled: scheduled.scheduled,
      ...(reviewOpen !== null ? { reviewOpen } : {}),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
