/**
 * Central intake: one run by hand (the worker clock runs main at 12:00 and the top-up at 2:40).
 *
 *   npx tsx scripts/intake/run.ts                 prints what a run would do; no calls
 *   npx tsx scripts/intake/run.ts --go [--topup]  a live run: HTTP fetch, Jev grouping + scoring, capped
 *                                                 (main $0.50, top-up $0.15); writes intake.* only
 *
 * CLAUDE.md Rule 1: --go needs Lucas's go-ahead. Rule 2: a run scores only items new to it (no sweep).
 */
import fs from 'node:fs';
import path from 'node:path';

function loadEnvFile(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]!] === undefined) process.env[match[1]!] = match[2]!.replace(/^"(.*)"$/, '$1');
  }
}

loadEnvFile(path.join(process.cwd(), '.env.local'));

async function main(): Promise<void> {
  const go = process.argv.includes('--go');
  const kind = process.argv.includes('--topup') ? 'topup' : 'main';
  const { socialQuery } = await import('@/lib/social/store');
  const { closeDbPool } = await import('@/lib/db');
  const { openOrders } = await import('@/lib/intake/orders');
  const query = await socialQuery();
  const q = { query: (text: string, params?: readonly unknown[]) => query(text, params as unknown[]) } as never;
  try {
    const open = await openOrders(q, new Date());
    console.log(`Open orders: ${open.map((o) => o.id).join(', ') || 'none (a run would be skipped)'}`);
    if (!go) {
      console.log(`Dry: a ${kind} run would fetch the open orders' sources, group them and score new stories. Add --go to run it.`);
      return;
    }
    const { liveIntakeDeps, runIntake } = await import('@/lib/intake/run');
    const { runId, record } = await runIntake(await liveIntakeDeps(q, kind), kind);
    console.log(`Run ${runId}: ${JSON.stringify(record).slice(0, 2000)}`);
  } finally {
    await closeDbPool();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
