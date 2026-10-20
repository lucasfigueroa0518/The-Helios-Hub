import type { NextRequest } from 'next/server';

import { generate } from '@/lib/memes/api';
import { memesRoute } from '@/lib/memes/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Generate: Lucas's click queues the run(s) and wakes the runner (the approval boundary for those live calls). One-story mode queues one run per selected story. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { kind?: unknown; postId?: unknown; storyIds?: unknown };
  const { liveStorySource, kickRunner } = await import('@/lib/memes/live');
  return memesRoute(async ({ db, email }) => {
    const out = await generate(db, body, email, liveStorySource);
    kickRunner();
    return out;
  });
}
