import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { parseQueueAction, recordQueueAction } from '@/lib/content-type/idea-queue';
import { getSession } from '@/lib/session';
import { HUB_DATA_TAG, loadHubDataset } from '@/lib/social-hub/views/cached-dataset';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Body: `{ vertical, action: 'pin' | 'unpin' | 'archive', ideaId }`, a drag
 * `{ vertical, action: 'place', ideaId, aboveId, belowId, up }`, or
 * `{ vertical, action: 'reorder-pins', order }`. Moves this idea in the type's queue.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let move;
  try {
    move = parseQueueAction(await request.json().catch(() => null));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
  try {
    await recordQueueAction(move, session.email, await loadHubDataset());
    revalidateTag(HUB_DATA_TAG);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const status = typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
