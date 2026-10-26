import { dbQuery } from '@/lib/db';
import { liveContentActions } from '@/lib/publishing/actions/live';
import { actionRoute } from '@/lib/social-hub/action-route';
import { archiveIdea } from '@/lib/social-hub/queue-store';

import { archiveContent } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = actionRoute(
  archiveContent(liveContentActions, (vertical, ideaId, by) => archiveIdea((text, params) => dbQuery(text, params as never) as never, vertical, ideaId, by)),
);
