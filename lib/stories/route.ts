import { NextResponse } from 'next/server';

import { ApiError } from '@/lib/stories/api';
import { liveStoriesDb, type StoriesDb } from '@/lib/stories/db';

type Session = { email: string } | null;
const liveSession = async (): Promise<Session> => (await import('@/lib/session')).getSession();

/**
 * Session check and error mapping for every /api/stories route (protected
 * like /api/reels; the middleware also refuses /api/* without a session).
 */
export async function storiesRoute(
  fn: (ctx: { db: StoriesDb; email: string }) => Promise<unknown>,
  opts: { session?: () => Promise<Session>; db?: StoriesDb } = {},
): Promise<NextResponse> {
  const session = await (opts.session ?? liveSession)();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await fn({ db: opts.db ?? liveStoriesDb, email: session.email }));
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
