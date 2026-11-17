import type { NextRequest } from 'next/server';

import { listView, listedSeries, monthOverview } from '@/lib/stories/api';
import { storiesRoute } from '@/lib/stories/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The queue or history: `?vertical=` (a Stories-format type's sets, SS-25) or `?series=`; neither lists every series. */
export async function GET(request: NextRequest) {
  const view = request.nextUrl.searchParams.get('view') === 'history' ? 'history' : 'queue';
  const series = listedSeries({ vertical: request.nextUrl.searchParams.get('vertical'), series: request.nextUrl.searchParams.get('series') });
  return storiesRoute(async ({ db }) => ({ sets: await listView(db, view, series), spend: await monthOverview(db) }));
}
