import { NextRequest, NextResponse } from 'next/server';

import { queueVisualFrame } from '@/lib/reels/visual/run';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Generate frame queues one still. The helios-reels worker claims it. The app
 * does not call Claude or the image model itself.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    post_idea_id?: string;
    slate_id?: string;
  } | null;
  if (!body?.post_idea_id || !body.slate_id || !UUID.test(body.post_idea_id) || !UUID.test(body.slate_id)) {
    return NextResponse.json({ error: 'post_idea_id and slate_id are required.' }, { status: 400 });
  }

  try {
    const result = await queueVisualFrame(body.post_idea_id, body.slate_id);
    if (!result.queued) {
      const status = result.status === 200 ? 200 : result.status;
      return NextResponse.json(
        status === 200 ? { queued: false, note: result.note } : { queued: false, error: result.note },
        { status },
      );
    }
    return NextResponse.json({ queued: true, id: result.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
