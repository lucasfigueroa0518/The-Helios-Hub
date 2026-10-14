/**
 * Overnight scoreboard: per night and per type, what was made, covered and
 * posted, what failed and why, and what it cost (reliability plan #1).
 * Read only: stored morning reports where they exist, otherwise the night is
 * built from the source tables the same way the Health tab builds it, and not
 * saved. No model calls, nothing posted.
 *
 *   npx tsx scripts/overnight_scoreboard.ts            # the last 7 nights
 *   npx tsx scripts/overnight_scoreboard.ts --nights 14
 */
import path from 'node:path';

try {
  process.loadEnvFile(path.join(process.cwd(), '.env.local'));
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
}

async function main() {
  const i = process.argv.indexOf('--nights');
  const count = i > 0 ? Number(process.argv[i + 1]) : 7;
  if (!Number.isInteger(count) || count < 1 || count > 60) throw new Error('--nights takes a whole number from 1 to 60');

  const { closeDbPool } = await import('@/lib/db');
  const { liveHubQuery, explainersHubQuery } = await import('@/lib/social-hub/db');
  const { readPosting } = await import('@/lib/content-type/posting');
  const { buildNight, publisherTone } = await import('@/lib/social-hub/health/night');
  const { readReports } = await import('@/lib/social-hub/health/store');
  const { nightsEnding, reportNightFor } = await import('@/lib/social-hub/health/time');
  const { scoreboardLines } = await import('@/lib/social-hub/health/scoreboard');
  const { VERTICALS } = await import('@/lib/social-hub/verticals');

  const now = new Date();
  const last = reportNightFor(now);
  const nights = nightsEnding(last, count);
  const stored = new Map((await readReports(liveHubQuery, nights[0]!, last)).map((r) => [r.night, r]));
  const handles = { q: liveHubQuery, explainersQ: explainersHubQuery, posting: (v: Parameters<typeof readPosting>[0]) => readPosting(v) };
  const tone = await publisherTone(liveHubQuery, now);
  const reports = [];
  for (const n of nights) reports.push(stored.get(n) ?? (await buildNight(handles, n, now, n === last ? tone : 'none')));

  const label = (v: string) => VERTICALS.find((x) => x.id === v)?.label ?? v;
  console.log(`\nOvernight scoreboard · ${count} night${count === 1 ? '' : 's'} ending ${last} (${stored.size} from stored morning reports)\n`);
  for (const line of scoreboardLines(reports, label)) console.log(line);
  console.log('\n✔ worked · ⚠ short · ✖ failed · · did not run (switched off)\n');
  await closeDbPool();
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
