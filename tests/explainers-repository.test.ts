import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  addArtifact,
  addLintViolations,
  addTopics,
  claimNextJob,
  finishJob,
  getFeedback,
  getJob,
  getTopic,
  listArtifacts,
  listLintViolations,
  listPool,
  listRecentlyRendered,
  nyDate,
  parseTopicList,
  productionSpendForDay,
  recordCost,
  rejectTopic,
  requestRender,
  saveFeedback,
} from '@/lib/explainers/repository';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  loadThemeBrief,
  saveSetting,
  type ExplainersSettings,
} from '@/lib/explainers/settings';
import type { ExplainersDb } from '@/lib/explainers/db';

import { schemaSql, scratchExplainersDb } from './explainers-pglite';

async function poolTopic(
  db: ExplainersDb,
  title: string,
  scores: Partial<Record<string, number>> & { weighted_score: number },
): Promise<string> {
  const [topic] = await addTopics(db, [{ title, origin: 'manual' }]);
  const cols = Object.keys(scores);
  await db.query(
    `UPDATE explainers.topics SET status = 'pool', ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}
      WHERE id = $1`,
    [topic.id, ...cols.map((c) => scores[c])],
  );
  return topic.id;
}

const production: ExplainersSettings = { ...DEFAULT_SETTINGS, mode: 'production' };

test('schema applies and re-applies cleanly', async () => {
  const { pg } = await scratchExplainersDb();
  await pg.exec(schemaSql());
  const { rows } = await pg.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'explainers'`,
  );
  // 10 product tables + posting_schedule, publish_attempts, media_insights (docs/social-overnight.md).
  assert.equal(rows[0].n, 13);
});

test('a database created before the seq columns upgrades in place', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite();
  // The jobs/artifacts/lint tables as first shipped, without seq.
  const old = schemaSql()
    .replace(/\n\s+-- Insertion order: timestamps can tie, ids are random\.\n\s+seq\s+bigint GENERATED ALWAYS AS IDENTITY,/, '')
    .replace(/\n\s+seq\s+bigint GENERATED ALWAYS AS IDENTITY,/g, '')
    .replace(/ALTER TABLE explainers\.\w+\s+ADD COLUMN IF NOT EXISTS seq[^;]+;/g, '');
  await pg.exec(old);
  await pg.exec(`INSERT INTO explainers.topics (title, origin) VALUES ('kept', 'manual')`);
  await pg.exec(schemaSql());
  await pg.exec(schemaSql());
  const { rows } = await pg.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema = 'explainers' AND column_name = 'seq'`,
  );
  assert.equal(rows[0].n, 3);
  const kept = await pg.query<{ title: string }>('SELECT title FROM explainers.topics');
  assert.deepEqual(kept.rows.map((r) => r.title), ['kept']);
});

test('seeded settings equal the kickoff defaults', async () => {
  const { db } = await scratchExplainersDb();
  assert.deepEqual(await loadSettings(db), DEFAULT_SETTINGS);
  assert.equal(DEFAULT_SETTINGS.auto_render, false);
  // SH-49 (Social Hub P2-M2): two renders a day under the $5 per-reel cap.
  assert.equal(DEFAULT_SETTINGS.daily_render_cap, 2);
  assert.equal(DEFAULT_SETTINGS.daily_spend_cap_usd, 10);
  assert.equal(DEFAULT_SETTINGS.per_reel_cap_usd, 5);
});

test('theme brief v1 is the E-14 text verbatim', async () => {
  const { db } = await scratchExplainersDb();
  const kickoff = fs.readFileSync(
    path.join(process.cwd(), 'planning', 'Explainer Reels', 'KICKOFF_DECISIONS.md'),
    'utf8',
  );
  const start = kickoff.indexOf('**Explainer Reels — Idea Generation Theme Brief**');
  const expected = kickoff.slice(start, kickoff.indexOf('### E-15')).trim();
  assert.equal(await loadThemeBrief(db, 'v1'), expected);
});

