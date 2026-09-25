import { NextRequest, NextResponse } from 'next/server';

import { requestFinish } from '@/lib/reels/visual/finish';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Whole generation queues the first missing stage (copy, frame, or video).
 * The helios-reels worker carries the idea through to a finished reel.
 * The app does not call Claude, Jev, or Kling.
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
    const result = await requestFinish(body.post_idea_id, body.slate_id);
    if (result.status === 'failed') {
      return NextResponse.json({ queued: false, error: result.note }, { status: 409 });
    }
    return NextResponse.json({ queued: result.status === 'active', note: result.note });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
