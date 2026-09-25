import { NextResponse } from 'next/server';

import { pendingRun, requestRun } from '@/lib/reels/repository';
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
    const queued = await requestRun('manual');
    if (queued) return NextResponse.json({ run: queued, queued: true });

    const existing = await pendingRun();
    return NextResponse.json({
      run: existing,
      queued: false,
      note:
        existing?.status === 'running'
          ? 'A run is already in progress.'
          : 'A run is already queued.',
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
