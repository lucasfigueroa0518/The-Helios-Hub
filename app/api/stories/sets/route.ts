import type { NextRequest } from 'next/server';

import { isSeries, listView, monthOverview } from '@/lib/stories/api';
import { storiesRoute } from '@/lib/stories/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const view = request.nextUrl.searchParams.get('view') === 'history' ? 'history' : 'queue';
  const series = request.nextUrl.searchParams.get('series');
  return storiesRoute(async ({ db }) => ({ sets: await listView(db, view, isSeries(series) ? series : undefined), spend: await monthOverview(db) }));
}
