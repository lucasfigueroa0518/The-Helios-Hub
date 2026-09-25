import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/lib/session';
import { parseEnvironment, parseFiltersParam, parsePeriod, resolveTrafficRange } from '@/lib/traffic/format';
import { loadTrafficSummary } from '@/lib/traffic/summary';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const range = resolveTrafficRange({
      period: parsePeriod(searchParams.get('period')),
      from: searchParams.get('from'),
      to: searchParams.get('to'),
    });
    const summary = await loadTrafficSummary({
      range,
      environment: parseEnvironment(searchParams.get('environment')),
      filters: parseFiltersParam(searchParams.get('filters')),
    });
    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load traffic summary';
    const status = /from must/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
