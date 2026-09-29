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
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    publishing_live?: unknown;
    auto_publish?: unknown;
  } | null;
  if (typeof body?.publishing_live !== 'boolean' && typeof body?.auto_publish !== 'boolean') {
    return NextResponse.json({ error: 'publishing_live must be true or false.' }, { status: 400 });
  }
  try {
    if (typeof body.auto_publish === 'boolean') await setSetting('auto_publish', body.auto_publish);
    if (typeof body.publishing_live !== 'boolean') {
      return NextResponse.json({ autoPublish: body.auto_publish });
    }
    await setSetting('publishing_live', body.publishing_live);
    const scheduled = body.publishing_live ? await scheduleLatestToday() : { scheduled: 0 };
    return NextResponse.json({ publishingLive: body.publishing_live, scheduled: scheduled.scheduled });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
