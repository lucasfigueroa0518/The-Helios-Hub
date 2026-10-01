/**
 * Rescore the post ideas already on today's slate. Does not ingest or regroup,
 * and does not delete the slate it reads.
 *
 *   npx tsx --env-file=.env.local scripts/reels_rescore_today.ts [--top=6]
 *
 * When the new slate is stored, generation fills three reels that pass the
 * copy gate. Locked reels already count. `--top=N` fills N passing reels.
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
  console.log(
    JSON.stringify({ ts: new Date().toISOString(), component: 'reels-rescore', message, ...fields }),
  );
}

async function main(): Promise<void> {
  const { closeDbPool, dbQuery } = await import('@/lib/db');
  const { MONTHLY_WATCH_USD, PASSING_REELS_PER_NIGHT } = await import('@/lib/reels/config');
  const { createLiveJevRunner } = await import('@/lib/reels/jev/client');
  const { SCORING_PASS_1 } = await import('@/lib/reels/jev/questions/scoring-pass1');
  const { SCORING_PASS_2 } = await import('@/lib/reels/jev/questions/scoring-pass2');
  const { rescoreIdeas } = await import('@/lib/reels/pipeline/scoring');
  const { finishRun, monthToDateUsd, pendingRun, runCostUsd } = await import('@/lib/reels/repository');
  const { nyDateKey } = await import('@/lib/reels/scoring/decide');
  const { latestSlateForDate, loadSlateOrigins } = await import('@/lib/reels/scoring/store');
  const { generatePassingReels } = await import('@/lib/reels/pipeline/slots');

  const topArg = process.argv.find((arg) => arg.startsWith('--top='));
  const top = topArg ? Number(topArg.slice('--top='.length)) : null;
  if (top != null && (!Number.isInteger(top) || top < 1)) throw new Error(`--top needs a whole number above 0, not ${topArg}.`);

  const today = nyDateKey(new Date());
  const spent = await monthToDateUsd();
  if (spent >= MONTHLY_WATCH_USD) {
    throw new Error(`Month-to-date spend is $${spent.toFixed(2)}, at the $${MONTHLY_WATCH_USD} watch.`);
  }

  const pending = await pendingRun();
  if (pending) {
    throw new Error(`A run is already ${pending.status} (${pending.id}). Not starting another.`);
  }

  const slate = await latestSlateForDate(today);
  if (!slate) throw new Error(`No slate for ${today}.`);
  if (slate.pass1Version === SCORING_PASS_1.version && !process.argv.includes('--again')) {
    throw new Error(
      `Today's latest slate is already ${slate.pass1Version}. The earlier scores stay. Pass --again to score that slate once more.`,
    );
  }

  const ideas = await loadSlateOrigins(slate.id);
  log('pool', {
    nyDate: today,
    slateId: slate.id,
    fromVersion: slate.pass1Version,
    toVersion: SCORING_PASS_1.version,
    ideas: ideas.length,
    monthToDateUsd: spent,
  });
  if (ideas.length === 0) throw new Error('Today\'s slate has no ideas.');

  const { rows: runRows } = await dbQuery<{ id: string }>(
    `INSERT INTO reels.runs (trigger, status, started_at, note)
     VALUES ('manual', 'running', now(), $1)
     RETURNING id`,
    [`Rescoring ${today}'s pool (${ideas.length} ideas) with ${SCORING_PASS_1.version}. The earlier slate is kept.`],
  );
  const run = runRows[0];
  if (!run) throw new Error('Could not open a scoring run.');

  const jev = createLiveJevRunner();
  try {
    const summary = await rescoreIdeas(run.id, today, ideas, jev);

    const count = top ?? PASSING_REELS_PER_NIGHT;
    const generation = await generatePassingReels({
      runId: run.id,
      slateId: summary.slateId,
      count,
      jev,
    });
    log('generation', generation);

    const usd = await runCostUsd(run.id);
    const note = [
      `Rescored ${summary.scored} ideas on ${SCORING_PASS_1.version} / ${SCORING_PASS_2.version}.`,
      `Filled ${generation.filled.length} of ${count} passing reels.`,
      summary.failed > 0 ? `${summary.failed} idea(s) failed to score and stay on the earlier slate only.` : undefined,
      generation.failures.length > 0 ? generation.failures.join('; ') : undefined,
    ]
      .filter(Boolean)
      .join(' ');
    await finishRun(
      run.id,
      summary.failed > 0 || generation.filled.length < count || generation.failures.length > 0 ? 'partial' : 'ok',
      [],
      {
        scored: summary.scored,
        selected: summary.selected,
        jevCalls: jev.callCount,
        usd,
      },
      note,
    );
    log('done', { ...summary, usd, filled: generation.filled });
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
