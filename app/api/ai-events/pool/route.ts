import type { NextRequest } from 'next/server';

import { clearPoolEvent, excludePoolEvent, pinPoolEvent, queueRebuild } from '@/lib/ai-events/pool';
import { liveHubQuery as query } from '@/lib/social-hub/db';
import { getSession } from '@/lib/session';

import { aiEventsPoolRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Pin, Exclude and Clear on the AI Events pool (AE-04), and Rebuild post.
 * Pins and excludes change only ai_events.pool's pinned_* / excluded_*
 * columns for the week the pool shows; they take effect on the next build or
 * rebuild. Rebuild post queues a `rebuild` run (cached scores, no Jev call)
 * the social worker carries out.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  return aiEventsPoolRoute(
    {
      session: getSession,
      act: (action, email, eventId) => {
        if (action === 'rebuild') return queueRebuild(query, email);
        if (action === 'pin') return pinPoolEvent(query, eventId!, email);
        if (action === 'exclude') return excludePoolEvent(query, eventId!, email);
        return clearPoolEvent(query, eventId!);
      },
    },
    body,
  );
}
