/**
 * Meme lab M1 (planning/Memes/BUILD_PLAN.md): the 90-day template rule
 * (ME-40 to ME-45) on real SQL (PGlite).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import sharp from 'sharp';

import { TEMPLATE_CATALOG } from '@/lib/memes/catalog';
import { catalogHashes, openLocalMemesDb, type MemesDb } from '@/lib/memes/db';
import { availableTemplates, BANNED_TEMPLATES, COOLDOWN_DAYS, markPublished, release, reserve, TemplateOnCooldown } from '@/lib/memes/gate';
import { dhash, hamming, NEAR_DUPLICATE_BITS } from '@/lib/memes/phash';

const DAY = 86_400_000;
const T0 = new Date('2026-10-13T12:00:00Z');
const day = (n: number) => new Date(T0.getTime() + n * DAY);

async function withDb(fn: (db: MemesDb) => Promise<void>) {
  const { db, pg } = await openLocalMemesDb();
  try {
    await fn(db);
  } finally {
    await pg.close();
  }
}

const isFree = async (db: MemesDb, id: string, at: Date) => (await availableTemplates(db, at)).free.includes(id);

test('gate: everything but the banned templates is free on an empty ledger', () =>
  withDb(async (db) => {
    const { free, blocked } = await availableTemplates(db, T0);
    const banned = Object.keys(BANNED_TEMPLATES);
    assert.equal(free.length, 60 - banned.length);
    assert.deepEqual(blocked.map((b) => b.id).sort(), [...banned].sort());
  }));

test('gate: a banned template is never offered and can never be reserved (ME-139)', () =>
  withDb(async (db) => {
    assert.equal(await isFree(db, 'sleeping-shaq', T0), false);
    await assert.rejects(reserve(db, 'sleeping-shaq', null, T0), TemplateOnCooldown);
  }));

test('gate: a reservation blocks its family until it publishes or is released (ME-41)', () =>
  withDb(async (db) => {
    const use = await reserve(db, 'drake', null, T0);
    assert.equal(await isFree(db, 'drake', day(1)), false);
    await assert.rejects(reserve(db, 'drake', null, day(1)), TemplateOnCooldown, 'a second meme cannot take it');
    await release(db, use, day(2));
    assert.equal(await isFree(db, 'drake', day(2)), true, 'a cancelled meme releases its template');
    await assert.rejects(markPublished(db, use, day(3)), /not an open reservation/, 'a released use cannot publish');
  }));

test('gate: a publish blocks the family for 90 days, from the publish date (ME-40)', () =>
  withDb(async (db) => {
    const use = await reserve(db, 'two-buttons', null, T0);
    await markPublished(db, use, day(5));
    assert.equal(await isFree(db, 'two-buttons', day(5 + 89)), false, 'day 89 after publish');
    assert.equal(await isFree(db, 'two-buttons', day(5 + COOLDOWN_DAYS + 1)), true, 'day 91 after publish');
    await assert.rejects(release(db, use, day(6)), /not an open reservation/, 'a published use cannot be released');
    const blocked = (await availableTemplates(db, day(10))).blocked.find((b) => b.id === 'two-buttons');
    assert.match(blocked!.reason, /published 2026-10-18/);
  }));

test('gate: a variant in the same family is blocked with it (ME-42)', () =>
  withDb(async (db) => {
    await db.query(
      `INSERT INTO memes.templates (id, imgflip_id, name, family_key, status, source, card) VALUES ('drake-4-panel', 'x1', 'Drake 4 panel', 'Drakeposting', 'approved', 'trending', '{}'::jsonb)`,
    );
    const use = await reserve(db, 'drake', null, T0);
    await markPublished(db, use, T0);
    assert.equal(await isFree(db, 'drake-4-panel', day(30)), false);
    await assert.rejects(reserve(db, 'drake-4-panel', null, day(30)), /family "Drakeposting"/);
  }));

test('gate: a near-duplicate image under another family is blocked too (ME-45 safety net)', () =>
  withDb(async (db) => {
    const drake = TEMPLATE_CATALOG.find((t) => t.id === 'drake')!;
    const recropped = await sharp(`lib/memes/assets/templates/${drake.image}`).extract({ left: 12, top: 12, width: 1176, height: 1176 }).resize(700).jpeg({ quality: 60 }).toBuffer();
    const hash = await dhash(recropped);
    await db.query(
      `INSERT INTO memes.templates (id, imgflip_id, name, family_key, status, source, image_hash, card) VALUES ('drake-reupload', 'x2', 'Drake (reupload)', 'Some Other Entry', 'approved', 'trending', $1, '{}'::jsonb)`,
      [hash],
    );
    const use = await reserve(db, 'drake', null, T0);
    await markPublished(db, use, T0);
    const blocked = (await availableTemplates(db, day(10))).blocked.find((b) => b.id === 'drake-reupload');
    assert.match(blocked?.reason ?? '', /near-duplicates drake/);
  }));

test('safety net: no two catalog templates are near-duplicates of each other', async () => {
  const hashes = await catalogHashes();
  const ids = Object.keys(hashes);
  assert.equal(ids.length, 60);
  let closest = 64;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const d = hamming(hashes[ids[i]!]!, hashes[ids[j]!]!);
      closest = Math.min(closest, d);
      assert.ok(d > NEAR_DUPLICATE_BITS, `${ids[i]} and ${ids[j]} are only ${d} bits apart`);
    }
  }
  assert.ok(closest > NEAR_DUPLICATE_BITS);
});
