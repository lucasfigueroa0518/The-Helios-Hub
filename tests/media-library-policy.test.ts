/**
 * Photo bank policy (DECISIONS_LOG D49): what is stored per outcome × lane,
 * the licence classes, and the tags. Pure functions, offline.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { planOffer } from '@/lib/media-library/bank';
import { laneForUsedSource, licenceOf, metaOf, shouldStore, tagsOf, words } from '@/lib/media-library/policy';
import type { Candidate, Lane, PhotoSource } from '@/lib/social/photos/find';
import type { VettedPhoto } from '@/lib/social/photos/vetted';

const OPEN = { licence: 'open' as const, reuseOk: true, reason: 'x' };
const NONE = { licence: null, reuseOk: false as const, reason: 'x' };

test('store table: outcome × lane (licence passing)', () => {
  const lanes: Lane[] = ['headshot', 'second', 'ceo', 'hq', 'logo', 'article', 'official', 'stocksnap', 'commons-search', 'openverse'];
  for (const lane of lanes) {
    const verified = !['stocksnap', 'commons-search', 'openverse'].includes(lane);
    assert.equal(shouldStore('picked', { lane, verified }, OPEN), true, `picked ${lane}`);
    assert.equal(shouldStore('passed', { lane, verified }, OPEN), true, `passed ${lane}`);
    assert.equal(shouldStore('used', { lane, verified }, OPEN), true, `used ${lane}`);
    assert.equal(shouldStore('rejected', { lane, verified }, OPEN), false, `rejected ${lane} is never stored`);
    assert.equal(shouldStore('verified', { lane, verified }, OPEN), ['headshot', 'second', 'ceo', 'hq', 'logo'].includes(lane), `verified ${lane}: identity lanes only`);
  }
  assert.equal(shouldStore('verified', { lane: 'headshot', verified: false }, OPEN), false, 'an unverified "headshot" is not identity-verified');
  assert.equal(shouldStore('picked', { lane: 'openverse', verified: false }, NONE), false, 'no licence, no image');
  assert.equal(shouldStore('picked', { lane: 'openverse', verified: false }, { licence: 'unknown', reuseOk: false, reason: 'x' }), false);
});

test('licence classes: open and government reusable; company and official library-only; the rest not stored', () => {
  const subjects = ['OpenAI', 'Sam Altman'];
  const l = (credit: string, source: PhotoSource) => licenceOf({ credit, source }, subjects);
  assert.deepEqual([l('Jane Doe, CC BY · via flickr', 'stock').licence, l('Jane Doe, CC BY · via flickr', 'stock').reuseOk], ['open', true]);
  assert.equal(l('Gage Skidmore, CC BY-SA 2.0 · Wikimedia Commons', 'commons').licence, 'open');
  assert.equal(l('Logo: OpenAI (public domain) · Wikimedia Commons', 'logo').licence, 'open');
  const gov = l('Official White House Photo by Daniel Torok', 'article');
  assert.deepEqual([gov.licence, gov.reuseOk], ['government', true]);
  const company = l('Courtesy of OpenAI', 'article');
  assert.deepEqual([company.licence, company.reuseOk], ['company', false], '"Courtesy of" the story company: library only');
  const official = l('Image: OpenAI', 'official');
  assert.deepEqual([official.licence, official.reuseOk], ['company', false], 'an official image: library only');
  assert.equal(l('Image: Google', 'official').licence, null, 'an official image of a company not in SUBJECTS fails C6');
  assert.equal(l('Kevin Dietsch / Getty Images, CC BY', 'stock').licence, null, 'agency credit');
  assert.equal(l('Jane Doe · via flickr', 'stock').licence, null, 'no licence named');
  assert.equal(l('Photo: John Smith', 'article').licence, null, 'unrecognised article credit');
  assert.equal(l('', 'stock').licence, null, 'no credit');
});

const cand = (over: Partial<Candidate>): Candidate => ({ url: 'https://x/1.jpg', credit: 'A, CC0 · via StockSnap', source: 'stock', width: 3000, height: 2000, qid: null, subject: null, lane: 'stocksnap', date: null, title: 'server room', verified: false, ...over });
const item = (over: Partial<VettedPhoto> & { candidate: Candidate }): VettedPhoto => ({ slide: 2, request: { kind: 'thematic', query: 'server racks' }, outcome: 'picked', tileTags: ['Server Racks', 'blue lights'], fit: 0.9, vision: { scene: 'server racks', pass: true, verdict: null }, ...over });

test('planOffer: every vetted item is a sighting; only the stored ones are sources', () => {
  const rows = planOffer({
    runKind: 'carousel', runRef: 'story-1', subjects: ['OpenAI', 'Sam Altman'],
    items: [
      item({ candidate: cand({ url: 'https://x/pick.jpg' }) }),
      item({ outcome: 'passed', candidate: cand({ url: 'https://x/alt.jpg' }) }),
      item({ outcome: 'rejected', candidate: cand({ url: 'https://x/fruit.jpg' }), fit: 0.05, reason: 'tags' }),
      item({ outcome: 'verified', request: { kind: 'person', query: 'Sam Altman' }, candidate: cand({ url: 'https://x/sam.jpg', lane: 'headshot', source: 'commons', verified: true, qid: 'Q7407093', subject: 'Sam Altman', credit: 'TechCrunch, CC BY 2.0 · Wikimedia Commons' }) }),
      item({ outcome: 'picked', candidate: cand({ url: 'https://x/agency.jpg', credit: 'Getty Images, CC BY' }) }),
      item({ outcome: 'passed', request: { kind: 'company', query: 'OpenAI' }, candidate: cand({ url: 'https://x/official.png', lane: 'official', source: 'official', verified: true, credit: 'Image: OpenAI' }) }),
    ],
  });
  assert.equal(rows.sightings.length, 6);
  assert.deepEqual(rows.sources.map((s) => s.url), ['https://x/pick.jpg', 'https://x/alt.jpg', 'https://x/sam.jpg', 'https://x/official.png']);
  assert.deepEqual(rows.sources.map((s) => [s.licence, s.reuse_ok]), [['open', true], ['open', true], ['open', true], ['company', false]]);
  const sam = rows.sightings.find((s) => s.url === 'https://x/sam.jpg')!;
  assert.deepEqual([sam.qid, sam.subject, sam.verified, sam.request_qid], ['Q7407093', 'Sam Altman', true, 'Q7407093']);
  assert.deepEqual(rows.sightings[0]!.tile_tags, ['server racks', 'blue lights'], 'tile tags lowercased');
  assert.equal(rows.sightings.find((s) => s.url === 'https://x/fruit.jpg')!.outcome, 'rejected');
});

test('tags: tile tags, request words and what the vision check saw, minus stopwords; rejected sightings never tag', () => {
  assert.deepEqual(words('A close-up photo of the Server Racks, in 2026!'), ['server', 'racks']);
  const tags = tagsOf([
    { outcome: 'picked', tile_tags: ['Server Racks', 'blue lights'], request_query: 'data center aisle', vision: { what_it_shows: 'Rows of servers with cables' } },
    { outcome: 'rejected', tile_tags: ['red apple'], request_query: 'apple', vision: null },
  ]);
  assert.deepEqual(tags, ['server racks', 'blue lights', 'server', 'racks', 'blue', 'lights', 'data', 'center', 'aisle', 'rows', 'servers', 'cables']);
  assert.ok(!tags.includes('apple'));
});

test('meta: the most permissive source decides credit and reuse; identities only from verified sightings; vision pass only from the close-up', () => {
  const m = metaOf(
    [
      { url: 'a', lane: 'article', credit: 'Courtesy of OpenAI', licence: 'company', reuse_ok: false },
      { url: 'b', lane: 'headshot', credit: 'X, CC BY · Wikimedia Commons', licence: 'open', reuse_ok: true },
    ],
    [
      { outcome: 'verified', request_kind: 'person', request_query: 'Sam Altman', qid: 'Q1', subject: 'Sam Altman', verified: true, vision: { scene: 'an image from OpenAI\'s announcement', pass: true } },
      { outcome: 'used', request_query: 'Sam Altman', qid: null, verified: false },
    ],
  );
  assert.deepEqual([m.licence, m.reuse_ok, m.credit], ['open', true, 'X, CC BY · Wikimedia Commons']);
  assert.deepEqual(m.qids, ['Q1']);
  assert.equal(m.vision_pass, false, 'the official-image check is not the close-up');
  const scene = metaOf([{ url: 's', lane: 'openverse', credit: 'c, CC0', licence: 'open', reuse_ok: true }], [{ outcome: 'used', request_query: 'wall clock', vision: { scene: 'wall clock', pass: true, inferred: true } }]);
  assert.deepEqual([scene.vision_pass, scene.scenes], [true, ['wall clock']]);
});

test('used_photos sources map to lanes (StockSnap told apart by its credit)', () => {
  assert.equal(laneForUsedSource('stock', 'Jane, CC BY · via flickr'), 'openverse');
  assert.equal(laneForUsedSource('stock', 'Snap, CC0 · via StockSnap'), 'stocksnap');
  assert.equal(laneForUsedSource('commons', null), 'headshot');
  assert.equal(laneForUsedSource('logo', null), 'logo');
  assert.equal(laneForUsedSource('stories', null), null);
  assert.equal(laneForUsedSource(null, null), null);
});
