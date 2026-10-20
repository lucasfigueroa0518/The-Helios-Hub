// app/api/social-hub/slots/source/route.ts
import { NextResponse } from 'next/server';

import { dbQuery, dbTransaction } from '@/lib/db';
import { actionEnabled } from '@/lib/social-hub/flags';
import { readSeedInputs } from '@/lib/social-hub/slots/seed';
import { setSlotSource } from '@/lib/social-hub/slots/write';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Body `{ source: 'legacy' | 'template' }`. The cutover switch (spec §5 checklist); flipping back is the rollback. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!actionEnabled('editSlots')) return NextResponse.json({ error: 'Editing slots is off.' }, { status: 403 });
  const source = ((await request.json().catch(() => null)) as { source?: unknown } | null)?.source;
  if (source !== 'legacy' && source !== 'template') return NextResponse.json({ error: 'source is legacy or template.' }, { status: 400 });
  // Read outside the transaction: readSeedInputs swallows query errors, which would abort one.
  const seed = await readSeedInputs((t, p) => dbQuery(t, p) as Promise<{ rows: any[] }>);
  const out = await dbTransaction((client) => setSlotSource((t, p) => client.query(t, p as unknown[]), source, session.email, seed));
  return NextResponse.json({ source, ...out });
}
