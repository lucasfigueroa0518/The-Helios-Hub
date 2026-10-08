import test from 'node:test';
import assert from 'node:assert/strict';

import { socialStoreKind } from '@/lib/social/store';
import { createPgPosted, createPgSetAsideLog, createPgUsedPhotoLog, insertRun, listPosts, upsertPost, type Query } from '@/lib/social/store/pg';

/** A fake query function: records every call and answers from a script. */
function fakeQuery(answer: (text: string, params: unknown[]) => any[] = () => []) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const query: Query = async (text, params = []) => {
    calls.push({ text, params });
    return { rows: answer(text, params) };
  };
  return { query, calls };
}

test('store choice: Postgres when a database URL is set, files otherwise or when SOCIAL_STORE=file', () => {
  assert.equal(socialStoreKind({ DATABASE_URL: 'postgres://x' }), 'postgres');
  assert.equal(socialStoreKind({ DIRECT_DATABASE_URL: 'postgres://x' }), 'postgres');
  assert.equal(socialStoreKind({ DATABASE_URL: 'postgres://x', SOCIAL_STORE: 'file' }), 'file');
  assert.equal(socialStoreKind({}), 'file');
  assert.equal(socialStoreKind({ DATABASE_URL: '  ' }), 'file');
});

test('used photos: the 7-day window is asked for in SQL, and every bank tag is written', async () => {
  const { query, calls } = fakeQuery((t) => (t.includes('SELECT DISTINCT url') ? [{ url: 'a' }, { url: 'b' }] : []));
  const log = createPgUsedPhotoLog(query);
  const now = new Date('2026-10-08T12:00:00Z');
  assert.deepEqual(await log.recent(now), new Set(['a', 'b']));
  assert.deepEqual(calls[0]!.params, [now.toISOString(), 7]);
  await log.record([{ url: 'u', usedAt: now.toISOString(), storyId: 's', slide: 2, source: 'stock', qid: null, subject: null, credit: 'c', scene: 'server racks' }]);
  assert.match(calls[1]!.text, /INSERT INTO social\.used_photos/);
  assert.match(calls[1]!.text, /ON CONFLICT .* DO NOTHING/s);
  assert.deepEqual(calls[1]!.params, ['u', now.toISOString(), 's', 2, 'stock', null, null, 'c', 'server racks', null]);
});

test('posted stories: the 14-day lookback, headlines in order', async () => {
  const { query, calls } = fakeQuery(() => [{ headline: 'one' }, { headline: 'two' }]);
  const now = new Date('2026-10-08T12:00:00Z');
  assert.deepEqual(await createPgPosted(query).recentHeadlines(now), ['one', 'two']);
  assert.deepEqual(calls[0]!.params, [now.toISOString(), 14]);
});

test('set-asides: an entry is built like the file log (New York day, kind from the reason) and read back for the day', async () => {
  const { query, calls } = fakeQuery((t) => (t.startsWith('SELECT')
    ? [{ day: '2026-10-07', story_id: 's', stage: 'reporter', reason_code: 'service-error', kind: 'pipeline-fault', detail: 'd', at: new Date('2026-10-08T01:00:00Z') }]
    : []));
  const log = createPgSetAsideLog(query);
  const now = new Date('2026-10-08T01:00:00Z'); // 21:00 on Oct 7 in New York
  const entry = await log.record({ storyId: 's', stage: 'reporter', reasonCode: 'service-error', detail: 'd' }, now);
  assert.equal(entry.day, '2026-10-07');
  assert.equal(entry.kind, 'pipeline-fault');
  assert.deepEqual(calls[0]!.params, ['2026-10-07', 's', 'reporter', 'service-error', 'pipeline-fault', 'd', now.toISOString()]);
  assert.deepEqual(await log.forDay(now), [{ ...entry }]);
});

test('runs and posts: JSON goes in as jsonb text, a post is upserted by slug, the caption is copied out of the render', async () => {
  const { query, calls } = fakeQuery((t) => (t.includes('RETURNING id') ? [{ id: 'id-1' }] : []));
  const runId = await insertRun(query, { kind: 'preview', startedAt: 'a', finishedAt: 'b', hookPass: true, capUsd: 2, claudeUsd: 1, totalUsd: 1.1, stopReason: 'target-reached', runDir: 'runs/x', machine: 'm', record: { k: 1 } });
  assert.equal(runId, 'id-1');
  assert.equal(calls[0]!.params.at(-1), '{"k":1}');
  const render = { caption: 'Cap', slides: [] } as any;
  await upsertPost(query, { runId, slug: 'post-x-1', storyId: 's', title: 'T', status: 'preview', brief: { b: 1 }, draft: null, render });
  assert.match(calls[1]!.text, /ON CONFLICT \(slug\) DO UPDATE/);
  assert.deepEqual(calls[1]!.params, ['id-1', 'post-x-1', 's', 'T', 'preview', '{"b":1}', null, JSON.stringify(render), 'Cap', null, 'pipeline']);
});

test('listPosts: filters are optional parameters, newest first', async () => {
  const { query, calls } = fakeQuery(() => [{ id: '1', slug: 's', story_id: null, title: 'T', status: 'review', created_at: new Date('2026-10-08T00:00:00Z'), run_id: null }]);
  const rows = await listPosts(query, { status: 'review' });
  assert.deepEqual(rows, [{ id: '1', slug: 's', storyId: null, title: 'T', status: 'review', createdAt: '2026-10-08T00:00:00.000Z', runId: null }]);
  assert.deepEqual(calls[0]!.params, [null, 'review', 100]);
  assert.match(calls[0]!.text, /ORDER BY created_at DESC/);
});
