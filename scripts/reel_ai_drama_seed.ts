/**
 * Seed the search ledger (every blue-chip player × story type × era) and Lucas's calibration stories as
 * origin='seed' pitches. Database writes only; no model calls. Idempotent.
 *
 *   npx tsx scripts/reel_ai_drama_seed.ts
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
  const { seedCells } = await import('@/lib/reel-ai-drama/development/ledger');
  const { seedCalibrationPitches } = await import('@/lib/reel-ai-drama/development/calibration');
  const db = await explainersDb();
  await ensureReelAiDramaSchema(db);
  console.log(JSON.stringify({ cells: await seedCells(db), seedPitches: await seedCalibrationPitches(db) }));
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
