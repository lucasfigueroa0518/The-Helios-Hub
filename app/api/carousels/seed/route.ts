import { NextResponse } from 'next/server';

import { dbQuery } from '@/lib/db';
import { fetchBodyLive } from '@/lib/social/ingest/select/enrich';
import { createJevAsk } from '@/lib/social/jev/client';
import { SeedError, addCarouselSeed } from '@/lib/social/overnight/seeds';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Seed a story (design 2026-10-25-carousels-seeding): paste a link; its page is read with a plain web request and the story is
 * scored once (one Jev call, a fraction of a cent). Nothing is made. This click is the approval for that one call.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { url?: unknown; headline?: unknown };
  try {
    const query = (text: string, params?: unknown[]) => dbQuery(text, params as never) as never;
    return NextResponse.json(await addCarouselSeed(query, body, { fetchBody: fetchBodyLive, jev: createJevAsk() }));
  } catch (error) {
    if (error instanceof SeedError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
