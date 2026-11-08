// Temporary (Lucas 2026-11-04, iteration 10 live test): one development session past the weekly cap, capped at
// $3 more than this week's spend; 4 cells × 5 pitches (MD-125). Delete after the test.
import fs from 'node:fs';
for (const line of fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf8').split(/\r?\n/) : []) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
void (async () => {
  const { explainersDb } = await import('@/lib/explainers/connection');
  const { developmentSpendSince } = await import('@/lib/reel-ai-drama/cost');
  const { weekStart } = await import('@/lib/reel-ai-drama/production/schedule');
  const { runLiveDevelopment } = await import('@/lib/reel-ai-drama/production/live');
  const db = await explainersDb();
  const spent = await developmentSpendSince(db, weekStart(new Date()));
  const cap = 12.57; // This week's spend before the first run, plus the $3 Lucas approved.
  console.log(JSON.stringify({ spentBefore: spent, capThisRun: cap }));
  console.log(JSON.stringify(await runLiveDevelopment(db, 'click', { weekly_dev_cap_usd: cap, cells_per_session: 4, pitches_per_cell: 5 }), null, 1));
  console.log(JSON.stringify({ spentAfter: await developmentSpendSince(db, weekStart(new Date())) }));
  process.exit(0);
})();
