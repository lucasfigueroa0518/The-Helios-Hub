/**
 * One live copy pass over the top N ideas on the latest slate. Does not ingest,
 * and does not turn on REELS_COPY_PROMPT_APPROVED for nightly runs.
 *
 *   npx tsx scripts/reels_copy_canary.ts
 *   npx tsx scripts/reels_copy_canary.ts --ranks 5
 */
import fs from 'node:fs';
import path from 'node:path';

function loadLocalEnvironment(): void {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

loadLocalEnvironment();

const SPEND_CEILING_USD = 1.5;

function ranksArg(): number {
  const index = process.argv.indexOf('--ranks');
  const raw = index >= 0 ? Number(process.argv[index + 1]) : 5;
  if (!Number.isInteger(raw) || raw < 1 || raw > 20) {
    throw new Error('--ranks must be an integer from 1 to 20.');
  }
  return raw;
}

function log(message: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), component: 'reels-copy-canary', message, ...fields }));
}

async function main(): Promise<void> {
  const ranks = ranksArg();
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const { closeDbPool, dbQuery } = await import('@/lib/db');
  const { MONTHLY_WATCH_USD } = await import('@/lib/reels/config');
  const { loadCopyTargets } = await import('@/lib/reels/copy/store');
  const { writeTargetCopy } = await import('@/lib/reels/pipeline/copy');
  const { finishRun, monthToDateUsd } = await import('@/lib/reels/repository');
  const { loadLatestSlate } = await import('@/lib/reels/scoring/store');

  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set.');

  const spent = await monthToDateUsd();
  if (spent >= MONTHLY_WATCH_USD) {
    throw new Error(`Month-to-date spend is $${spent.toFixed(2)}, at the $${MONTHLY_WATCH_USD} watch.`);
  }

  const slate = await loadLatestSlate();
  if (!slate) throw new Error('No score slate yet.');
  const targets = await loadCopyTargets(slate.id, { topRanks: ranks });
  log('targets', {
    slateId: slate.id,
    nyDate: slate.nyDate,
    ranks,
    ideas: targets.length,
    monthToDateUsd: spent,
    bodies: targets.map((target) => ({
      rank: target.rank,
      bucket: target.bucket,
      framework: target.framework,
      members: target.members.length,
      chars: target.members.reduce((sum, member) => sum + member.body.length, 0),
      headline: target.members[0]?.headline ?? '',
    })),
  });
  if (targets.length === 0) throw new Error(`No ranked ideas in the top ${ranks}.`);

  const { rows: runRows } = await dbQuery<{ id: string }>(
    `INSERT INTO reels.runs (trigger, status, started_at)
     VALUES ('manual', 'running', now())
     RETURNING id`,
  );
  const runId = runRows[0]?.id;
  if (!runId) throw new Error('Could not open a canary run.');

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let usd = 0;
  let written = 0;
  const failures: string[] = [];

  try {
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      const outcome = await writeTargetCopy(client, runId, slate.id, target);
      usd += outcome.usd;
      if (outcome.ok) written += 1;
      else failures.push(`rank ${target.rank ?? '?'}: ${outcome.error ?? 'unknown error'}`);

      log('wrote', {
        rank: target.rank,
        bucket: target.bucket,
        framework: target.framework,
        headline: target.members[0]?.headline ?? '',
        usd: outcome.usd,
        error: outcome.error,
        onScreenCopy: outcome.onScreenCopy,
        caption: outcome.caption,
      });

      const remaining = targets.length - index - 1;
      if (index === 0 && remaining > 0 && outcome.usd * (remaining + 1) > SPEND_CEILING_USD) {
        throw new Error(
          `First idea cost $${outcome.usd.toFixed(3)}. Projected $${(outcome.usd * targets.length).toFixed(2)} for ${targets.length} ideas, over the $${SPEND_CEILING_USD} ceiling. Stopped.`,
        );
      }
    }

    await finishRun(
      runId,
      failures.length === 0 ? 'ok' : 'partial',
      [],
      { copyWritten: written, usd },
      `Copy canary, top ${ranks}. Written ${written}, failed ${failures.length}, $${usd.toFixed(3)}.`,
    );
    log('done', { written, failed: failures.length, usd, failures });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishRun(runId, 'failed', [], { copyWritten: written, usd }, `Copy canary stopped: ${message}`);
    throw error;
  } finally {
    await closeDbPool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
