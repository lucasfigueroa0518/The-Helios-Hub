import { NextResponse } from 'next/server';

import { explainersDb } from '@/lib/explainers/connection';
import { rejectTopic } from '@/lib/explainers/repository';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Lucas rejects a topic that has not been queued for a render. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'Rejected by hand.';
  try {
    const ok = await rejectTopic(await explainersDb(), id, reason);
    if (!ok) return NextResponse.json({ error: 'Only an unqueued topic can be rejected.' }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
