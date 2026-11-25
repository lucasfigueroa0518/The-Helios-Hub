/**
 * Fill the AI Drama pool now: the nightly development loop (session.ts) run by hand, until the pool holds
 * `pool_refill_below` pitches or the dollar cap is reached. Live model and web calls, so it needs --yes.
 *
 *   EXPLAINERS_DATABASE_URL="" EXPLAINERS_DB=supabase npx tsx scripts/reel_ai_drama_fill_pool.ts --cap 10 --yes
 */
import fs from 'node:fs';
import path from 'node:path';

for (const line of fs.existsSync(path.join(process.cwd(), '.env.local')) ? fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/) : []) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main(): Promise<void> {
  const cap = Number(process.argv[process.argv.indexOf('--cap') + 1]);
  if (!process.argv.includes('--cap') || !(cap > 0)) throw new Error('Pass --cap <dollars>.');
  const { explainersDb } = await import('@/lib/explainers/connection');
  const { ensureReelAiDramaSchema } = await import('@/lib/reel-ai-drama/schema');
  const { loadSettings } = await import('@/lib/reel-ai-drama/settings');
  const { developmentSpendSince } = await import('@/lib/reel-ai-drama/cost');
  const { refillNightStart } = await import('@/lib/reel-ai-drama/production/schedule');
  const { pooledPitches } = await import('@/lib/reel-ai-drama/development/pool');
  const db = await explainersDb();
  await ensureReelAiDramaSchema(db);
  const settings = await loadSettings(db);
  const spent = await developmentSpendSince(db, refillNightStart(new Date()));
  console.log(`Pool ${(await pooledPitches(db)).length} of ${settings.pool_refill_below}. This run may spend up to $${cap.toFixed(2)}.`);
  if (!process.argv.includes('--yes')) {
    console.log('Not run. Pass --yes to run it.');
    return;
  }
  const { runLiveDevelopment } = await import('@/lib/reel-ai-drama/production/live');
  // The 'click' trigger, so tonight's 10 PM session still runs; `fill` makes it loop as the night does.
  const summary = await runLiveDevelopment(db, 'click', { nightly_dev_cap_usd: spent + cap, cells_per_session: 4 }, undefined, true);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Pool now ${(await pooledPitches(db)).length}.`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
