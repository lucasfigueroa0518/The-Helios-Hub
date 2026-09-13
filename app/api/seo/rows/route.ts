import { NextRequest, NextResponse } from 'next/server';

import { isSeoDimension, parsePeriod, parseSearchType, resolveSeoRange } from '@/lib/seo/format';
import { getPropertyByIdOrUrl, latestAvailableDate, listDimensionRows } from '@/lib/seo/repository';
import type { SeoBreakdownTab } from '@/lib/seo/types';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';

const SORTS = new Set(['clicks', 'impressions', 'ctr', 'position', 'key']);

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const property = await getPropertyByIdOrUrl(searchParams.get('property'));
    if (!property) return NextResponse.json({ dimension: 'query', rows: [], total: 0 });

    const rawDimension = searchParams.get('dimension') ?? 'query';
    const dimension: SeoBreakdownTab = rawDimension === 'date' || isSeoDimension(rawDimension)
      ? rawDimension
      : 'query';
    const latest = await latestAvailableDate(property.id);
    const range = resolveSeoRange({
      period: parsePeriod(searchParams.get('period')),
      from: searchParams.get('from'),
      to: searchParams.get('to'),
      latestAvailable: latest,
    });
    const sortRaw = searchParams.get('sort') ?? '';
    const sort = SORTS.has(sortRaw) ? sortRaw as 'clicks' | 'impressions' | 'ctr' | 'position' | 'key' : undefined;
    const dir = searchParams.get('dir') === 'asc' ? 'asc' : 'desc';
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') ?? 25) || 25));
    const offset = Math.max(0, Number(searchParams.get('offset') ?? 0) || 0);
    const filterDimension = searchParams.get('filterDimension');
    const filter = filterDimension && (filterDimension === dimension || (dimension === 'date' && filterDimension === 'date'))
      ? searchParams.get('filter')
      : dimension !== 'date' && filterDimension === dimension
        ? searchParams.get('filter')
        : (filterDimension == null || filterDimension === dimension ? searchParams.get('filter') : null);

    const result = await listDimensionRows({
      propertyId: property.id,
      from: range.from,
      to: range.to,
      searchType: parseSearchType(searchParams.get('type')),
      dimension,
      filter,
      sort,
      dir,
      limit,
      offset,
    });
    return NextResponse.json({ dimension, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load SEO rows';
    const status = /from must/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
