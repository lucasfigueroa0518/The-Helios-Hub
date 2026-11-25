import { NextResponse } from 'next/server';

import { createLiveJevRunner } from '@/lib/reels/jev/client';
import { SeedError, addReelSeed } from '@/lib/reels/seeds';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** A headline-only seed reads several pages and scores up to four candidates (and may wait on a web search). */
export const maxDuration = 120;

/**
 * Seed a Text on Screen idea (design 2026-10-29-text-on-screen-seeding): a headline, optional text of your own, an optional
 * link. The idea is scored and joins the queue by its score. Nothing is made. This click is the approval for that one idea's
 * calls only: with a link or text, two Jev calls (well under a cent); with neither, a search for the story (up to eight, one
 * per candidate pair); and a paid web search (at most 15 cents) only when the person sends `confirmPaid` after being quoted.
 * The reply always carries a `status`: added, duplicate (nothing written), needs_paid_confirm or no_match.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { headline?: unknown; text?: unknown; url?: unknown; seedAnyway?: unknown; confirmPaid?: unknown };
  try {
    return NextResponse.json(await addReelSeed({ ...body, seedAnyway: body.seedAnyway === true, confirmPaid: body.confirmPaid === true }, { jev: createLiveJevRunner() }));
  } catch (error) {
    if (error instanceof SeedError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
