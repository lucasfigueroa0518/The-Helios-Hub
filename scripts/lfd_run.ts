// scripts/lfd_run.ts
/**
 * Last Few Days, one live run by hand (spec §11 rollout step 2).
 *
 *   npx tsx scripts/lfd_run.ts          prints what a run would do; no calls
 *   npx tsx scripts/lfd_run.ts --live   Tommy only: a live run (Claude, Jev, photos), capped at lfd.settings.run_cap_usd
 *
 * CLAUDE.md Rule 1: agents never pass --live.
 */
import fs from 'node:fs';
import path from 'node:path';

import type { HubQuery } from '@/lib/social-hub/db';

function loadEnvFile(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

loadEnvFile(path.join(process.cwd(), '.env.local'));

async function main() {
  const live = process.argv.includes('--live');
  const { socialQuery } = await import('@/lib/social/store');
  const { closeDbPool } = await import('@/lib/db');
  const query = (await socialQuery()) as unknown as HubQuery;

  const raw = (await query<{ value: unknown }>(`SELECT value FROM lfd.settings WHERE key = 'run_cap_usd'`)).rows[0]?.value ?? 1;
  const cap = Number(raw);
  if (!Number.isFinite(cap) || cap <= 0) {
    console.error(`lfd.settings.run_cap_usd is not a positive number (got ${typeof raw === 'string' ? raw : JSON.stringify(raw)}); refusing to run`);
    await closeDbPool();
    process.exit(1);
  }
  if (!live) {
    console.log(`Dry: a live run would read the window's reels ideas, carousel shortlists and feeds, write and fact-check 5-6 stories, find photos, render 7-8 slides and save a review post. Cap $${cap}. Re-run with --live to do it.`);
    await closeDbPool();
    return;
  }

  const { liveLfdDeps } = await import('@/lib/lfd/live');
  const { runLastFewDays } = await import('@/lib/lfd/run');
  const { deps, spentUsd } = await liveLfdDeps(query, { capUsd: cap, trigger: 'manual' });
  const res = await runLastFewDays(deps);
  console.log(JSON.stringify({ ...res, spentUsd: spentUsd() }, null, 2));
  await closeDbPool();
  process.exit(res.ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  const { closeDbPool } = await import('@/lib/db');
  await closeDbPool().catch(() => undefined);
  process.exit(1);
});
