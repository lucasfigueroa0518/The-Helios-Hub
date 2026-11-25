import { runType } from '@/lib/content-type/run-today-live';
import { getSession } from '@/lib/session';

import { fieldNotesRunRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Generate on the Field Notes page: queues one manual run (a `requested` field_notes.runs row) the
 * social worker claims within a poll. The app never executes a run itself. The click is the approval
 * for the run's Claude and Jev spend, capped by field_notes.settings.run_cap_usd.
 */
export async function POST() {
  return fieldNotesRunRoute({ session: getSession, run: (email) => runType(email, 'field_notes') });
}
