import type { NextRequest } from 'next/server';

import { setDetail } from '@/lib/stories/api';
import { storiesRoute } from '@/lib/stories/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return storiesRoute(({ db }) => setDetail(db, id));
}
