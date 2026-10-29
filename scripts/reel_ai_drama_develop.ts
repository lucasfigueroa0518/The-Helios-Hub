/**
 * One Reel AI Drama development session (PROCESS.md D1–D7): live producer calls with web search, Jev
 * scores and visuals checks. Prints the estimate and this week's spend first; runs only with --yes.
 *
 *   npx tsx scripts/reel_ai_drama_develop.ts          # estimate only
 *   npx tsx scripts/reel_ai_drama_develop.ts --yes    # run one session (about $1–3, under the weekly cap)
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
  const { developmentSpendSince } = await import('@/lib/reel-ai-drama/cost');
  const { weekStart } = await import('@/lib/reel-ai-drama/production/schedule');
  const db = await explainersDb();
  await ensureReelAiDramaSchema(db);
  const settings = await loadSettings(db);
  const spent = await developmentSpendSince(db, weekStart(new Date()));
  console.log(
    `Estimate: one development session, ${settings.cells_per_session} cells × ${settings.pitches_per_cell} pitches, about $1–3 ` +
      `(Sonnet + web search per cell, Jev scores, visuals checks ≤ $${settings.visuals_check_cap_usd} each). ` +
      `This week: $${spent.toFixed(2)} of $${settings.weekly_dev_cap_usd.toFixed(2)}.`,
  );
  if (!process.argv.includes('--yes')) {
    console.log('Not run. Pass --yes to run it.');
    return;
  }
  if (spent >= settings.weekly_dev_cap_usd) {
    console.log("This week's development budget is spent. Not run.");
    return;
  }
  const { runLiveDevelopment } = await import('@/lib/reel-ai-drama/production/live');
  console.log(JSON.stringify(await runLiveDevelopment(db, 'click'), null, 2));
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
