import { NextResponse } from 'next/server';
import { after } from 'next/server';

import { newAnthropic } from '@/lib/anthropic-client';
import { dbQuery } from '@/lib/db';
import { liveFileDeps } from '@/lib/seed/one-box/file-live';
import { handlePost } from '@/lib/seed/one-box/handle';
import { listCards } from '@/lib/seed/one-box/requests';
import { runOneBox } from '@/lib/seed/one-box/run';
import { openSeedCountFor } from '@/lib/seed/one-box/open-count';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** The search, a few page reads, the verifier and the add function run after the response, inside this limit. */
export const maxDuration = 300;

const q = (text: string, params?: unknown[]) => dbQuery(text, params as never) as never;

/**
 * One-box seed (design 2026-11-04-one-box-seeding-design): a sentence or two, an optional link. The click opens a request and
 * returns at once; a web-search Claude call then finds and verifies the source and files the idea in the pool's own format.
 * This click is the approval for that one seed's spend, at most the type's limit.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const out = await handlePost(body, {
    q,
    hasKey: () => Boolean(process.env.ANTHROPIC_API_KEY),
    openCount: openSeedCountFor,
    schedule: (id, input) =>
      after(() =>
        runOneBox({ q, id, input, client: newAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY }), fileDeps: liveFileDeps() }),
      ),
  });
  return NextResponse.json(out.body, { status: out.status });
}

/** The placeholder cards for one pool. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const vertical = new URL(request.url).searchParams.get('vertical') ?? '';
  return NextResponse.json({ cards: await listCards(q, vertical) });
}
