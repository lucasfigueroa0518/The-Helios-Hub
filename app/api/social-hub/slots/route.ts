// app/api/social-hub/slots/route.ts
import { NextResponse } from 'next/server';

import { dbQuery, dbTransaction } from '@/lib/db';
import { actionEnabled } from '@/lib/social-hub/flags';
import { loadSlots, readSlotSource } from '@/lib/social-hub/slots/load';
import { applySlotChanges, parseChanges } from '@/lib/social-hub/slots/write';
import { addDays, isDayKey } from '@/lib/social-hub/time';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const q = (text: string, params?: unknown[]) => dbQuery(text, params) as Promise<{ rows: any[] }>;

/** `?from&to` (≤ 62 days): the resolved slots per date and which source is live. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!isDayKey(from) || !isDayKey(to) || to < from || to > addDays(from, 61)) return NextResponse.json({ error: 'Pick from and to as YYYY-MM-DD, at most 62 days.' }, { status: 400 });
  const days = Object.fromEntries(await loadSlots(q, from, to));
  return NextResponse.json({ source: await readSlotSource(q), days });
}

/** Body `{ changes, keepBooked? }`. A person's click is the decision; 409 lists booked posts in the way. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!actionEnabled('editSlots')) return NextResponse.json({ error: 'Editing slots is off.' }, { status: 403 });
  const body = await request.json().catch(() => null);
  const changes = parseChanges(body);
  if (typeof changes === 'string') return NextResponse.json({ error: changes }, { status: 400 });
  const keepBooked = (body as { keepBooked?: unknown }).keepBooked === true;
  const out = await dbTransaction((client) => applySlotChanges((t, p) => client.query(t, p as unknown[]), changes, { by: session.email, now: new Date(), keepBooked }));
  if (out.ok) return NextResponse.json(out);
  return NextResponse.json(out.status === 409 ? { booked: out.booked } : { errors: out.errors }, { status: out.status });
}
