/**
 * Intake reads, offline (PGlite with db/intake_schema.sql only): listStories
 * filters and the consumer switch's stale fallback.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { after, before, beforeEach } from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { eventDate, lastRuns, listStories, readConsumerMode } from '@/lib/intake/read';
import type { IntakeItem, IntakeQuery } from '@/lib/intake/types';

let pg: PGlite;
let q: IntakeQuery;

before(async () => {
  pg = new PGlite();
  const sql = readFileSync(path.join(process.cwd(), 'db', 'intake_schema.sql'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('\\'))
    .join('\n');
  await pg.exec(sql);
  q = { query: async (text, params) => ({ rows: (await pg.query(text, params as unknown[])).rows as never[] }) };
});

after(async () => {
  await pg.close();
});

const NOW = new Date('2026-11-09T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const S1 = '00000000-0000-0000-0000-000000000001';
const S2 = '00000000-0000-0000-0000-000000000002';
const S3 = '00000000-0000-0000-0000-000000000003';
const S4 = '00000000-0000-0000-0000-000000000004';

async function story(id: string, firstSeen: Date, lastJoined: Date, mergedInto: string | null = null) {
  await q.query(
    `INSERT INTO intake.stories (id, representative_key, headline, first_seen_at, last_joined_at, merged_into) VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, `https://example.com/${id}`, `Story ${id.slice(-1)}`, firstSeen, lastJoined, mergedInto],
  );
}

async function item(key: string, storyId: string, family: string, publish: Date | null, o: { role?: string; seededBy?: string } = {}) {
  await q.query(
    `INSERT INTO intake.items (key, family, source_id, source_name, source_type, headline, body, url, publish_time, story_id, role, joined_at, seeded_by)
     VALUES ($1, $2, 'src', 'Source', 'feed', $3, 'body', $1, $4, $5, $6, now(), $7)`,
    [key, family, `Headline ${key}`, publish, storyId, o.role ?? 'supporting', o.seededBy ?? null],
  );
}

beforeEach(async () => {
  await pg.exec(`TRUNCATE intake.scores, intake.items, intake.runs CASCADE; DELETE FROM intake.stories;
                 UPDATE intake.settings SET value = '{"lfd":"legacy","md":"legacy","gtn":"legacy","fvp":"legacy"}' WHERE key = 'consumers';`);
  // S1: recent, reels + feeds, scored. S2: old (outside since). S3: merged into S1. S4: recent, feeds only, a seed, unscored.
  await story(S1, hoursAgo(30), hoursAgo(2));
  await story(S2, hoursAgo(200), hoursAgo(150));
  await story(S4, hoursAgo(5), hoursAgo(5));
  await story(S3, hoursAgo(10), hoursAgo(10), S1);
  await item('https://a.example.com/1', S1, 'reels', hoursAgo(40), { role: 'primary' });
  await item('https://b.example.com/1', S1, 'feeds', hoursAgo(20));
  await item('https://a.example.com/2', S2, 'reels', hoursAgo(200), { role: 'primary' });
  await item('https://c.example.com/4', S4, 'feeds', null, { role: 'primary', seededBy: 'lucas' });
  await item('https://d.example.com/3', S3, 'reels', hoursAgo(10), { role: 'primary' });
  await q.query(
    `INSERT INTO intake.scores (story_id, scorecard, version, member_hash, result) VALUES
       ($1, 'major-news', 'major-news@3', 'h', '{"kind":"major-news","score":0.8}'),
       ($1, 'story-scoring', 'story-scoring@4', 'h', '{"kind":"story-scoring","status":"qualified","probSum":2.1,"outletCount":2,"answers":{}}')`,
    [S1],
  );
});

test('listStories: since window, merged-away excluded, scores joined, eventDate and yours', async () => {
  const stories = await listStories(q, { since: hoursAgo(48) });
  assert.deepEqual(stories.map((s) => s.id), [S1, S4]);
  const s1 = stories[0];
  assert.equal(s1.members.length, 2);
  assert.equal(s1.members[0].role, 'primary');
  assert.equal(s1.scores['major-news'], 0.8);
  assert.equal(s1.scores['story-scoring']?.status, 'qualified');
  assert.equal(s1.eventDate?.toISOString(), hoursAgo(40).toISOString(), 'earliest member publish time');
  assert.equal(s1.yours, false);
  const s4 = stories[1];
  assert.equal(s4.eventDate, null);
  assert.equal(s4.yours, true, 'seeded_by marks it yours');
});

test('listStories: families, needScores, until and limit filter', async () => {
  assert.deepEqual((await listStories(q, { since: hoursAgo(48), families: ['reels'] })).map((s) => s.id), [S1]);
  assert.deepEqual((await listStories(q, { since: hoursAgo(48), families: ['feeds'] })).map((s) => s.id), [S1, S4]);
  assert.deepEqual((await listStories(q, { since: hoursAgo(48), needScores: ['major-news', 'story-scoring'] })).map((s) => s.id), [S1]);
  assert.deepEqual((await listStories(q, { since: hoursAgo(48), needScores: ['story-builder'] })).map((s) => s.id), []);
  assert.deepEqual((await listStories(q, { since: hoursAgo(48), until: hoursAgo(20) })).map((s) => s.id), [S1]);
  assert.equal((await listStories(q, { since: hoursAgo(500), limit: 1 })).length, 1);
  assert.deepEqual((await listStories(q, { since: hoursAgo(500) })).map((s) => s.id), [S1, S4, S2]);
});

test('readConsumerMode: legacy by default; intake when fresh; stale-fallback without a main run in 26 h', async () => {
  assert.equal(await readConsumerMode(q, 'md', NOW), 'legacy');
  await q.query(`UPDATE intake.settings SET value = jsonb_set(value, '{md}', '"intake"') WHERE key = 'consumers'`);
  assert.equal(await readConsumerMode(q, 'md', NOW), 'stale-fallback', 'no main run at all');
  assert.equal(await readConsumerMode(q, 'lfd', NOW), 'legacy', 'other types untouched');

  await q.query(`INSERT INTO intake.runs (kind, status, started_at) VALUES ('main', 'ok', $1)`, [hoursAgo(30)]);
  await q.query(`INSERT INTO intake.runs (kind, status, started_at) VALUES ('topup', 'ok', $1)`, [hoursAgo(1)]);
  await q.query(`INSERT INTO intake.runs (kind, status, started_at) VALUES ('main', 'failed', $1)`, [hoursAgo(2)]);
  assert.equal(await readConsumerMode(q, 'md', NOW), 'stale-fallback', 'a top-up or a failed main does not count');

  await q.query(`INSERT INTO intake.runs (kind, status, started_at) VALUES ('main', 'partial', $1)`, [hoursAgo(12)]);
  assert.equal(await readConsumerMode(q, 'md', NOW), 'intake');
  const runs = await lastRuns(q);
  assert.equal(runs.main?.startedAt.toISOString(), hoursAgo(12).toISOString());
  assert.equal(runs.topup?.startedAt.toISOString(), hoursAgo(1).toISOString());

  const broken: IntakeQuery = { query: async () => { throw new Error('db down'); } };
  assert.equal(await readConsumerMode(broken, 'md', NOW), 'legacy');

  // Fix 3: a main run whose scoring stage never ran (the cap was spent in the screen) is not fresh.
  await q.query(`DELETE FROM intake.runs`);
  await q.query(`INSERT INTO intake.runs (kind, status, started_at, record) VALUES ('main', 'partial', $1, '{"scored":false}')`, [hoursAgo(3)]);
  assert.equal(await readConsumerMode(q, 'md', NOW), 'stale-fallback', 'an unscored main does not count');
  assert.equal((await lastRuns(q)).main, null);
  await q.query(`INSERT INTO intake.runs (kind, status, started_at, record) VALUES ('main', 'partial', $1, '{"scored":true}')`, [hoursAgo(20)]);
  assert.equal(await readConsumerMode(q, 'md', NOW), 'intake', 'an older main that scored does');
});

test('eventDate: a search member (B6 happened_on) wins, else the EARLIEST member publish time', () => {
  const m = (family: IntakeItem['family'], publish: Date | null) => ({ family, publishTime: publish }) as IntakeItem;
  assert.equal(eventDate([m('feeds', hoursAgo(2)), m('reels', hoursAgo(300))])?.toISOString(), hoursAgo(300).toISOString(), 'old event, fresh coverage: the old date');
  assert.equal(eventDate([m('feeds', hoursAgo(2)), m('search', hoursAgo(50)), m('reels', hoursAgo(300))])?.toISOString(), hoursAgo(50).toISOString(), 'the search date');
  assert.equal(eventDate([m('search', null), m('feeds', hoursAgo(5))])?.toISOString(), hoursAgo(5).toISOString());
  assert.equal(eventDate([m('feeds', null)]), null);
});

test('listStories families: membership per list (fix 1), a feed URL first stored by a reels adapter is a feeds member', async () => {
  await q.query(`UPDATE intake.items SET feed_slug = 'techcrunch-ai', feed_drop_reason = NULL, reels_source_id = 'src', reels_drop_reason = 'off_topic' WHERE key = 'https://a.example.com/2'`);
  await q.query(`UPDATE intake.stories SET last_joined_at = $2 WHERE id = $1`, [S2, hoursAgo(1)]);
  const feeds = await listStories(q, { since: hoursAgo(48), families: ['feeds'] });
  assert.ok(feeds.some((s) => s.id === S2), 'reels-dropped but feed-kept: a feeds member');
  const reels = await listStories(q, { since: hoursAgo(48), families: ['reels'] });
  assert.ok(!reels.some((s) => s.id === S2), 'not a reels member: the reels screen dropped it');
});
