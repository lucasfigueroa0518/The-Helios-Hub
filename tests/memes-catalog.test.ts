/**
 * Meme lab M0 (planning/Memes/BUILD_PLAN.md): the schema loads, the catalog is
 * exactly the 60 approved cards and none of the excluded, and the situations
 * are exactly AS-01 to AS-20. The approved ids are frozen here, so a card can't
 * appear or vanish without this test changing with it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import sharp from 'sharp';

import { EXCLUDED_TEMPLATES, TEMPLATE_CATALOG, writableSlots } from '@/lib/memes/catalog';
import { openLocalMemesDb } from '@/lib/memes/db';
import { AUDIENCE_SITUATIONS, situation } from '@/lib/memes/situations';

/** TEMPLATE_CARDS.md as approved: Imgflip id by rank. */
const APPROVED: Record<number, string> = {
  1: '181913649', 2: '87743020', 3: '112126428', 5: '217743513', 7: '124822590', 8: '322841258', 9: '135256802', 10: '131940431',
  11: '131087935', 12: '97984', 13: '4087833', 15: '91538330', 16: '309868304', 19: '188390779', 22: '161865971', 23: '101470',
  24: '79132341', 25: '102156234', 26: '100777631', 27: '177682295', 28: '61579', 29: '247375501', 30: '180190441', 31: '427308417',
  33: '67452763',
  34: '93895088', 35: '3218037', 36: '505705955', 37: '28251713', 38: '178591752', 39: '370867422', 40: '77045868', 41: '55311130',
  43: '110163934', 44: '533936279', 45: '284929871', 46: '354700819', 47: '163573', 48: '148909805', 49: '195515965', 50: '89370399',
  51: '137501417', 52: '27813981', 53: '206151308', 54: '316466202', 55: '1035805', 56: '119215120', 57: '84341851', 58: '187102311',
  59: '166969924', 60: '216523697', 61: '99683372', 62: '259237855', 63: '61585', 64: '133946291', 65: '114585149', 66: '145139900',
  67: '129315248', 68: '226297822', 69: '155067746',
};
const EXCLUDED_IDS = [
  '222403160', '252600902', '80707627', '129242436', '124055727', '438680', '224015000', '252758727', '208915813',
  '171305372', '247113703', '224514655', '221578498', '104893621', '371619279', '135678846',
];

test('catalog: exactly the 60 approved cards, in rank order, and none of the excluded', () => {
  assert.deepEqual(Object.fromEntries(TEMPLATE_CATALOG.map((t) => [t.rank, t.imgflipId])), APPROVED);
  assert.deepEqual(TEMPLATE_CATALOG.map((t) => t.rank), [...TEMPLATE_CATALOG.map((t) => t.rank)].sort((a, b) => a - b));
  assert.deepEqual(EXCLUDED_TEMPLATES.map((t) => t.imgflipId).sort(), [...EXCLUDED_IDS].sort());
  for (const t of TEMPLATE_CATALOG) assert.ok(!EXCLUDED_IDS.includes(t.imgflipId), t.name);
  assert.equal(new Set(TEMPLATE_CATALOG.map((t) => t.id)).size, 60);
  assert.equal(new Set(TEMPLATE_CATALOG.map((t) => t.family)).size, 60, 'each card is its own family');
});

test('catalog: every image is in the repo at the size the card says', async () => {
  for (const t of TEMPLATE_CATALOG) {
    const file = `lib/memes/assets/templates/${t.image}`;
    assert.ok(fs.existsSync(file), file);
    const m = await sharp(file).metadata();
    assert.deepEqual([m.width, m.height], [t.width, t.height], t.id);
  }
});

test('catalog: every slot is fillable or filled by code, and derived slots point at a real slot', () => {
  for (const t of TEMPLATE_CATALOG) {
    assert.ok(writableSlots(t).length >= 1, `${t.id} has nothing to write`);
    const ids = new Set(t.slots.map((x) => x.id));
    assert.equal(ids.size, t.slots.length, `${t.id}: duplicate slot id`);
    for (const slot of t.slots) {
      const byCode = Boolean(slot.fixed) || Boolean(slot.derived);
      assert.equal(slot.accepts.length === 0, byCode, `${t.id}.${slot.id}: fillable xor filled by code`);
      if (slot.derived) assert.ok(writableSlots(t).some((w) => w.id === slot.derived!.from), `${t.id}.${slot.id} derives from a missing slot`);
    }
  }
});

test('catalog: every situation a card names exists', () => {
  for (const t of TEMPLATE_CATALOG) {
    assert.ok(t.situations.length > 0, t.id);
    for (const id of t.situations) assert.ok(situation(id), `${t.id} names ${id}`);
  }
});

test('situations: exactly AS-01 to AS-20, 17 everyday and 3 builder', () => {
  assert.deepEqual(AUDIENCE_SITUATIONS.map((x) => x.id), Array.from({ length: 20 }, (_, i) => `AS-${String(i + 1).padStart(2, '0')}`));
  assert.equal(AUDIENCE_SITUATIONS.filter((x) => x.audience === 'builder').map((x) => x.id).join(), 'AS-18,AS-19,AS-20');
  for (const x of AUDIENCE_SITUATIONS) assert.ok(x.viewerLine.startsWith('Me'), `${x.id}: the viewer line is the viewer`);
});

test('schema: loads on PGlite, the catalog syncs, and the ledger refuses a use that is both published and released', async () => {
  const { db, pg } = await openLocalMemesDb();
  try {
    const { rows } = await db.query<{ n: number; families: number }>(`SELECT count(*)::int AS n, count(DISTINCT family_key)::int AS families FROM memes.templates WHERE status = 'approved'`);
    assert.deepEqual(rows[0], { n: 60, families: 60 });
    await assert.rejects(db.query(`INSERT INTO memes.template_uses (family_key, template_id, published_at, released_at) VALUES ('Drakeposting', 'drake', now(), now())`));
    const again = await openLocalMemesDb().then(async (o) => { await o.pg.close(); return true; });
    assert.ok(again, 'opening twice is idempotent');
  } finally {
    await pg.close();
  }
});
