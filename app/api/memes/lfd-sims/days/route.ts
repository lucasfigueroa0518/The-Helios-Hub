import { replayDays } from '@/lib/memes/lfd-sim/api';
import { readOnly } from '@/lib/memes/lfd-sim/router';
import { memesRoute } from '@/lib/memes/route';
import { liveHubQuery } from '@/lib/social-hub/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The days a replay can use, for the lab's calendar. Read only, from the Hub. */
export async function GET() {
  return memesRoute(() => replayDays(readOnly(liveHubQuery)));
}
