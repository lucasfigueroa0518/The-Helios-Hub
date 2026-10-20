import type { NextRequest } from 'next/server';

import { memesRoute } from '@/lib/memes/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Human-led (CLAUDE.md Rule 1): fill the gate's short cells with stories Lucas approved. Each story gets Jev
 * tags, a body brief (about $0.04) and one meme run (about $0.12). Body: { urls: string[] } (Hub canonical URLs).
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { urls?: unknown };
  const urls = Array.isArray(body.urls) ? body.urls.filter((u): u is string => typeof u === 'string') : [];
  return memesRoute(
    async ({ db, email }) => {
      const { fillStories } = await import('@/lib/memes/lfd-sim/fill');
      const { readOnly } = await import('@/lib/memes/lfd-sim/router');
      const { liveHubQuery } = await import('@/lib/social-hub/db');
      const { createJevAsk } = await import('@/lib/social/jev/client');
      const { generateBriefs } = await import('@/lib/memes/brief-from-body');
      const { newAnthropic } = await import('@/lib/anthropic-client');
      const { kickRunner } = await import('@/lib/memes/live');
      const client = newAnthropic();
      return fillStories(
        {
          db, hub: readOnly(liveHubQuery), jev: createJevAsk(), by: email, kickMemes: kickRunner,
          briefs: async (ids) => (await generateBriefs(db, ids, 'from-body', (p) => client.messages.create(p))).spent,
        },
        urls,
      );
    },
    { db: async () => (await import('@/lib/memes/lfd-sim/live')).simDb() },
  );
}
