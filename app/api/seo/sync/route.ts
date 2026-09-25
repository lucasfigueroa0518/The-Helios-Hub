import { NextRequest, NextResponse } from 'next/server';

import { dbQuery } from '@/lib/db';
import { enqueueWorkBatch } from '@/lib/orchestration/repository';
import { latestSyncRun } from '@/lib/seo/repository';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const jobId = request.nextUrl.searchParams.get('jobId');
  const sync = await latestSyncRun();
  const warehouse = await dbQuery<{ n: string; max: string | null }>(
    `SELECT COUNT(*)::text AS n, MAX(date)::text AS max FROM seo.daily_totals`,
  );
  const progress = {
    daysStored: Number(warehouse.rows[0]?.n ?? 0),
    newestDate: warehouse.rows[0]?.max ?? null,
  };
  if (!jobId) return NextResponse.json({ sync, progress });

  const { rows } = await dbQuery<{
    id: string;
    status: string;
    last_error_message: string | null;
    finished_at: string | null;
  }>(
    `SELECT id, status, last_error_message, finished_at::text
       FROM outreach.orchestration_jobs
      WHERE id = $1 AND kind = 'seo.gsc_daily_sync'`,
    [jobId],
  );
  return NextResponse.json({ job: rows[0] ?? null, sync, progress });
}

export async function POST(_request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ids = await enqueueWorkBatch([
    {
      kind: 'seo.gsc_daily_sync',
      payload: { reason: 'manual' },
      dedupeKey: `manual:${Date.now()}`,
      scopeKey: 'seo',
      maxAttempts: 2,
      priority: -5,
    },
  ]);
  return NextResponse.json({ ok: true, jobId: ids[0] ?? null });
}
