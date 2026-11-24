/**
 * Last Few Days and the photo bank (DECISIONS_LOG D49): the run's finder gets
 * the bank on both sides (its reader as a finder source, its offers for the
 * photos it picks), and everything fails open. Offline: the bank's database
 * is a stub query, the design stage is stubbed, nothing is searched.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createPhotoBank, type PhotoBank } from '@/lib/media-library/bank';
import { lfdPhotoFinder } from '@/lib/lfd/live';
import type { DraftPhotos } from '@/lib/social/photos/design';
import type { Candidate, PhotoTrace } from '@/lib/social/photos/find';
import type { HubQuery } from '@/lib/social-hub/db';
import { createLivePhotoFinder, type PhotoRequest } from '@/lib/stories/photos';

const pick: Candidate = { url: 'https://a/nvidia-logo.png', credit: 'Logo: Nvidia (public domain) · Wikimedia Commons', source: 'logo', width: 1200, height: 600, qid: 'Q182477', subject: 'Nvidia', lane: 'logo', date: null, title: '', verified: true };
const trace = (photo: Candidate | null): PhotoTrace => ({ request: { kind: 'logo', query: 'Nvidia' }, photo, via: photo ? photo.lane : 'icon', icon: null, identity: null, steps: [], alternates: [] });
const reqs = (): PhotoRequest[] => [{ kind: 'logo', query: 'Nvidia', subjects: [{ name: 'Nvidia', type: 'organization' }], storyDate: '2026-11-02', sourceUrls: [], exclude: new Set() }];
const seen: Array<Parameters<typeof createLivePhotoFinder>[0]> = [];
const design: NonNullable<Parameters<typeof createLivePhotoFinder>[0]>['design'] = async (_draft, _brief, _pages, deps) => {
  seen.push({ bank: deps.bank ? ({ reader: deps.bank } as PhotoBank) : undefined });
  return { cover: trace(pick), slides: [], costUsd: { tags: 0, vision: 0 }, vetted: [{ slide: 1, request: { kind: 'logo', query: 'Nvidia' }, outcome: 'picked', candidate: { ...pick }, tileTags: null, fit: null, vision: null }] } satisfies DraftPhotos;
};
const withDesign: typeof createLivePhotoFinder = (o) => createLivePhotoFinder({ ...o, design });

/** A stub database: the bank's settings (capture, finder_source 'compete'), and every statement recorded. */
function stubDb(opts: { capture: boolean; down?: boolean }) {
  const sql: string[] = [];
  const query: HubQuery = async <T,>(text: string) => {
    sql.push(text);
    if (opts.down) throw new Error('connection refused');
    if (/to_regclass\('media_library\.settings'\)/.test(text)) return { rows: [{ ok: true }] as T[] };
    if (/FROM media_library\.settings/.test(text)) return { rows: [{ key: 'capture', value: opts.capture }, { key: 'finder_source', value: 'compete' }] as T[] };
    return { rows: [] as T[] };
  };
  return { sql, query };
}

const jev = async () => ({ answers: {}, usage: { input_tokens: 0, output_tokens: 0 }, model: 'stub' });

test('LFD builds its finder with the bank: the reader goes to the design stage and the run offers its picks (runKind story, runRef lfd:<id>)', async () => {
  const db = stubDb({ capture: true });
  const { photos, bank } = await lfdPhotoFinder(db.query, { jev, runRef: 'lfd:run-1', log: () => {} }, { createPhotoBank, createLivePhotoFinder: withDesign });
  assert.ok(bank);
  assert.equal(await bank.reader.mode(), 'compete');
  seen.length = 0;
  const out = await photos.findSet!(reqs());
  assert.equal(out[0]?.src, pick.url);
  assert.equal(seen[0]?.bank?.reader, bank.reader, 'the finder searches the bank');
  await bank.drain(2_000);
  const sightings = db.sql.find((s) => /INSERT INTO media_library\.sightings/.test(s));
  assert.ok(sightings, 'the pick is offered');
  assert.ok(db.sql.some((s) => /INSERT INTO media_library\.photo_sources/.test(s)), 'the verified logo is queued to store');
});

test('LFD fails open: capture off writes nothing, an unreachable bank or one that cannot be built leaves the finder as it was', async () => {
  const off = stubDb({ capture: false });
  const a = await lfdPhotoFinder(off.query, { jev, runRef: 'lfd:run-2', log: () => {} }, { createPhotoBank, createLivePhotoFinder: withDesign });
  const outOff = await a.photos.findSet!(reqs());
  await a.bank!.drain(2_000);
  assert.ok(!off.sql.some((s) => /INSERT/.test(s)));

  const down = stubDb({ capture: true, down: true });
  const b = await lfdPhotoFinder(down.query, { jev, runRef: 'lfd:run-3', log: () => {} }, { createPhotoBank, createLivePhotoFinder: withDesign });
  assert.equal(await b.bank!.reader.mode(), 'off');
  const outDown = await b.photos.findSet!(reqs());
  await b.bank!.drain(2_000);

  const lines: string[] = [];
  const c = await lfdPhotoFinder(off.query, { jev, runRef: 'lfd:run-4', log: (l) => lines.push(l) }, { createPhotoBank: () => { throw new Error('no bank'); }, createLivePhotoFinder: withDesign });
  assert.equal(c.bank, undefined);
  seen.length = 0;
  const outNone = await c.photos.findSet!(reqs());
  assert.equal(seen[0]?.bank, undefined);
  assert.match(lines[0]!, /no bank/);
  assert.deepEqual(outOff, outNone);
  assert.deepEqual(outDown, outNone);
});
