import { actionRoute } from '@/lib/social-hub/action-route';
import { schedulePostIdea } from '@/lib/reels/publish/schedule';

import { approveTrialReel } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = actionRoute(approveTrialReel({ schedulePostIdea: schedulePostIdea as never }));
