/**
 * Generate always works for an unpublished topic (idea pool standard, 2026-10-21), offline on PGlite with the
 * real schema files: every status but archived is renderable by click, a posted topic is not, and a daily
 * cap is a question the person can answer with one confirmed render.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { ExplainersDb } from '@/lib/explainers/db';
import { requestRender, typicalRenderCostUsd } from '@/lib/explainers/repository';
import { loadSettings, saveSetting } from '@/lib/explainers/settings';

import { scratchExplainersDb } from './explainers-pglite';

async function topic(db: ExplainersDb, status: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO explainers.topics (title, origin, status, weighted_score) VALUES ($1, 'manual', $2, 50) RETURNING id`,
    [`Topic ${status} ${Math.random()}`, status],
  );
  return rows[0]!.id;
}

test('a click renders a topic in any status but archived', async () => {
  const { db } = await scratchExplainersDb();
  const settings = await loadSettings(db);
  for (const status of ['proposed', 'pool', 'rejected', 'displaced', 'promoted', 'queued', 'rendered']) {
    const r = await requestRender(db, { topicId: await topic(db, status), trigger: 'click', settings });
    assert.equal(r.ok, true, `${status} should render`);
  }
  const archived = await requestRender(db, { topicId: await topic(db, 'archived'), trigger: 'click', settings });
  assert.deepEqual(archived, { ok: false, reason: 'topic_not_renderable' });
});

test('the night still renders only a promoted topic', async () => {
  const { db } = await scratchExplainersDb();
  const settings = await loadSettings(db);
  assert.equal((await requestRender(db, { topicId: await topic(db, 'pool'), trigger: 'auto', settings })).ok, false);
  assert.equal((await requestRender(db, { topicId: await topic(db, 'promoted'), trigger: 'auto', settings })).ok, true);
});

test('a topic that was posted is refused; a render already running is its own answer', async () => {
  const { db } = await scratchExplainersDb();
  const settings = await loadSettings(db);
  const id = await topic(db, 'rendered');
  const { rows } = await db.query<{ id: string }>(`INSERT INTO social_hub.content_items (vertical, format, native_ref, idea_ref) VALUES ('explainers', 'reel', 'job-x', $1) RETURNING id`, [id]);
  await db.query(`INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption) VALUES ($1, 'explainers', 'auto', 'published', 'c')`, [rows[0]!.id]);
  assert.deepEqual(await requestRender(db, { topicId: id, trigger: 'click', settings }), { ok: false, reason: 'topic_published' });
  const open = await topic(db, 'pool');
  assert.equal((await requestRender(db, { topicId: open, trigger: 'click', settings })).ok, true);
  assert.deepEqual(await requestRender(db, { topicId: open, trigger: 'click', settings }), { ok: false, reason: 'already_in_flight' });
});

test('a daily cap asks; a confirmed click goes over it once; the night never does', async () => {
  const { db } = await scratchExplainersDb();
  await saveSetting(db, 'mode', 'production');
  await saveSetting(db, 'daily_render_cap', 0);
  const settings = await loadSettings(db);
  const id = await topic(db, 'pool');
  assert.deepEqual(await requestRender(db, { topicId: id, trigger: 'click', settings }), { ok: false, reason: 'daily_render_cap' });
  assert.equal((await requestRender(db, { topicId: id, trigger: 'click', settings, overrideCaps: true })).ok, true);
  const promoted = await topic(db, 'promoted');
  assert.deepEqual(await requestRender(db, { topicId: promoted, trigger: 'auto', settings, overrideCaps: true }), { ok: false, reason: 'daily_render_cap' });
});

test('typicalRenderCostUsd: the per-reel cap until there are finished production renders, then their average', async () => {
  const { db } = await scratchExplainersDb();
  const settings = await loadSettings(db);
  assert.equal(await typicalRenderCostUsd(db, settings), settings.per_reel_cap_usd);
  const id = await topic(db, 'rendered');
  for (const usd of [2, 4]) {
    await db.query(
      `INSERT INTO explainers.jobs (topic_id, status, trigger, mode, spend_cap_usd, spend_usd, orchestrator_model, frame_worker_model, finished_at) VALUES ($1, 'ok', 'click', 'production', 8, $2, 'm', 'm', now())`,
      [id, usd],
    );
  }
  assert.equal(await typicalRenderCostUsd(db, settings), 3);
});
