import { NextRequest, NextResponse } from 'next/server';

import { eventCounts, latestIngestRun, listKeptEvents } from '@/lib/networking/repository';
import { getSession } from '@/lib/session';
import type { AccessType, Bucket, Metro } from '@/lib/networking/types';

export const runtime = 'nodejs';

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const metro = searchParams.get('metro');
  const bucket = searchParams.get('bucket');
  const industry = searchParams.get('industry') || undefined;
  const access = searchParams.get('access');
  const from = parseDate(searchParams.get('from'));
  const to = parseDate(searchParams.get('to'));

  const filter = {
    metro: metro === 'boston' || metro === 'miami' ? (metro as Metro) : undefined,
    bucket: bucket === 'tech' || bucket === 'vertical' || bucket === 'both' ? (bucket as Bucket) : undefined,
    industry,
    access: access === 'open' || access === 'paid' || access === 'invite_only' ? (access as AccessType) : undefined,
    from,
    to,
  };

  const [events, counts, ingest] = await Promise.all([
    listKeptEvents(filter),
    eventCounts({ metro: filter.metro, from, to }),
    latestIngestRun(),
  ]);

  return NextResponse.json({ events, counts, ingest });
}
