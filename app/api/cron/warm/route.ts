import { timingSafeEqual } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';

import { NO_MISSES } from '@/lib/content-type/run-misses';
import { logInfo, logWarn } from '@/lib/observability/log-event';
import { loadCachedLibraries, readCachedMisses, readCachedProgress } from '@/lib/social-hub/views/cached-extras';
import { loadHubDataset } from '@/lib/social-hub/views/cached-dataset';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Keeps the site warm (perf, cold starts): fills the shared Social Hub caches right after
 * a deploy (the cache is per deployment, so a deploy starts it empty) and every few
 * minutes after (.github/workflows/warm.yml), and keeps a function instance running.
 * Reads only. Shared caches, no per-user data. Bearer HUB_WARM_TOKEN (or Vercel's
 * CRON_SECRET); without either set, it does nothing.
 */
function authorized(header: string | null): boolean {
  const tokens = [process.env.HUB_WARM_TOKEN, process.env.CRON_SECRET].filter((t): t is string => Boolean(t && t.length >= 16));
  if (!header?.startsWith('Bearer ') || tokens.length === 0) return false;
  const given = Buffer.from(header.slice(7));
  return tokens.some((t) => {
    const want = Buffer.from(t);
    return want.length === given.length && timingSafeEqual(want, given);
  });
}

export async function GET(req: NextRequest) {
  if (!authorized(req.headers.get('authorization'))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const started = performance.now();
  const parts = await Promise.allSettled([
    loadHubDataset(),
    loadCachedLibraries(),
    readCachedProgress(),
    readCachedMisses().catch(() => NO_MISSES),
  ]);
  const failed = parts.filter((p) => p.status === 'rejected').length;
  const durationMs = Math.round(performance.now() - started);
  (failed ? logWarn : logInfo)({ component: 'hub-warm', event: 'cron_warm', durationMs, failed });
  return NextResponse.json({ ok: failed === 0, durationMs, failed });
}
