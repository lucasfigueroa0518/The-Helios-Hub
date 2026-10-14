import assert from 'node:assert/strict';
import test from 'node:test';

import { finishRun, insertPost, previousPosts, recentPhotoUrls, startRun, usedIdeaIds } from '@/lib/lfd/store';
import { storeSlideJpegs } from '@/lib/social/overnight/slides';

import { openHubTestDb } from './fixtures/social-hub/pglite';

test('runs and posts round-trip; previous posts come newest first with their headlines', async () => {
  const { query } = await openHubTestDb();
  const run = await startRun(query, 'manual', 1, '2026-10-13');
  await insertPost(query, { runId: run, slug: 'lfd-2026-10-09', nyDate: '2026-10-09', ideaIds: ['a', 'b'], stories: [{ headline: 'Old', body: 'x' }], render: {}, caption: 'c', slideObjects: [], fitProblems: [], short: false });
  await insertPost(query, { runId: run, slug: 'lfd-2026-10-13', nyDate: '2026-10-13', ideaIds: ['c'], stories: [{ headline: 'New', body: 'y' }], render: {}, caption: 'c', slideObjects: [], fitProblems: ['slide 2 text fit'], short: true });
  await finishRun(query, run, { status: 'ok', claudeUsd: 0.12, jevUsd: 0.01, record: { picks: 6 } });
  const prev = await previousPosts(query, 2);
  assert.deepEqual(prev.map((p) => p.nyDate), ['2026-10-13', '2026-10-09']);
  assert.deepEqual([...usedIdeaIds(prev)].sort(), ['a', 'b', 'c']);
  assert.equal(prev[0]!.stories[0]!.headline, 'New');
  const { rows } = await query<{ status: string; total_usd: number }>(`SELECT status, total_usd FROM lfd.runs WHERE id = $1`, [run]);
  assert.equal(rows[0]!.status, 'ok');
  assert.ok(Math.abs(rows[0]!.total_usd - 0.13) < 1e-9);
});

test('rejected posts do not count as previous posts', async () => {
  const { query } = await openHubTestDb();
  const id = await insertPost(query, { runId: null, slug: 'lfd-x', nyDate: '2026-10-09', ideaIds: ['a'], stories: [], render: {}, caption: 'c', slideObjects: [], fitProblems: [], short: false });
  await query(`UPDATE lfd.posts SET status = 'rejected' WHERE id = $1`, [id]);
  assert.deepEqual(await previousPosts(query, 2), []);
});

test('recent photo urls read social.used_photos for 7 days', async () => {
  const { query } = await openHubTestDb();
  await query(`INSERT INTO social.used_photos (url, used_at, story_id, slide) VALUES ('https://p1', now() - interval '2 days', 's', 1), ('https://p2', now() - interval '9 days', 's', 1)`);
  assert.deepEqual([...await recentPhotoUrls(query, new Date())], ['https://p1']);
});

test('storeSlideJpegs uploads under a custom prefix', async () => {
  const fs = await import('node:fs/promises');
  const sharp = (await import('sharp')).default;
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } }).png().toBuffer();
  const uploads: string[] = [];
  await storeSlideJpegs('lfd-2026-10-13', { slides: [] } as never, {
    prefix: 'lfd',
    fitCheck: async (_post, opts) => {
      await fs.writeFile(`${opts!.screenshotDir}/slide-slide-01.png`, png);
      return { ok: true, violations: [], problems: [], slideText: [] };
    },
    upload: async (p) => { uploads.push(p); },
  });
  assert.deepEqual(uploads, ['lfd/lfd-2026-10-13/slide-01.jpg']);
});

test('startRun marks a running run older than 2 hours abandoned, then starts', async () => {
  const { query } = await openHubTestDb();
  const old = (await query<{ id: string }>(`INSERT INTO lfd.runs (trigger, status, started_at) VALUES ('manual', 'running', now() - interval '3 hours') RETURNING id`)).rows[0]!.id;
  const run = await startRun(query, 'manual', 1, '2026-10-13');
  assert.notEqual(run, old);
  const { rows } = await query<{ status: string; stop_reason: string; finished: boolean }>(`SELECT status, stop_reason, finished_at IS NOT NULL AS finished FROM lfd.runs WHERE id = $1`, [old]);
  assert.deepEqual(rows[0], { status: 'failed', stop_reason: 'abandoned', finished: true });
});

test('startRun refuses while a recent run is still running', async () => {
  const { query } = await openHubTestDb();
  await query(`INSERT INTO lfd.runs (trigger, status, started_at) VALUES ('manual', 'running', now() - interval '10 minutes')`);
  await assert.rejects(startRun(query, 'manual', 1, '2026-10-13'), /a Last Few Days run is already in progress/);
});

test('finishRun only finishes a running run: a stray finish after the timeout keeps the failed row', async () => {
  const { query } = await openHubTestDb();
  const id = await startRun(query, 'manual', 1, '2026-10-13');
  await query(`UPDATE lfd.runs SET status = 'failed', error = 'timed out after 30 minutes' WHERE id = $1`, [id]);
  const late = await finishRun(query, id, { status: 'ok', claudeUsd: 0.4, jevUsd: 0.1, record: { stories: 6 } });
  assert.equal(late, false);
  const row = (await query<{ status: string; error: string | null }>(`SELECT status, error FROM lfd.runs WHERE id = $1`, [id])).rows[0]!;
  assert.deepEqual([row.status, row.error], ['failed', 'timed out after 30 minutes']);

  const live = await startRun(query, 'manual', 1, '2026-10-13');
  assert.equal(await finishRun(query, live, { status: 'ok', claudeUsd: 0.4, jevUsd: 0.1, record: {} }), true);
  assert.equal((await query<{ status: string }>(`SELECT status FROM lfd.runs WHERE id = $1`, [live])).rows[0]!.status, 'ok');
});
