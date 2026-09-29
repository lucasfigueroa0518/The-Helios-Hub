import { NextRequest, NextResponse } from 'next/server';

import { publishReadiness, queuePublish } from '@/lib/reels/music/publish';
import { cancelScheduledPost, scheduleVideo } from '@/lib/reels/publish/schedule';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Schedule puts the reel on the next open Eastern-time slot. Force posts it
 * now. Both publish as a trial reel. The app never calls Meta.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { video_job_id?: string; mode?: string } | null;
  if (!body?.video_job_id || !UUID.test(body.video_job_id)) {
    return NextResponse.json({ error: 'video_job_id is required.' }, { status: 400 });
  }
  const force = body.mode === 'force';
  try {
    if (!force) {
      const result = await scheduleVideo(body.video_job_id);
      if (!result.scheduled) return NextResponse.json({ queued: false, note: result.note }, { status: result.status });
      return NextResponse.json({
        queued: true,
        scheduled: true,
        publishAt: result.schedule.publishAt,
        slot: result.schedule.slot,
        note: result.note,
      });
    }

    const ready = await publishReadiness(body.video_job_id, { trigger: 'force' });
    if (!ready.ok) return NextResponse.json({ queued: false, note: ready.note }, { status: ready.status });
    await cancelScheduledPost(ready.postIdeaId);
    const result = await queuePublish(body.video_job_id, 'force');
    if (!result.queued) return NextResponse.json({ queued: false, note: result.note }, { status: result.status });
    return NextResponse.json({ queued: true, id: result.id, note: 'Posting to Instagram now as a trial reel.' });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
