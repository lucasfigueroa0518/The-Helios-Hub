import { NextResponse } from 'next/server';

import { dbQuery } from '@/lib/db';
import { cancelRequest, dismissRequest } from '@/lib/seed/one-box/requests';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cancel a card still waiting for a worker, or dismiss a failed one. A request already being worked on is neither. */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });
  const q = (text: string, params?: unknown[]) => dbQuery(text, params as never) as never;
  if (!(await cancelRequest(q, id))) {
    const { rows } = (await q(`SELECT status FROM social_hub.seed_requests WHERE id = $1::uuid`, [id])) as { rows: { status: string }[] };
    if (rows[0]?.status === 'working') return NextResponse.json({ error: 'A worker already picked this up, so it can no longer be cancelled.' }, { status: 409 });
    await dismissRequest(q, id);
  }
  return NextResponse.json({ ok: true });
}
