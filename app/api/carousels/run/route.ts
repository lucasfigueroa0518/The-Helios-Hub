import { NextResponse } from 'next/server';

import { requestManualRun } from '@/lib/carousels/overview';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Run now queues a carousel run; the social worker claims it within a poll.
 * The app never executes a run itself. The click is the approval for the
 * run's live model and web spend (capped by the run cap setting).
 */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await requestManualRun());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
