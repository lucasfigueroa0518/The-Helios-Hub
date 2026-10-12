import { NextResponse } from 'next/server';

import { runType } from '@/lib/content-type/run-today-live';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Run now queues a night; the helios-reels worker claims it within a poll
 * interval. The app never executes a run itself: a full ingest outlives any
 * serverless request, and production ingestion lives on the VM (D-017).
 */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // The same plan as the Content page's Run now: today's missing reels are built, or a night runs when there is no slate yet.
    return NextResponse.json(await runType(session.email, 'reels'));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
