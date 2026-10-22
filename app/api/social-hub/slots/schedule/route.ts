// app/api/social-hub/slots/schedule/route.ts
import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { dbQuery, dbTransaction } from '@/lib/db';
import { liveContentActions } from '@/lib/publishing/actions/live';
import { actionEnabled } from '@/lib/social-hub/flags';
import { readSchedules, saveSchedule } from '@/lib/social-hub/slots/schedule-write';
import type { SlotQuery } from '@/lib/social-hub/slots/types';
import { rescheduleSet } from '@/lib/stories/repository';
import type { Queryable } from '@/lib/stories/db';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const q: SlotQuery = (text, params) => dbQuery(text, params) as Promise<{ rows: any[] }>;

/** Every type's standing schedule (merged when its days differ, with any problems), the daily caps, and which source is live. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await readSchedules(q));
}

/**
 * Body `{ schedule, confirm? }`: replace one type's standing schedule (a
 * person's click is the decision). The system's own bookings follow their
 * paired time; hand-set slots and posts never move. Posts the save leaves
 * without a time go back to Ready to place first, through each type's own
 * unschedule (actions/unschedule's deps, ruling P1), then the save runs in
 * one transaction. 200 `{ ok, moved, toReady, inverse, inverseOther,
 * lfdSkips }` (Undo is a POST of `inverse`); 422 `{ errors, confirm? }`
 * (retry with `confirm: true` after a yes); 409 `{ error }`, legacy included.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!actionEnabled('editSlots')) return NextResponse.json({ error: 'Editing slots is off.' }, { status: 403 });
  const body = await request.json().catch(() => null);
  const out = await saveSchedule(body, {
    query: q,
    transaction: (fn) => dbTransaction((client) => fn((t, p) => client.query(t, p as unknown[]))),
    unschedule: async (post) => {
      const verb = (await liveContentActions())[post.vertical].unschedule;
      if (!verb) return { ok: false, note: `${post.vertical} posts can't go back to Ready to place from here.` };
      return verb(post.refs, session.email);
    },
    // The Stories repo's own write, on the save's transaction (it re-projects the set onto the spine there too).
    rescheduleSet: (tx, setId, nyDate, publishAt, slotMinute, slotBy) => {
      const db: Queryable = { query: async (t, p) => (await tx(t, p)) as never };
      return rescheduleSet(db, setId, nyDate, publishAt, slotMinute, slotBy);
    },
    by: session.email,
    now: new Date(),
  });
  if (out.status === 200 || (out.body.toReady as number) > 0) {
    try { revalidateTag('social-hub:data'); } catch { /* outside a Next request */ }
  }
  return NextResponse.json(out.body, { status: out.status });
}
