import { NextRequest, NextResponse } from 'next/server';

import { publishSnapshot } from '@/lib/networking/public-snapshot';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';

/**
 * "Publish to website" on the internal /events calendar: rebuilds the public events snapshot
 * (public-feeds/networking/events.v1.json) and, when due, fires the Vercel deploy hook.
 */
export async function POST(_request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const result = await publishSnapshot({ reason: 'manual' });
    return NextResponse.json({
      ok: true,
      events: result.events,
      picks: result.picks,
      weekKey: result.weekKey,
      changed: result.changed,
      hook: result.hook.fired
        ? { fired: true, ok: result.hook.ok, status: result.hook.status }
        : { fired: false, reason: result.hook.reason },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Publish failed';
    return NextResponse.json({ error: message.slice(0, 300) }, { status: 502 });
  }
}
