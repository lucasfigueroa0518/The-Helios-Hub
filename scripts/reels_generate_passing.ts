/**
 * Fill N passing reels on today's latest slate. Does not rescore.
 * Locked reels already count. Default N is 3.
 *
 *   npx tsx --env-file=.env.local scripts/reels_generate_passing.ts --count=6
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

function log(message: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), component: 'reels-generate', message, ...fields }));
}

async function main(): Promise<void> {
  const { closeDbPool, dbQuery } = await import('@/lib/db');
  const { generatePassingReels } = await import('@/lib/reels/pipeline/slots');
  const { createLiveJevRunner } = await import('@/lib/reels/jev/client');
  const { finishRun, runCostUsd } = await import('@/lib/reels/repository');
  const { nyDateKey } = await import('@/lib/reels/scoring/decide');
  const { latestSlateForDate } = await import('@/lib/reels/scoring/store');

  const countArg = process.argv.find((arg) => arg.startsWith('--count='));
  const count = countArg ? Number(countArg.slice('--count='.length)) : 3;
  if (!Number.isInteger(count) || count < 1) throw new Error(`--count needs a whole number above 0, not ${countArg}.`);

  const today = nyDateKey(new Date());
  const slate = await latestSlateForDate(today);
  if (!slate) throw new Error(`No slate for ${today}.`);

  const { rows } = await dbQuery<{ id: string }>(
    `INSERT INTO reels.runs (trigger, status, started_at, note)
     VALUES ('manual', 'running', now(), $1)
     RETURNING id`,
    [`Filling ${count} passing reels on ${slate.id}.`],
  );
  const run = rows[0];
  if (!run) throw new Error('Could not open a generation run.');
  log('start', { runId: run.id, slateId: slate.id, nyDate: today, count });

  const jev = createLiveJevRunner();
  try {
    const generation = await generatePassingReels({
      runId: run.id,
      slateId: slate.id,
      count,
      jev,
    });
    const usd = await runCostUsd(run.id);
    const note = [
      `Filled ${generation.filled.length} of ${count} passing reels.`,
      generation.failures.length > 0 ? generation.failures.join('; ') : undefined,
    ]
      .filter(Boolean)
      .join(' ');
    await finishRun(
      run.id,
      generation.status === 'ok' ? 'ok' : 'partial',
      [],
      { selected: generation.filled.length, copyWritten: generation.filled.filter((slot) => !slot.locked).length, jevCalls: jev.callCount, usd },
      note,
    );
    log('done', { ...generation, usd, jevCalls: jev.callCount });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const usd = await runCostUsd(run.id).catch(() => 0);
    await finishRun(run.id, 'failed', [], { usd }, message).catch(() => undefined);
    throw error;
  } finally {
    await closeDbPool();
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  const { closeDbPool } = await import('@/lib/db');
  await closeDbPool().catch(() => undefined);
  process.exit(1);
});
