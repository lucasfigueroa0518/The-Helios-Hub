// app/api/social-hub/refill-total/route.ts
import { NextResponse } from 'next/server';

import { dbQuery } from '@/lib/db';
import { readRefillTotalUsd, refillNight, spentTonightUsd, writeRefillTotalUsd, type TotalQuery } from '@/lib/content-type/refill-total';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const q: TotalQuery = (text, params) => dbQuery(text, params as unknown[]) as Promise<{ rows: any[] }>;

/** The nightly total of all idea-pool refills (D19) and what tonight's refills have used. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const nyDate = refillNight();
  const totalUsd = await readRefillTotalUsd(q);
  const spentUsd = await spentTonightUsd(q, nyDate).catch(() => null);
  return NextResponse.json({ totalUsd, spentUsd, nyDate });
}

/** Body `{ totalUsd: number }`: a dollar amount above $0 and at most $50. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { totalUsd?: unknown } | null;
  try {
    const totalUsd = await writeRefillTotalUsd(q, Number(body?.totalUsd));
    return NextResponse.json({ totalUsd });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
