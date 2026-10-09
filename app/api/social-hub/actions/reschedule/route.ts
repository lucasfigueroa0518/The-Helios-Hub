import { liveContentActions } from '@/lib/publishing/actions/live';
import { actionRoute } from '@/lib/social-hub/action-route';

import { rescheduleContent } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = actionRoute(rescheduleContent(liveContentActions));
