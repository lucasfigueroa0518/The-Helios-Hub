import type { NextRequest } from 'next/server';

import { updateSettings } from '@/lib/memes/lfd-sim/api';
import { memesRoute } from '@/lib/memes/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The gate threshold and the picker's settings. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return memesRoute(({ db }) => updateSettings(db, body), { db: async () => (await import('@/lib/memes/lfd-sim/live')).simDb() });
}
