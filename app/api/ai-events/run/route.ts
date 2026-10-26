import { runType } from '@/lib/content-type/run-today-live';
import { getSession } from '@/lib/session';

import { aiEventsRunRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Generate on the AI Events page (plan M4): queues one manual build (a
 * `requested` ai_events.runs row), on any day; the social worker claims it
 * within a poll (or scripts/ai_events_once.ts, by hand). The app never
 * executes a run itself. The click is the approval for the run's Jev spend,
 * capped by ai_events.settings.run_cap_usd. No Claude call.
 */
export async function POST() {
  return aiEventsRunRoute({ session: getSession, run: (email) => runType(email, 'ai_events') });
}
