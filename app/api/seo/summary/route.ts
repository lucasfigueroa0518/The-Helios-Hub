import { NextRequest, NextResponse } from 'next/server';

import { parsePeriod, parseSearchType, resolveSeoRange } from '@/lib/seo/format';
import { getPropertyByIdOrUrl, getSummary, latestAvailableDate, latestSyncRun, listProperties } from '@/lib/seo/repository';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const property = await getPropertyByIdOrUrl(searchParams.get('property'));
    const properties = await listProperties();
    const searchType = parseSearchType(searchParams.get('type'));
    const latest = property ? await latestAvailableDate(property.id) : await latestAvailableDate();
    const range = resolveSeoRange({
      period: parsePeriod(searchParams.get('period')),
      from: searchParams.get('from'),
      to: searchParams.get('to'),
      latestAvailable: latest,
    });
    const summary = property
      ? await getSummary({ propertyId: property.id, from: range.from, to: range.to, searchType })
      : { totals: { clicks: 0, impressions: 0, ctr: 0, position: 0 }, series: [] };
    const sync = await latestSyncRun();
    return NextResponse.json({
      property,
      properties,
      range,
      searchType,
      totals: summary.totals,
      series: summary.series,
      latestAvailableDate: latest,
      lastSyncedAt: property?.last_synced_at ?? null,
      sync,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load SEO summary';
    const status = /from must/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
