import type { NextRequest } from 'next/server';

import { updateSeries } from '@/lib/stories/api';
import { storiesRoute } from '@/lib/stories/route';
import { loadSettings } from '@/lib/stories/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return storiesRoute(({ db }) => loadSettings(db));
}

/** `{ vertical, … }` (SS-25): one Stories-format type's series switches and its own approval, publishing-live and daily cap. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return storiesRoute(({ db, email }) => updateSeries(db, body, email));
}
