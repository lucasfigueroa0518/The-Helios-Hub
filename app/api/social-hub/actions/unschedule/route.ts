import { liveContentActions } from '@/lib/publishing/actions/live';
import { actionRoute } from '@/lib/social-hub/action-route';

import { unscheduleContent } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = actionRoute(unscheduleContent(liveContentActions));
