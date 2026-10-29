import { anthropic } from '@/lib/anthropic';
import { findNewsStories } from '@/lib/real-case/cycle';
import { realCaseRoute } from '@/lib/real-case/lab';
import { anthropicStoryScout } from '@/lib/real-case/scout';
import { liveJevTransport } from '@/lib/reels/jev/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** One scout turn searches and reads pages; give it room. */
export const maxDuration = 300;

/**
 * Lucas's Find stories click (RC-10, RC-27): one live news search (Sonnet with web search), the
 * source check, and Jev. The click is the approval for this one search (estimated $0.50–1.00; the lab
 * page says so before it sends).
 */
export async function POST() {
  return realCaseRoute(async ({ db }) => findNewsStories({ db, scout: anthropicStoryScout(anthropic), jevTransport: liveJevTransport }));
}
