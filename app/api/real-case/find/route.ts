import { anthropic } from '@/lib/anthropic';
import { findStoriesForTopic } from '@/lib/real-case/cycle';
import { LabError, realCaseRoute } from '@/lib/real-case/lab';
import { anthropicStoryScout } from '@/lib/real-case/scout';
import { liveJevTransport } from '@/lib/reels/jev/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** One scout turn searches and reads pages; give it room. */
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lucas's Find stories click on one Explainer topic (RC-10): the live story scout (Sonnet with web
 * search), the source check, and Jev. The click is the approval for this one search (estimated
 * $0.30–0.70; the lab page says so before it sends).
 */
export async function POST(request: Request) {
  return realCaseRoute(async ({ db }) => {
    const body = (await request.json().catch(() => null)) as { topicId?: unknown } | null;
    const topicId = typeof body?.topicId === 'string' ? body.topicId.trim() : '';
    if (!UUID.test(topicId)) throw new LabError('Give a topic id');
    return findStoriesForTopic({ db, scout: anthropicStoryScout(anthropic), jevTransport: liveJevTransport }, topicId);
  });
}
