import type { NextRequest } from 'next/server';

import { pick } from '@/lib/memes/api';
import { memesRoute } from '@/lib/memes/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Rate a meme 1–4, or pick/reject it: the reinforcement signal (ME-06, ME-64). */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return memesRoute(({ db, email }) => pick(db, body, email));
}
