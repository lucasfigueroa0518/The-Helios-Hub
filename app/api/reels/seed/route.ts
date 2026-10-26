import { NextResponse } from 'next/server';

import { createLiveJevRunner } from '@/lib/reels/jev/client';
import { SeedError, addReelSeed } from '@/lib/reels/seeds';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Seed a Text on Screen idea (design 2026-10-26-text-on-screen-seeding): a headline, optional text of your own, an optional
 * link. The idea is scored once (two Jev calls, well under a cent) and joins the queue. Nothing is made. This click is the
 * approval for that one idea's calls only.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { headline?: unknown; text?: unknown; url?: unknown };
  try {
    return NextResponse.json(await addReelSeed(body, { jev: createLiveJevRunner() }));
  } catch (error) {
    if (error instanceof SeedError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
