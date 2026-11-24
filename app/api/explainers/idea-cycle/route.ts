import { NextResponse } from 'next/server';

import { explainersDb } from '@/lib/explainers/connection';
import { IDEA_CYCLE_REFUSAL_TEXT, ideaCycleStatus, requestIdeaCycle } from '@/lib/explainers/ideas/cycle-request';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** `{ estimateUsd, maxRenders, ranToday, requested }`: what the hub's confirm states before the click. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await ideaCycleStatus(await explainersDb()));
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

/** Queue today's idea cycle for the explainers worker. Nothing runs inside this request. */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const db = await explainersDb();
    const result = await requestIdeaCycle(db, session.email);
    if (!result.ok) return NextResponse.json({ error: IDEA_CYCLE_REFUSAL_TEXT[result.reason] }, { status: 409 });
    const { estimateUsd } = await ideaCycleStatus(db);
    return NextResponse.json(
      {
        queued: true,
        note: `Queued. The explainers worker runs today’s idea cycle on its next poll (up to $${estimateUsd.toFixed(2)}). It still stops at the daily spend cap, and makes nothing when today’s quota is already filled.`,
      },
      { status: 202 },
    );
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
