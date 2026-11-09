import { dbQuery } from '@/lib/db';
import { getSession } from '@/lib/session';

import { seedRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Seed a Field Notes tip from a link: one insert into field_notes.tips (source_kind 'seed'). No model, no fetch, no spend. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return seedRoute({ session: getSession, db: (text, params) => dbQuery(text, params as never) as never }, body);
}
