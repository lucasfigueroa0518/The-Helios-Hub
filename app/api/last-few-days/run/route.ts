import { runType } from '@/lib/content-type/run-today-live';
import { getSession } from '@/lib/session';

import { lfdRunRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "Make Last Few Days now" (spec §8): queues one manual run (a `requested`
 * lfd.runs row), on any day; the social worker claims it within a poll. The
 * app never executes a run itself. The click is the approval for the run's
 * live model and web spend, capped by lfd.settings.run_cap_usd.
 */
export async function POST() {
  return lfdRunRoute({ session: getSession, run: (email) => runType(email, 'last_few_days') });
}
