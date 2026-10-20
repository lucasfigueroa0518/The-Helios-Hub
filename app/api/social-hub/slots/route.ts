// app/api/social-hub/slots/route.ts
import { NextResponse } from 'next/server';

import { dbQuery, dbTransaction } from '@/lib/db';
import { actionEnabled } from '@/lib/social-hub/flags';
import { loadSlots, readCaps, readSlotSource } from '@/lib/social-hub/slots/load';
import { applySlotChanges, parseChanges } from '@/lib/social-hub/slots/write';
import { addDays, isDayKey } from '@/lib/social-hub/time';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const q = (text: string, params?: unknown[]) => dbQuery(text, params) as Promise<{ rows: any[] }>;

/** `?from&to` (≤ 62 days): the resolved slots per date, which source is live, and the daily caps. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!isDayKey(from) || !isDayKey(to) || to < from || to > addDays(from, 61)) return NextResponse.json({ error: 'Pick from and to as YYYY-MM-DD, at most 62 days.' }, { status: 400 });
  const [days, source, caps] = await Promise.all([loadSlots(q, from, to).then((m) => Object.fromEntries(m)), readSlotSource(q), readCaps(q)]);
  return NextResponse.json({ source, days, caps });
}

/**
 * Body `{ changes, resolveBooked? }`; a change is put / delete / move, for the
 * template or a date. A person's click is the decision. A moved slot's waiting
 * post moves with it; 409 lists booked posts a removal (or a Trial / Main flip)
 * would leave without a slot, and `resolveBooked: 'unschedule'` sends them
 * back to ready. 422 carries `confirm: 'remove-carousels'` when Last Few Days
 * needs a yes (retry with `clearCarousels: true`).
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!actionEnabled('editSlots')) return NextResponse.json({ error: 'Editing slots is off.' }, { status: 403 });
  const body = await request.json().catch(() => null);
  const changes = parseChanges(body);
  if (typeof changes === 'string') return NextResponse.json({ error: changes }, { status: 400 });
  const asked = (body as { resolveBooked?: unknown }).resolveBooked;
  if (asked !== undefined && asked !== 'move' && asked !== 'unschedule') return NextResponse.json({ error: 'resolveBooked is move or unschedule.' }, { status: 400 });
  const out = await dbTransaction((client) =>
    applySlotChanges((t, p) => client.query(t, p as unknown[]), changes, { by: session.email, now: new Date(), ...(asked ? { resolveBooked: asked } : {}) }),
  );
  if (out.ok) return NextResponse.json(out);
  if (out.status === 409) return NextResponse.json({ booked: out.booked }, { status: 409 });
  return NextResponse.json(out.confirm ? { errors: out.errors, confirm: out.confirm } : { errors: out.errors }, { status: out.status });
}
