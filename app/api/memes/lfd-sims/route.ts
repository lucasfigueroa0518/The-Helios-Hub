import type { NextRequest } from 'next/server';

import { createSim, listSims } from '@/lib/memes/lfd-sim/api';
import { memesRoute } from '@/lib/memes/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const simDb = async () => (await import('@/lib/memes/lfd-sim/live')).simDb();

export async function GET() {
  return memesRoute(
    async ({ db }) => {
      const out = await listSims(db);
      // Queued simulations with a free lane start here too (after a restart, or when one was queued while lanes were busy).
      if (out.sims.some((s) => s.status === 'requested')) (await import('@/lib/memes/lfd-sim/live')).kickSimRunner();
      return out;
    },
    { db: simDb },
  );
}

/** Human-led (CLAUDE.md Rule 1): a click in the LFD lab queues one simulation, about $1. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { asOf?: unknown };
  return memesRoute(
    async ({ db, email }) => {
      const out = await createSim(db, body, email);
      (await import('@/lib/memes/lfd-sim/live')).kickSimRunner();
      return out;
    },
    { db: simDb },
  );
}
