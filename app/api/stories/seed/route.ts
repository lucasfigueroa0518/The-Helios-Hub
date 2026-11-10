import type { NextRequest } from 'next/server';

import { createIntakeJev } from '@/lib/intake/jev';
import { listStories, readConsumerMode } from '@/lib/intake/read';
import { addIntakeSeed } from '@/lib/intake/seed';
import { INTAKE_TOPUP_CAP_USD } from '@/lib/intake/types';
import { liveJevTransport } from '@/lib/reels/jev/client';
import { seedIdea } from '@/lib/stories/seed';
import { storiesRoute } from '@/lib/stories/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Seed an idea (idea seeding spec): type a story, a number or a tool into a series' pool. Nothing is built. No model or
 * web call, except a Morning Download story with a link while the series reads the central intake: that one is also
 * read and scored into the intake (addIntakeSeed), and never fails the seed.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return storiesRoute(({ db, email }) =>
    seedIdea(db, body, new Date(), {
      q: db,
      seededBy: email,
      readMode: readConsumerMode,
      addSeed: addIntakeSeed,
      jev: () => createIntakeJev(liveJevTransport, db, null, INTAKE_TOPUP_CAP_USD),
      listStories,
      log: (line) => console.warn(line),
    }),
  );
}
