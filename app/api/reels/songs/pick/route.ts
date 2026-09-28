import { NextRequest, NextResponse } from 'next/server';

import { queueSongPick } from '@/lib/reels/music/pick';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Retry a failed or pending song pick (D-170). The worker runs it. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { video_job_id?: string } | null;
  if (!body?.video_job_id || !UUID.test(body.video_job_id)) {
    return NextResponse.json({ error: 'video_job_id is required.' }, { status: 400 });
  }
  try {
    return NextResponse.json(await queueSongPick(body.video_job_id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
