/**
 * Tiny dev fixture for the Explainers tab (M2): two scored pool topics, one of
 * them with a finished render job, a script artifact, and one lint warning.
 * Writes only the local PGlite database. No model, vendor, or Supabase call.
 *
 *   npm run explainers:fixture
 *
 * Stop the dev server first: one process owns the data directory at a time.
 * Safe to re-run; it does nothing if the fixture is already there.
 */
import { addArtifact, addLintViolations, addTopics, claimNextJob, finishJob, recordCost, requestRender } from '@/lib/explainers/repository';
import { DEFAULT_LOCAL_DIR, openLocalDb } from '@/lib/explainers/local-db';
import { failedGates, weightedScore, type TopicScores } from '@/lib/explainers/scoring';
import { loadSettings } from '@/lib/explainers/settings';

const FIXTURES: { title: string; scope: string; scores: TopicScores; render: boolean }[] = [
  {
    title: 'What actually happens when you call an API?',
    scope: 'Explain how an app sends a request to another system and gets a structured response back.',
    scores: {
      audience_fit: 4,
      teachability_45s: 4,
      analogy_potential: 4,
      visual_potential: 4,
      accuracy_under_simplification: 4,
      hook_strength: 3,
    },
    render: true,
  },
  {
    title: 'What does React actually do?',
    scope: 'Explain how React redraws only the parts of a page whose data changed.',
    scores: {
      audience_fit: 3,
      teachability_45s: 3,
      analogy_potential: 3,
      visual_potential: 3,
      accuracy_under_simplification: 4,
      hook_strength: 2,
    },
    render: false,
  },
];

async function main() {
  const dir = process.env.EXPLAINERS_LOCAL_DIR || DEFAULT_LOCAL_DIR;
  const { db, pg } = await openLocalDb(dir);
  try {
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM explainers.topics WHERE origin = 'seeded' AND title = $1`,
      [FIXTURES[0].title],
    );
    if (rows[0].n > 0) {
      console.log(`fixture already present in ${dir}`);
      return;
    }

    const settings = await loadSettings(db);
    for (const fixture of FIXTURES) {
      if (failedGates(fixture.scores).length) throw new Error(`fixture fails a gate: ${fixture.title}`);
      const [topic] = await addTopics(db, [{ title: fixture.title, scope: fixture.scope, origin: 'seeded' }]);
      await db.query(
        `UPDATE explainers.topics
            SET status = 'pool', scored_at = now(), weighted_score = $2,
                audience_fit = $3, teachability_45s = $4, analogy_potential = $5,
                visual_potential = $6, accuracy_under_simplification = $7, hook_strength = $8,
                jev_notes = '{"fixture": true}'::jsonb
          WHERE id = $1`,
        [
          topic.id,
          weightedScore(fixture.scores),
          fixture.scores.audience_fit,
          fixture.scores.teachability_45s,
          fixture.scores.analogy_potential,
          fixture.scores.visual_potential,
          fixture.scores.accuracy_under_simplification,
          fixture.scores.hook_strength,
        ],
      );
      if (!fixture.render) continue;

      const req = await requestRender(db, { topicId: topic.id, trigger: 'click', settings });
      if (!req.ok) throw new Error(`fixture render not queued: ${req.reason}`);
      const job = await claimNextJob(db);
      if (!job) throw new Error('fixture job not claimed');
      await db.query(`UPDATE explainers.jobs SET stage = 'done' WHERE id = $1`, [job.id]);
      // Zero-dollar fixture rows so the Run section has something to show.
      await recordCost(db, {
        jobId: job.id,
        mode: settings.mode,
        vendor: 'anthropic',
        component: 'fixture',
        usd: 0,
      });
      await recordCost(db, { jobId: job.id, mode: settings.mode, vendor: 'heygen', component: 'fixture', usd: null });
      await addArtifact(db, {
        jobId: job.id,
        kind: 'script',
        content: 'Fixture script. Imagine a restaurant with three waiters...',
      });
      await addLintViolations(db, job.id, [
        { source: 'storyboard', rule: 'voiceover_words', frame: 4, severity: 'warning', detail: 'Fixture: 22 words, limit 20.' },
      ]);
      await finishJob(db, job.id, { status: 'ok' });
    }
    console.log(`fixture written to ${dir}`);
  } finally {
    await pg.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
