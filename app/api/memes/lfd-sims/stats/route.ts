import { simStats } from '@/lib/memes/lfd-sim/api';
import { regimeId } from '@/lib/memes/regime';
import { memesRoute } from '@/lib/memes/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The gate's evidence: per-factor and per-cell good-slate rates, recomputed from the grades. */
export async function GET() {
  return memesRoute(({ db }) => simStats(db, regimeId()), { db: async () => (await import('@/lib/memes/lfd-sim/live')).simDb() });
}
