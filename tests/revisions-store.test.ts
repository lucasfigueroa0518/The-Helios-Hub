/** Targeted Revisions task 1: the requests table and store on PGlite (offline, real schema files). */
import assert from 'node:assert/strict';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import type { Query } from '@/lib/social/store/pg';

import {
  claimNextRequested,
  createRequest,
  latestApplied,
  listForItem,
  markApplied,
  markRunning,
  markUndone,
  originalOf,
} from '@/lib/revisions/store';
import type { PartRef, PartState } from '@/lib/revisions/types';
import { schemaSql } from '@/lib/stories/local-db';
import path from 'node:path';

async function setup() {
  const pg = new PGlite();
  await pg.exec(schemaSql(path.join(process.cwd(), 'db', 'social_hub_schema.sql')));
  await pg.exec(schemaSql(path.join(process.cwd(), 'db', 'revisions_schema.sql')));
  const q: Query = async (text, params) => ({ rows: (await pg.query<Record<string, unknown>>(text, params)).rows });
  const { rows } = await q(
    `INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ('carousels', 'feed', 'p1') RETURNING id`,
  );
  return { q, itemId: String(rows[0].id) };
}

const part: PartRef = { kind: 'slide', key: '3' };
const state = (n: string): PartState => ({ copy: n, files: [`${n}.png`] });

async function applyOne(q: Query, itemId: string, before: string, after: string) {
  const r = await createRequest(q, { vertical: 'carousels', refs: [part], itemId, by: 'tommy', instruction: `to ${after}` });
  await claimNextRequested(q);
  await markRunning(q, r.id, { part, fixKind: 'wording', stageTag: 'writer' }, 0.1, 0.5);
  await markApplied(q, r.id, { before: state(before), after: state(after), costUsd: 0.02 });
  return r;
}

test('createRequest inserts status requested', async () => {
  const { q, itemId } = await setup();
  const r = await createRequest(q, { vertical: 'carousels', refs: [part], itemId, by: 'tommy', instruction: 'shorter' });
  assert.equal(r.status, 'requested');
  assert.equal(r.itemId, itemId);
  assert.deepEqual(r.refs, [part]);
  assert.equal(r.spendUsd, 0);
  assert.equal(r.parentId, null);
});

test('claimNextRequested takes the oldest and flips to running exactly once (second claim returns null)', async () => {
  const { q, itemId } = await setup();
  const a = await createRequest(q, { vertical: 'carousels', refs: [], itemId, by: null, instruction: 'a' });
  await createRequest(q, { vertical: 'carousels', refs: [], itemId, by: null, instruction: 'b' });
  const first = await claimNextRequested(q);
  assert.equal(first?.id, a.id);
  assert.equal(first?.status, 'running');
  const second = await claimNextRequested(q);
  assert.equal(second?.instruction, 'b');
  assert.equal(await claimNextRequested(q), null);
});

test('latestApplied returns the newest applied row for a part and ignores undone', async () => {
  const { q, itemId } = await setup();
  await applyOne(q, itemId, 'v0', 'v1');
  const second = await applyOne(q, itemId, 'v1', 'v2');
  assert.equal((await latestApplied(q, itemId, part))?.id, second.id);
  await markUndone(q, second.id, 'tommy');
  const now = await latestApplied(q, itemId, part);
  assert.equal(now?.after?.copy, 'v1');
  assert.equal(await latestApplied(q, itemId, { kind: 'slide', key: '9' }), null);
});

test('originalOf returns the before of the first applied revision even after later ones', async () => {
  const { q, itemId } = await setup();
  assert.equal(await originalOf(q, itemId, part), null);
  await applyOne(q, itemId, 'v0', 'v1');
  await applyOne(q, itemId, 'v1', 'v2');
  assert.deepEqual(await originalOf(q, itemId, part), state('v0'));
});

test('parentId links an ask-back reply', async () => {
  const { q, itemId } = await setup();
  const ask = await createRequest(q, { vertical: 'carousels', refs: [], itemId, by: 'tommy', instruction: 'fix it' });
  const reply = await createRequest(q, { vertical: 'carousels', refs: [], itemId, by: 'tommy', instruction: 'slide 3', parentId: ask.id });
  assert.equal(reply.parentId, ask.id);
  const all = await listForItem(q, itemId);
  assert.deepEqual(all.map((r) => r.id), [ask.id, reply.id]);
});

test('originalOf still returns the before after the only revision is undone', async () => {
  const { q, itemId } = await setup();
  const r1 = await applyOne(q, itemId, 'v0', 'v1');
  await markUndone(q, r1.id, 'tommy');
  assert.deepEqual(await originalOf(q, itemId, part), state('v0'));
});

test('originalOf returns revision 1 before when 1 is undone and 2 then applied', async () => {
  const { q, itemId } = await setup();
  const r1 = await applyOne(q, itemId, 'v0', 'v1');
  await markUndone(q, r1.id, 'tommy');
  await applyOne(q, itemId, 'v0', 'v2');
  assert.deepEqual(await originalOf(q, itemId, part), state('v0'));
});

test('originalOf returns revision 1 before with revisions 1 and 2 both live', async () => {
  const { q, itemId } = await setup();
  await applyOne(q, itemId, 'v0', 'v1');
  await applyOne(q, itemId, 'v1', 'v2');
  assert.deepEqual(await originalOf(q, itemId, part), state('v0'));
});

test('markUndone on a row that is not applied changes nothing', async () => {
  const { q, itemId } = await setup();
  const r = await createRequest(q, { vertical: 'carousels', refs: [part], itemId, by: null, instruction: 'x' });
  await markUndone(q, r.id, 'tommy');
  const [row] = await listForItem(q, itemId);
  assert.equal(row.status, 'requested');
  assert.equal(row.undoneAt, null);
  assert.equal(row.undoneBy, null);
});

test('markApplied on a row that is not running changes nothing', async () => {
  const { q, itemId } = await setup();
  const r = await createRequest(q, { vertical: 'carousels', refs: [part], itemId, by: null, instruction: 'x' });
  await markApplied(q, r.id, { before: state('a'), after: state('b'), costUsd: 0.5 });
  const [row] = await listForItem(q, itemId);
  assert.equal(row.status, 'requested');
  assert.equal(row.before, null);
  assert.equal(row.spendUsd, 0);
});
