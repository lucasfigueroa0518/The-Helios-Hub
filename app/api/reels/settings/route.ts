import { NextRequest, NextResponse } from 'next/server';

import { setSetting } from '@/lib/reels/music/store';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Review open: whether the private review link plays reels or shows the coming-soon line.
 *
 * Live is no longer set here (settings standard D16): Text on Screen's state (Paused | Approval | Live) is set in its
 * Settings tab through /api/content-type/posting, which writes auto_run and publishing_live together. Writing
 * publishing_live alone could leave Generate off with Live on, so it is refused.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { publishing_live?: unknown; review_open?: unknown } | null;
  if (body && 'publishing_live' in body) {
    return NextResponse.json({ error: "Live is set in Text on Screen's Settings tab." }, { status: 400 });
  }
  const reviewOpen = typeof body?.review_open === 'boolean' ? body.review_open : null;
  if (reviewOpen === null) return NextResponse.json({ error: 'Expected review_open as true or false.' }, { status: 400 });
  try {
    await setSetting('review_open', reviewOpen);
    return NextResponse.json({ reviewOpen });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
