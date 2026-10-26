// scripts/ai_events_rescore_history.ts
/**
 * Recomputes every past week's ai_events.pool scores under the current formula (score v2,
 * AE-30) from the Jev answers already cached in networking.event_scores, so the history bar
 * (AE-28) compares like with like. No Jev, no Claude: pure code over stored rows. Picks, ranks,
 * pins and excludes are not touched.
 *
 *   npx tsx scripts/ai_events_rescore_history.ts           rescores every week in the pool
 *   npx tsx scripts/ai_events_rescore_history.ts --peek    lists the weeks; writes nothing
 */
import fs from 'node:fs';
import path from 'node:path';

function loadEnvFile(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

loadEnvFile(path.join(process.cwd(), '.env.local'));

async function main(): Promise<number> {
  const { liveNetworkingQuery } = await import('@/lib/networking/repository');
  const { rescoreWeek } = await import('@/lib/networking/pick/rank');
  const { closeDbPool } = await import('@/lib/db');
  try {
    const weeks = (await liveNetworkingQuery<{ week_key: string; n: string }>(
      `SELECT week_key, count(*) AS n FROM ai_events.pool GROUP BY week_key ORDER BY week_key`,
    )).rows;
    for (const w of weeks) {
      if (process.argv.includes('--peek')) {
        console.log(JSON.stringify({ week: w.week_key, rows: Number(w.n) }));
        continue;
      }
      const n = await rescoreWeek(liveNetworkingQuery, w.week_key);
      console.log(JSON.stringify({ week: w.week_key, rescored: n }));
    }
    return 0;
  } finally {
    await closeDbPool();
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
