/**
 * Top the Explainers idea pool up to POOL_TARGET (10) now, outside the 2 AM cycle (Lucas, 2026-11-24). The refill
 * only: it writes the shortfall from the syllabus, scores it, and is held to pool_refill_cap_usd; nothing is promoted
 * or rendered. Run on the social worker VM (EXPLAINERS_DB=supabase), like the worker:
 *
 *   npx tsx scripts/explainers_fill_pool.ts
 *
 * Makes live model calls (about $0.01 an idea), so a person runs it, never a test.
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
loadEnvFile(path.join(process.cwd(), 'scripts/gcp/explainers.env'));

const log = (message: string, fields: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), component: 'explainers-fill-pool', message, ...fields }));

async function main(): Promise<void> {
  if (!process.env.EXPLAINERS_DATABASE_URL?.trim() && process.env.EXPLAINERS_DB !== 'supabase') {
    log('missing_env', { name: 'EXPLAINERS_DATABASE_URL or EXPLAINERS_DB=supabase' });
    process.exit(1);
  }
  const { explainersDb } = await import('@/lib/explainers/connection');
  const { refillIdeaPoolNow } = await import('@/lib/explainers/ideas/cycle');
  const { anthropicIdeaModel } = await import('@/lib/explainers/ideas/generator');
  const { anthropic } = await import('@/lib/anthropic');
  const { liveJevTransport } = await import('@/lib/reels/jev/client');
  const { dbQuery } = await import('@/lib/db');
  const db = await explainersDb();
  const result = await refillIdeaPoolNow({ db, ideaModel: anthropicIdeaModel(anthropic), jevTransport: liveJevTransport, log, event: log, moves: (text, params) => dbQuery(text, params) });
  log('pool_filled', {
    status: result.status,
    cycleId: result.cycleId,
    ...('error' in result ? { error: result.error } : { scored: result.evaluations.length, capped: result.refillCapped }),
  });
  if (result.status === 'failed') process.exitCode = 1;
}

main().catch((error) => {
  log('threw', { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
