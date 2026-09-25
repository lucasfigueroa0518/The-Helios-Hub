/**
 * Re-run Phase 2 over the pool already in the database.
 *
 *   npm run reels:regroup            # group whatever is still ungrouped
 *   npm run reels:regroup -- --reset # discard groupings and redo them
 *
 * Calibration tool. Changing a grouping threshold and wanting to see the
 * effect should not mean re-scraping every source or paying for another B6
 * story. Reviewer overrides are always preserved.
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

const RESET = process.argv.includes('--reset');

async function main(): Promise<void> {
  const { closeDbPool, dbQuery } = await import('@/lib/db');
  const { createLiveJevRunner } = await import('@/lib/reels/jev/client');
  const { groupRun } = await import('@/lib/reels/pipeline/grouping');
  const { HIGH_CONFIDENCE, SHORTLIST_SIMILARITY_FLOOR } = await import('@/lib/reels/config');

  if (RESET) {
    // Overrides are the reviewer's judgment and outrank any re-run (D-058).
    const decisions = await dbQuery(`DELETE FROM reels.grouping_decisions WHERE override = false`);
    const members = await dbQuery(`DELETE FROM reels.post_idea_members`);
    const ideas = await dbQuery(
      `DELETE FROM reels.post_ideas i
        WHERE NOT EXISTS (SELECT 1 FROM reels.published_status p
                           WHERE p.post_idea_id = i.id AND p.published)`,
    );
    console.log(
      `reset: cleared ${members.rowCount} memberships, ${ideas.rowCount} ideas, ${decisions.rowCount} decisions (overrides kept)`,
    );
  }

  const { rows } = await dbQuery<{ id: string }>(
    `INSERT INTO reels.runs (trigger, status, started_at)
     VALUES ('manual', 'running', now())
     ON CONFLICT DO NOTHING
     RETURNING id`,
  );
  if (rows.length === 0) {
    console.error('A run is already in progress. Wait for it to finish.');
    process.exitCode = 1;
    return;
  }
  const runId = rows[0].id;

  console.log(
    `regrouping with similarity floor ${SHORTLIST_SIMILARITY_FLOOR}, confidence bar ${HIGH_CONFIDENCE}\n`,
  );

  const jev = createLiveJevRunner();
  try {
    const summary = await groupRun(runId, new Date(), { jev });
    await dbQuery(
      `UPDATE reels.runs SET status='ok', finished_at=now(), stats=$2::jsonb,
              note='Regroup only; no ingestion.'
        WHERE id=$1`,
      [runId, JSON.stringify(summary)],
    );
    console.log(JSON.stringify(summary, null, 2));

    const { rows: grouped } = await dbQuery<{ n: string; members: string }>(
      `SELECT count(*)::text n, string_agg(role || ': ' || left(headline, 60), ' | ') members
         FROM (
           SELECT m.post_idea_id, m.role, s.headline
             FROM reels.post_idea_members m
             JOIN reels.sources s ON s.id = m.source_id
         ) x
        GROUP BY post_idea_id
       HAVING count(*) > 1`,
    );
    console.log(`\n${grouped.length} grouped post idea(s):`);
    for (const row of grouped) console.log(`  [${row.n}] ${row.members}`);
  } catch (error) {
    await dbQuery(
      `UPDATE reels.runs SET status='failed', finished_at=now(), note=$2 WHERE id=$1`,
      [runId, error instanceof Error ? error.message : String(error)],
    );
    throw error;
  } finally {
    await closeDbPool().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
