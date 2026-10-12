import { NextResponse } from 'next/server';

import { runType } from '@/lib/content-type/run-today-live';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Run now queues a carousel run for the top of today's ranked queue (the
 * same plan as the Content page's Run now); the social worker claims it within a poll.
 * The app never executes a run itself. The click is the approval for the
 * run's live model and web spend (capped by the run cap setting).
 */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await runType(session.email, 'carousels'));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
