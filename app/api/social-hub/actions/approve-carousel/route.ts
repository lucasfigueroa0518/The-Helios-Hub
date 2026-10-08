import { actionRoute } from '@/lib/social-hub/action-route';
import { approveSchedule } from '@/lib/social/overnight/schedule';
import { socialQuery } from '@/lib/social/store';

import { approveCarousel } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = actionRoute(approveCarousel({ approveSchedule: approveSchedule as never, socialQuery }));
