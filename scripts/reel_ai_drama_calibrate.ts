/**
 * Calibration (MD-52, the first live step): Jev drama and material scores on Lucas's stories and the
 * near misses (planning/AI Mini Docs/CALIBRATION.md). Prints the estimate first; runs only with --yes,
 * then prints the report and keeps it for the lab.
 *
 *   npx tsx scripts/reel_ai_drama_calibrate.ts --yes
 */
import fs from 'node:fs';
import path from 'node:path';

for (const line of fs.existsSync(path.join(process.cwd(), '.env.local')) ? fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/) : []) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main(): Promise<void> {
  console.log('Estimate: Jev drama + material scores on 12 stories and 10 near misses, about $0.10–0.30.');
  if (!process.argv.includes('--yes')) {
    console.log('Not run. Pass --yes to run it.');
    return;
  }
  const { explainersDb } = await import('@/lib/explainers/connection');
  const { ensureReelAiDramaSchema } = await import('@/lib/reel-ai-drama/schema');
  const { saveCalibrationReport, CALIBRATION_FILE } = await import('@/lib/reel-ai-drama/lab');
  const { runLiveCalibration } = await import('@/lib/reel-ai-drama/production/live');
  const db = await explainersDb();
  await ensureReelAiDramaSchema(db);
  const report = await runLiveCalibration(db);
  saveCalibrationReport(report);
  console.log(JSON.stringify(report, null, 2));
  console.log(`Kept for the lab: ${CALIBRATION_FILE}`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
