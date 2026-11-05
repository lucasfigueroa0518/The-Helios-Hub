import { NextResponse, type NextRequest } from 'next/server';

import { warmHubData } from '@/lib/hub/warm-data';
import { isDataWarmablePath, normalizeWarmPath } from '@/lib/hub/warm-paths';
import { logInfo, logPathname } from '@/lib/observability/log-event';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Hover prefetch: warm shared data caches without a full RSC render. */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const raw = req.nextUrl.searchParams.get('path') ?? '';
  const path = normalizeWarmPath(raw);
  if (!path || !isDataWarmablePath(path)) {
    return new NextResponse(null, { status: 204 });
  }

  const started = performance.now();
  const result = await warmHubData(path, session.userId, session.email);
  logInfo({
    component: 'hub-warm',
    event: 'complete',
    path: logPathname(path),
    scope: result?.scope ?? null,
    durationMs: result?.durationMs ?? Math.round(performance.now() - started),
    warmed: Boolean(result),
  });

  return new NextResponse(null, { status: 204 });
}
