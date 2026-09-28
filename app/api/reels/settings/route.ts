import { NextRequest, NextResponse } from 'next/server';

import { setSetting } from '@/lib/reels/music/store';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The auto-publish switch (D-156, D-173). Stored in the database so the page
 * and the worker read the same value. Only this one setting is writable here;
 * the mix and share_to_feed are Lucas's calls from evidence.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { auto_publish?: unknown } | null;
  if (typeof body?.auto_publish !== 'boolean') {
    return NextResponse.json({ error: 'auto_publish must be true or false.' }, { status: 400 });
  }
  try {
    await setSetting('auto_publish', body.auto_publish);
    return NextResponse.json({ autoPublish: body.auto_publish });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