test('settings validate before they are stored', async () => {
  const { db } = await scratchExplainersDb();
  await assert.rejects(saveSetting(db, 'per_reel_cap_usd', -1), /positive number/);
  await assert.rejects(saveSetting(db, 'mode', 'staging'), /development or production/);
  await assert.rejects(saveSetting(db, 'pool_size', 2.5), /integer/);
  await saveSetting(db, 'auto_render', true);
  await saveSetting(db, 'voice_id', 'abc123');
  const settings = await loadSettings(db);
  assert.equal(settings.auto_render, true);
  assert.equal(settings.voice_id, 'abc123');

  await db.query(`UPDATE explainers.settings SET value = '"lots"' WHERE key = 'per_reel_cap_usd'`);
  await assert.rejects(loadSettings(db), /per_reel_cap_usd/);
});

test('parseTopicList keeps one topic per line', () => {
  assert.deepEqual(
    parseTopicList('1. What is a webhook?\n\n- What is a Git branch?\n  what is a webhook?  \n* Why do agents need tools?\n'),
    ['What is a webhook?', 'What is a Git branch?', 'Why do agents need tools?'],
  );
});

test('pool ranks by score, then the E-15 tie-breaks, then age', async () => {
  const { db } = await scratchExplainersDb();
  const base = {
    teachability_45s: 3,
    accuracy_under_simplification: 3,
    audience_fit: 3,
    visual_potential: 3,
    hook_strength: 3,
  };
  const older = await poolTopic(db, 'older tie', { ...base, weighted_score: 80 });
  const newer = await poolTopic(db, 'newer tie', { ...base, weighted_score: 80 });
  const teach = await poolTopic(db, 'teach wins', { ...base, teachability_45s: 4, weighted_score: 80 });
  const top = await poolTopic(db, 'top', { ...base, weighted_score: 96.25 });
  const accuracy = await poolTopic(db, 'accuracy beats audience', {
    ...base,
    accuracy_under_simplification: 4,
    audience_fit: 2,
    weighted_score: 80,
  });
  await db.query(`UPDATE explainers.topics SET created_at = now() - interval '1 day' WHERE id = $1`, [older]);

  const pool = await listPool(db);
  assert.deepEqual(
    pool.map((t) => t.id),
    [top, teach, accuracy, older, newer],
  );
  assert.equal(pool[0].weighted_score, 96.25);
});

test('the database rejects out-of-range scores and unknown tags', async () => {
  const { db } = await scratchExplainersDb();
  const [topic] = await addTopics(db, [{ title: 'x', origin: 'manual' }]);
  await assert.rejects(
    db.query('UPDATE explainers.topics SET audience_fit = 4.2 WHERE id = $1', [topic.id]),
  );
  await assert.rejects(
    db.query('UPDATE explainers.topics SET weighted_score = 100.5 WHERE id = $1', [topic.id]),
  );
  await assert.rejects(addTopics(db, [{ title: '   ', origin: 'manual' }]), /empty/);
});

test('Generate renders a pool candidate; auto renders only a promoted one', async () => {
  const { db } = await scratchExplainersDb();
  const [proposed] = await addTopics(db, [{ title: 'unscored', origin: 'seeded' }]);
  const pooled = await poolTopic(db, 'pooled', { weighted_score: 70 });

  assert.deepEqual(
    await requestRender(db, { topicId: proposed.id, trigger: 'click', settings: DEFAULT_SETTINGS }),
    { ok: false, reason: 'topic_not_renderable' },
  );
  assert.deepEqual(
    await requestRender(db, { topicId: pooled, trigger: 'auto', settings: DEFAULT_SETTINGS }),
    { ok: false, reason: 'topic_not_renderable' },
  );
  assert.deepEqual(
    await requestRender(db, { topicId: crypto.randomUUID(), trigger: 'click', settings: DEFAULT_SETTINGS }),
    { ok: false, reason: 'topic_not_found' },
  );

  const first = await requestRender(db, { topicId: pooled, trigger: 'click', settings: DEFAULT_SETTINGS });
  assert.ok(first.ok);
  assert.equal(first.job.spend_cap_usd, 5);
  assert.equal(first.job.orchestrator_model, 'claude-sonnet-5-5');
  assert.equal(first.job.mode, 'development');
  assert.equal((await getTopic(db, pooled))?.status, 'queued');

  assert.deepEqual(
    await requestRender(db, { topicId: pooled, trigger: 'click', settings: DEFAULT_SETTINGS }),
    { ok: false, reason: 'already_in_flight' },
  );

  await db.query(`UPDATE explainers.topics SET status = 'promoted' WHERE id = $1`, [proposed.id]);
  const auto = await requestRender(db, { topicId: proposed.id, trigger: 'auto', settings: DEFAULT_SETTINGS });
  assert.ok(auto.ok);
});

