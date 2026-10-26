import type { NextRequest } from 'next/server';

import { seedIdea } from '@/lib/stories/seed';
import { storiesRoute } from '@/lib/stories/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Seed an idea (idea seeding spec): type a story, a number or a tool into a series' pool. No model or web call; nothing is built. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return storiesRoute(({ db }) => seedIdea(db, body));
}
