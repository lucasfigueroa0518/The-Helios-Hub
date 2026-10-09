import { NextResponse } from 'next/server';

import { livePlan, runToday } from '@/lib/content-type/run-today-live';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** What Run now would start today, with a spend ceiling. Reads only. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await livePlan());
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 500 });
  }
}

/** Run now: the person's click approves today's runs. The plan is made again here, so only what today still needs starts. */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await runToday(session.email));
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 500 });
  }
}
