/** One-box seeding: the request handler (offline; no client is built and nothing is scheduled for real). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { handlePost, type PostDeps } from '@/lib/seed/one-box/handle';
import type { Query } from '@/lib/social/store/pg';

const schemaSql = (file: string) => fs.readFileSync(path.join(process.cwd(), 'db', file), 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');
async function setup(over: Partial<PostDeps> = {}) {
  const pg = new PGlite();
  await pg.exec(schemaSql('social_hub_schema.sql'));
  const q: Query = async (text, params) => ({ rows: (await pg.query(text, params)).rows as any[] });
  const scheduled: string[] = [];
  const deps: PostDeps = { q, approved: () => true, hasKey: () => true, openCount: async () => 0, schedule: (id) => void scheduled.push(id), ...over };
  const count = async () => Number((await q(`SELECT count(*)::int AS n FROM social_hub.seed_requests`)).rows[0].n);
  return { deps, scheduled, count };
}
const ok = { vertical: 'reels', blurb: 'OpenAI shipped a thing' };

test('an unapproved prompt returns 403 and inserts nothing', async () => {
  const { deps, count } = await setup({ approved: () => false });
  const r = await handlePost(ok, deps);
  assert.equal(r.status, 403);
  assert.equal(await count(), 0);
});
test('ai_events and unknown verticals return 400', async () => {
  const { deps } = await setup();
  assert.equal((await handlePost({ ...ok, vertical: 'ai_events' }, deps)).status, 400);
  assert.equal((await handlePost({ ...ok, vertical: 'nope' }, deps)).status, 400);
});
test('an empty blurb, or one over 600 characters, returns 400', async () => {
  const { deps } = await setup();
  assert.equal((await handlePost({ ...ok, blurb: '   ' }, deps)).status, 400);
  assert.equal((await handlePost({ ...ok, blurb: 'x'.repeat(601) }, deps)).status, 400);
});
test('Stories needs a series; a bad link scheme returns 400', async () => {
  const { deps } = await setup();
  assert.equal((await handlePost({ ...ok, vertical: 'stories' }, deps)).status, 400);
  assert.equal((await handlePost({ ...ok, link: 'ftp://x.test' }, deps)).status, 400);
});
test('a valid body inserts one working row and schedules the run once', async () => {
  const { deps, scheduled, count } = await setup();
  const r = await handlePost(ok, deps);
  assert.equal(r.status, 200);
  assert.equal(await count(), 1);
  assert.deepEqual(scheduled, [(r.body as { id: string }).id]);
});
test('the same blurb again inside a minute returns the first id and schedules nothing new', async () => {
  const { deps, scheduled } = await setup();
  const a = await handlePost(ok, deps);
  const b = await handlePost(ok, deps);
  assert.equal((b.body as { id: string }).id, (a.body as { id: string }).id);
  assert.equal(scheduled.length, 1);
});
test('the open-seed cap returns 409 and inserts nothing', async () => {
  const { deps, count } = await setup({ openCount: async () => 10 });
  assert.equal((await handlePost({ ...ok, vertical: 'carousels' }, deps)).status, 409);
  assert.equal(await count(), 0);
});
test('no API key returns 500 before inserting', async () => {
  const { deps, count } = await setup({ hasKey: () => false });
  assert.equal((await handlePost(ok, deps)).status, 500);
  assert.equal(await count(), 0);
});
test('a fourth concurrent request returns 409', async () => {
  const { deps } = await setup();
  for (const n of [1, 2, 3]) await handlePost({ ...ok, blurb: `idea ${n}` }, deps);
  assert.equal((await handlePost({ ...ok, blurb: 'idea 4' }, deps)).status, 409);
});
