import { NextRequest, NextResponse } from 'next/server';

import { enqueueWorkBatch } from '@/lib/orchestration/repository';
import { isoWeekKey } from '@/lib/networking/ingest';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';

export async function POST(_request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const weekKey = isoWeekKey();
  await enqueueWorkBatch([
    {
      kind: 'networking.weekly_ingest',
      payload: { reason: 'manual' },
      dedupeKey: `${weekKey}:manual:${Date.now()}`,
      scopeKey: 'networking',
      maxAttempts: 2,
      priority: -6,
    },
  ]);
  return NextResponse.json({ ok: true, weekKey });
}
