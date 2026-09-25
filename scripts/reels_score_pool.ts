/**
 * Score the post ideas already in the pool. Does not ingest or regroup.
 *
 *   npx tsx scripts/reels_score_pool.ts
 *
 * One live Jev pass over the current ideas. Stops before the rest of the pool
 * if the first idea projects past the autonomous spend ceiling.
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

function log(message: string, fields: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({ ts: new Date().toISOString(), component: 'reels-score-pool', message, ...fields }),
  );
}

async function main(): Promise<void> {
  const { closeDbPool, dbQuery } = await import('@/lib/db');
  const { MONTHLY_WATCH_USD } = await import('@/lib/reels/config');
  const { createLiveJevRunner } = await import('@/lib/reels/jev/client');
  const { SCORING_PASS_1 } = await import('@/lib/reels/jev/questions/scoring-pass1');
  const { SCORING_PASS_2 } = await import('@/lib/reels/jev/questions/scoring-pass2');
  const { scoreOneIdea } = await import('@/lib/reels/pipeline/scoring');
  const { finishRun, monthToDateUsd, runCostUsd } = await import('@/lib/reels/repository');
  const { nyDateKey, rankForSlate, selectTopThree } = await import('@/lib/reels/scoring/decide');
  const { insertSlate, loadIdeaMaterial } = await import('@/lib/reels/scoring/store');
  type InterpretedScore = import('@/lib/reels/scoring/interpret').InterpretedScore;
  type RankedIdea = import('@/lib/reels/scoring/decide').RankedIdea;
  type ScoreInsert = import('@/lib/reels/scoring/store').ScoreInsert;

  const spent = await monthToDateUsd();
  if (spent >= MONTHLY_WATCH_USD) {
    throw new Error(`Month-to-date spend is $${spent.toFixed(2)}, at the $${MONTHLY_WATCH_USD} watch.`);
  }

  const { rows } = await dbQuery<{ id: string }>(`SELECT id FROM reels.post_ideas ORDER BY last_joined DESC`);
  const material = await loadIdeaMaterial(rows.map((row) => row.id));
  log('pool', { ideas: rows.length, withMembers: material.length, monthToDateUsd: spent });
  if (material.length === 0) throw new Error('No post ideas with members to score.');

  // Insert straight into `running`. A queued row would let the nightly worker
  // claim it and ingest the web again.
  const { rows: runRows } = await dbQuery<{ id: string; started_at: string; requested_at: string }>(
    `INSERT INTO reels.runs (trigger, status, started_at)
     VALUES ('manual', 'running', now())
     RETURNING id, started_at, requested_at`,
  );
  const run = runRows[0];
  if (!run) throw new Error('Could not open a scoring run.');

  const runStartedAt = new Date(run.started_at ?? run.requested_at);
  const jev = createLiveJevRunner();
  const interpreted = new Map<string, InterpretedScore>();
  const failures: string[] = [];

  try {
    for (let index = 0; index < material.length; index += 1) {
      const idea = material[index];
      try {
        const result = await scoreOneIdea(run.id, jev, idea);
        interpreted.set(idea.id, result);
        log('scored', {
          index: index + 1,
          of: material.length,
          net: result.net,
          bucket: result.chosenBucket,
          framework: result.chosenFramework,
          headline: idea.members[0]?.headline ?? '',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${idea.id}: ${message}`);
        log('idea_failed', { index: index + 1, of: material.length, error: message });
      }

      if (index === 0) {
        const soFar = await runCostUsd(run.id);
        const projected = soFar * material.length;
        log('cost_check', { firstIdeaUsd: soFar, projectedUsd: Number(projected.toFixed(4)) });
        if (projected > SPEND_CEILING_USD) {
          throw new Error(
            `Projected pool cost is $${projected.toFixed(2)}, over the $${SPEND_CEILING_USD.toFixed(2)} ceiling. Stopped after the first idea.`,
          );
        }
      }
    }

    const ranked: RankedIdea[] = material
      .filter((idea) => interpreted.has(idea.id))
      .map((idea) => {
        const result = interpreted.get(idea.id) as InterpretedScore;
        return {
          id: idea.id,
          net: result.net,
          bucketScore: result.bucketScore ?? 0,
          psychologyScore: result.psychologyTerm ?? 0,
          lastJoinedMs: idea.lastJoinedMs,
          confidence: result.bucketConfidence ?? 0,
        };
      });
    const order = rankForSlate(ranked);
    const selected = new Set(selectTopThree(ranked).map((idea) => idea.id));
    const rankOf = new Map(order.map((idea, index) => [idea.id, index + 1]));
    const scores: ScoreInsert[] = ranked.map((idea) => ({
      postIdeaId: idea.id,
      origin: 'timely',
      interpreted: interpreted.get(idea.id) as InterpretedScore,
      rank: rankOf.get(idea.id) ?? null,
      selected: selected.has(idea.id),
    }));

    await insertSlate({
      runId: run.id,
      nyDate: nyDateKey(runStartedAt),
      pass1Version: SCORING_PASS_1.version,
      pass2Version: SCORING_PASS_2.version,
      scores,
    });

    const usd = await runCostUsd(run.id);
    const note = failures.length > 0 ? `${failures.length} idea(s) failed to score.` : undefined;
    await finishRun(
      run.id,
      failures.length > 0 ? 'partial' : 'ok',
      [],
      { scored: scores.length, selected: selected.size, jevCalls: jev.callCount, usd },
      note,
    );
    log('done', { scored: scores.length, selected: selected.size, failed: failures.length, usd });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const usd = await runCostUsd(run.id).catch(() => 0);
    await finishRun(run.id, 'failed', [], { scored: interpreted.size, usd }, message);
    throw error;
  } finally {
    await closeDbPool();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
