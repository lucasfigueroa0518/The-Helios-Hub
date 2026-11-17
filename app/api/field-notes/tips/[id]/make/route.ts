import { queueTipFieldNotesRun } from '@/lib/field-notes/manual';
import { liveHubQuery } from '@/lib/social-hub/db';
import { getSession } from '@/lib/session';

import { fieldNotesTipMakeRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Make it on a Field Notes tip (pool UI contract §5): queues one manual run (a `requested` field_notes.runs row carrying
 * this tip) that the social worker claims within a poll; the tip goes first and the queue fills the rest. The same auth
 * and cap check as Generate (/api/field-notes/run): the click approves the run's Claude and Jev spend, capped by
 * field_notes.settings.run_cap_usd. Nothing runs here.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return fieldNotesTipMakeRoute({ session: getSession, make: (email, tipId) => queueTipFieldNotesRun(liveHubQuery, tipId, email) }, id);
}
