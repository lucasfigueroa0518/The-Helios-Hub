import { NextResponse } from 'next/server';

import { dbQuery } from '@/lib/db';
import { SeedError, addLfdSeed } from '@/lib/lfd/seeds';
import { fetchBodyLive } from '@/lib/social/ingest/select/enrich';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Seed a Last Few Days story (design 2026-10-26-last-few-days-queue-and-seeding): paste a link; its page is read with a plain
 * web request. No model, no search, nothing is made and nothing is spent: the next run takes the story first.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { url?: unknown; headline?: unknown };
  try {
    const query = (text: string, params?: unknown[]) => dbQuery(text, params as never) as never;
    return NextResponse.json(await addLfdSeed(query, body, { fetchBody: fetchBodyLive }));
  } catch (error) {
    if (error instanceof SeedError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
