import { NextResponse, type NextRequest } from 'next/server';

import { liveNetworkingQuery } from '@/lib/networking/repository';
import { CALENDAR_URL, followRsvp } from '@/lib/networking/rsvp-tracking';

export const dynamic = 'force-dynamic';

/** A click on an RSVP link in the public events calendar: count it, then send the person to the event (RT-2). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let to = CALENDAR_URL;
  try {
    to = await followRsvp(liveNetworkingQuery, id, { userAgent: request.headers.get('user-agent'), referer: request.headers.get('referer') });
  } catch {
    // The database is down: the person still lands on the calendar rather than an error page.
  }
  const res = NextResponse.redirect(to, 302);
  res.headers.set('Cache-Control', 'no-store');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return res;
}
