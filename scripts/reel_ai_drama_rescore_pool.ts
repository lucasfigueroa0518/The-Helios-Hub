/**
 * MD-82: re-score the pooled Reel AI Drama pitches with the current drama set (opposition with agency and
 * a bounded episode). One Jev call per pooled pitch, priced into the ledger like any drama score; a pitch
 * now under the drama bar leaves the pool as rejected. Prints the estimate first; runs only with --yes.
 *
 *   npx tsx scripts/reel_ai_drama_rescore_pool.ts          # estimate only
 *   npx tsx scripts/reel_ai_drama_rescore_pool.ts --yes    # re-score
 */
import fs from 'node:fs';
import path from 'node:path';

for (const line of fs.existsSync(path.join(process.cwd(), '.env.local')) ? fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/) : []) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main(): Promise<void> {
  const { explainersDb } = await import('@/lib/explainers/connection');
  const { ensureReelAiDramaSchema } = await import('@/lib/reel-ai-drama/schema');
  const { loadSettings } = await import('@/lib/reel-ai-drama/settings');
  const { pooledPitches } = await import('@/lib/reel-ai-drama/development/pool');
  const { DRAMA_SET } = await import('@/lib/reel-ai-drama/development/scores');
  const { estimateRescore, rescorePool } = await import('@/lib/reel-ai-drama/development/rescore');
  const db = await explainersDb();
  await ensureReelAiDramaSchema(db);
  const settings = await loadSettings(db);
  const pooled = await pooledPitches(db);
  console.log(
    `Estimate: ${pooled.length} pooled pitch(es) × 1 Jev drama call (${DRAMA_SET.id}, no web search) ≈ $${estimateRescore(pooled.length).toFixed(4)}. ` +
      `Drama bar ${settings.drama_bar}.`,
  );
  for (const r of pooled) console.log(`  ${r.drama_score ?? '—'}  ${r.title}`);
  if (!process.argv.includes('--yes')) {
    console.log('Not run. Pass --yes to run it.');
    return;
  }
  const { RecordingDramaJevRunner } = await import('@/lib/reel-ai-drama/jev');
  const { liveJevTransport } = await import('@/lib/reels/jev/client');
  const jev = new RecordingDramaJevRunner(liveJevTransport, db, { mode: 'development' });
  const result = await rescorePool(db, jev, settings, new Date());
  for (const r of result.rescored) console.log(`${r.status.padEnd(8)} ${r.before ?? '—'} → ${r.after}  ${r.title}${r.cap ? ` (${r.cap})` : ''}`);
  for (const e of result.errors) console.log(`error    ${e}`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
