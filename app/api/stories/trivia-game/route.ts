import type { NextRequest } from 'next/server';

import { ApiError } from '@/lib/stories/api';
import { nyDate } from '@/lib/stories/repository';
import { storiesRoute } from '@/lib/stories/route';
import { addDays, pullQuestion, readDays, readLaunch, saveLaunch } from '@/lib/stories/trivia/game-days';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The hub's view of the web game: the launch date, and the days from yesterday on (drafts and locked). */
export async function GET() {
  return storiesRoute(async ({ db }) => ({ launch: await readLaunch(db), today: nyDate(), days: await readDays(db, { from: addDays(nyDate(), -1) }) }));
}

/** `{ action: 'pull', date, key }` or `{ action: 'launch', date }` (YYYY-MM-DD, or null to stop the game). */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { action?: string; date?: string | null; key?: string };
  return storiesRoute(async ({ db, email }) => {
    try {
      if (body.action === 'pull' && body.date && body.key) return { day: await pullQuestion(db, body.date, body.key, email) };
      if (body.action === 'launch') return { launch: await saveLaunch(db, body.date ?? null, email) };
    } catch (err) {
      throw new ApiError(400, err instanceof Error ? err.message : String(err));
    }
    throw new ApiError(400, 'unknown action');
  });
}
