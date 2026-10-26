import { NextRequest, NextResponse } from 'next/server';

import { internalEventsFilter } from '@/lib/networking/internal-filter';
import { eventCounts, latestIngestRun, listKeptEvents } from '@/lib/networking/repository';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Boston and Miami only (INTERNAL_METROS), in the list and in the counts.
  const filter = internalEventsFilter(new URL(request.url).searchParams);

  const [events, counts, ingest] = await Promise.all([
    listKeptEvents(filter),
    eventCounts({ metros: filter.metros, from: filter.from, to: filter.to }),
    latestIngestRun(),
  ]);

  return NextResponse.json({ events, counts, ingest });
}
