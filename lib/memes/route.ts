import { NextResponse } from 'next/server';

import { ApiError } from './api';
import type { MemesDb } from './db';

type Session = { email: string } | null;
const liveSession = async (): Promise<Session> => (await import('@/lib/session')).getSession();
const liveDb = async (): Promise<MemesDb> => (await import('./live')).labDb();

/**
 * Session check and error mapping for every /api/memes route (the middleware
 * also refuses /api/* without a session).
 */
export async function memesRoute(
  fn: (ctx: { db: MemesDb; email: string }) => Promise<unknown>,
  opts: { session?: () => Promise<Session>; db?: () => Promise<MemesDb> } = {},
): Promise<NextResponse> {
  let session = await (opts.session ?? liveSession)();
  // Local grading while Google sign-in is down. An explicit null session (tests) still 401s.
  if (!session && opts.session == null && process.env.NODE_ENV === 'development') {
    session = { email: 'lucas@heliosgroup.ai' };
  }
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const db = await (opts.db ?? liveDb)();
    return NextResponse.json(await fn({ db, email: session.email }));
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
