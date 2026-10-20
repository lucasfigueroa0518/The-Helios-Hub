import type { NextRequest } from 'next/server';

import { gradeSim } from '@/lib/memes/lfd-sim/api';
import { memesRoute } from '@/lib/memes/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lucas's 1–4 grade and note for a whole simulated post. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { rating?: unknown; note?: unknown };
  return memesRoute(({ db, email }) => gradeSim(db, id, body, email), { db: async () => (await import('@/lib/memes/lfd-sim/live')).simDb() });
}
