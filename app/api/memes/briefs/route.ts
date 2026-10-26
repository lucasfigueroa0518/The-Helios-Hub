import type { NextRequest } from 'next/server';

import { requestBriefs } from '@/lib/memes/api';
import { memesRoute } from '@/lib/memes/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Human-led: structure selected LFD stories into briefs, in parallel. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { storyIds?: unknown; mode?: unknown };
  const { newAnthropic } = await import('@/lib/anthropic-client');
  return memesRoute(async ({ db }) => {
    const client = newAnthropic();
    return requestBriefs(db, body, (p) => client.messages.create(p));
  });
}
