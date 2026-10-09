import type { NextRequest } from 'next/server';

import { generate } from '@/lib/stories/api';
import { storiesRoute } from '@/lib/stories/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Generate: Lucas's click asks the worker for today's set (the approval boundary for its live calls). */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { series?: unknown };
  return storiesRoute(({ db, email }) => generate(db, body.series, email));
}
