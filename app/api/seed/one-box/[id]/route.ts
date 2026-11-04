import { NextResponse } from 'next/server';

import { dbQuery } from '@/lib/db';
import { dismissRequest } from '@/lib/seed/one-box/requests';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Dismiss a failed card. */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });
  await dismissRequest((text, params) => dbQuery(text, params as never) as never, id);
  return NextResponse.json({ ok: true });
}