test('one render runs at a time', async () => {
  const { db } = await scratchExplainersDb();
  const a = await poolTopic(db, 'a', { weighted_score: 70 });
  const b = await poolTopic(db, 'b', { weighted_score: 60 });
  await requestRender(db, { topicId: a, trigger: 'click', settings: DEFAULT_SETTINGS });
  await requestRender(db, { topicId: b, trigger: 'click', settings: DEFAULT_SETTINGS });

  const claimed = await claimNextJob(db);
  assert.equal(claimed?.topic_id, a);
  assert.equal(claimed?.status, 'running');
  assert.equal(await claimNextJob(db), null);

  await finishJob(db, claimed!.id, { status: 'ok' });
  assert.equal((await claimNextJob(db))?.topic_id, b);
});

test('cost events move the job total; unknown prices stay unknown', async () => {
  const { db } = await scratchExplainersDb();
  const topic = await poolTopic(db, 'a', { weighted_score: 70 });
  const req = await requestRender(db, { topicId: topic, trigger: 'click', settings: DEFAULT_SETTINGS });
  assert.ok(req.ok);
  await recordCost(db, {
    jobId: req.job.id,
    mode: 'development',
    vendor: 'anthropic',
    component: 'session_a',
    inputTokens: 1000,
    usd: 0.42,
  });
  await recordCost(db, { jobId: req.job.id, mode: 'development', vendor: 'heygen', component: 'tts', usd: null });
  assert.equal((await getJob(db, req.job.id))?.spend_usd, 0.42);

  const { rows } = await db.query<{ usd_known: boolean }>(
    `SELECT usd_known FROM explainers.cost_events WHERE vendor = 'heygen'`,
  );
  assert.equal(rows[0].usd_known, false);
  await assert.rejects(
    recordCost(db, { mode: 'development', vendor: 'jev', component: 'x', usd: -1 }),
    /invalid cost/,
  );
});

test('production caps: two renders and $10 per Eastern day; development has neither', async () => {
  const { db } = await scratchExplainersDb();
  const a = await poolTopic(db, 'a', { weighted_score: 70 });
  const a2 = await poolTopic(db, 'a2', { weighted_score: 65 });
  const b = await poolTopic(db, 'b', { weighted_score: 60 });
  const c = await poolTopic(db, 'c', { weighted_score: 50 });

  assert.ok((await requestRender(db, { topicId: a, trigger: 'click', settings: production })).ok);
  assert.ok((await requestRender(db, { topicId: a2, trigger: 'click', settings: production })).ok);
  assert.deepEqual(
    await requestRender(db, { topicId: b, trigger: 'click', settings: production }),
    { ok: false, reason: 'daily_render_cap' },
  );
  assert.ok((await requestRender(db, { topicId: b, trigger: 'click', settings: DEFAULT_SETTINGS })).ok);

  // Idea-pipeline spend alone can exhaust the production day (A-4).
  const roomy = { ...production, daily_render_cap: 5 };
  await recordCost(db, { mode: 'production', vendor: 'anthropic', component: 'idea_generator', usd: 10 });
  assert.equal(await productionSpendForDay(db, nyDate()), 10);
  assert.deepEqual(
    await requestRender(db, { topicId: c, trigger: 'click', settings: roomy }),
    { ok: false, reason: 'daily_spend_cap' },
  );
});

test('nyDate uses the Eastern calendar day', () => {
  assert.equal(nyDate(new Date('2026-10-07T03:30:00Z')), '2026-10-06');
  assert.equal(nyDate(new Date('2026-10-07T04:30:00Z')), '2026-10-07');
});

