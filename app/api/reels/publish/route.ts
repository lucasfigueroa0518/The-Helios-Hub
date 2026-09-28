import { NextRequest, NextResponse } from 'next/server';

import { queuePublish } from '@/lib/reels/music/publish';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Approve (D-155): queues the reel to publish as a trial reel with its song.
 * The helios-reels worker talks to Instagram; the app never calls Meta.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { video_job_id?: string } | null;
  if (!body?.video_job_id || !UUID.test(body.video_job_id)) {
    return NextResponse.json({ error: 'video_job_id is required.' }, { status: 400 });
  }
  try {
    const result = await queuePublish(body.video_job_id, 'approve');
    if (!result.queued) return NextResponse.json({ queued: false, note: result.note }, { status: result.status });
    return NextResponse.json({ queued: true, id: result.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
