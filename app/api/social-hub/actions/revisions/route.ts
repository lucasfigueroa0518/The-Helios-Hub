import { liveContentActions } from '@/lib/publishing/actions/live';
import { actionReadRoute } from '@/lib/social-hub/action-route';

import { revisionsRead } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The revision box's poll: a post's revision rows (Targeted Revisions). Unreachable (404) while the `revise` flag is off. */
export const GET = actionReadRoute(revisionsRead(liveContentActions));