test('a finished render starts the 45-day duplicate window; a failure allows retry', async () => {
  const { db } = await scratchExplainersDb();
  const ok = await poolTopic(db, 'ok', { weighted_score: 70 });
  const bad = await poolTopic(db, 'bad', { weighted_score: 60 });

  await requestRender(db, { topicId: ok, trigger: 'click', settings: DEFAULT_SETTINGS });
  const job = await claimNextJob(db);
  await finishJob(db, job!.id, { status: 'ok' });
  const rendered = await getTopic(db, ok);
  assert.equal(rendered?.status, 'rendered');
  assert.ok(rendered?.rendered_at);

  await requestRender(db, { topicId: bad, trigger: 'click', settings: DEFAULT_SETTINGS });
  const failing = await claimNextJob(db);
  const failed = await finishJob(db, failing!.id, { status: 'failed', error: 'spend cap', capped: true });
  assert.equal(failed?.capped, true);
  assert.equal((await getTopic(db, bad))?.status, 'queued');
  assert.ok((await requestRender(db, { topicId: bad, trigger: 'click', settings: DEFAULT_SETTINGS })).ok);

  assert.deepEqual((await listRecentlyRendered(db, 45)).map((t) => t.id), [ok]);
  await db.query(`UPDATE explainers.topics SET rendered_at = now() - interval '46 days' WHERE id = $1`, [ok]);
  assert.deepEqual(await listRecentlyRendered(db, 45), []);
});

test('reject only applies before a render is queued', async () => {
  const { db } = await scratchExplainersDb();
  const a = await poolTopic(db, 'a', { weighted_score: 70 });
  const b = await poolTopic(db, 'b', { weighted_score: 60 });
  assert.equal(await rejectTopic(db, a, 'not for us'), true);
  assert.equal((await getTopic(db, a))?.reject_reason, 'not for us');
  await requestRender(db, { topicId: b, trigger: 'click', settings: DEFAULT_SETTINGS });
  assert.equal(await rejectTopic(db, b, 'too late'), false);
});

test('artifacts, lint violations, and review round-trip', async () => {
  const { db } = await scratchExplainersDb();
  const topic = await poolTopic(db, 'a', { weighted_score: 70 });
  const req = await requestRender(db, { topicId: topic, trigger: 'click', settings: DEFAULT_SETTINGS });
  assert.ok(req.ok);
  const jobId = req.job.id;

  await addArtifact(db, { jobId, kind: 'script', content: 'beat 1' });
  await addArtifact(db, { jobId, kind: 'video', storagePath: 'explainers/a.mp4', bytes: 31_000_000 });
  await assert.rejects(addArtifact(db, { jobId, kind: 'video' }));
  const artifacts = await listArtifacts(db, jobId);
  assert.deepEqual(artifacts.map((a) => a.kind), ['script', 'video']);
  assert.equal(artifacts[1].bytes, 31_000_000);

  await addLintViolations(db, jobId, [
    { source: 'storyboard', rule: 'voiceover_words', frame: 3, severity: 'warning', detail: '22 words' },
    { source: 'storyboard', rule: 'total_duration', frame: null, severity: 'error', detail: '51s' },
  ]);
  assert.deepEqual((await listLintViolations(db, jobId)).map((v) => v.rule), ['total_duration', 'voiceover_words']);

  await assert.rejects(
    saveFeedback(db, { jobId, verdict: 'rejected', tags: ['hook', 'vibes'] }),
    /unknown failure tag: vibes/,
  );
  await saveFeedback(db, { jobId, verdict: 'rejected', tags: ['pacing', 'hook', 'hook'], note: ' too fast ' });
  const saved = await saveFeedback(db, { jobId, verdict: 'approved', tags: [], createdBy: 'lucas' });
  assert.equal(saved.verdict, 'approved');
  const feedback = await getFeedback(db, jobId);
  assert.deepEqual(feedback?.tags, []);
  assert.equal(feedback?.note, null);

  await assert.rejects(
    db.query(`UPDATE explainers.feedback SET tags = ARRAY['vibes'] WHERE job_id = $1`, [jobId]),
  );
});
