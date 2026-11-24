/**
 * Real or AI? on the shared photo machinery (Stories Split, SS-20..SS-24), offline: the `roa` profile, findRealPhotos
 * through the shared finder's archives path (stubbed Commons and NASA, EXIF kept for the reveal), the used-photo ledger
 * check (by URL and by picture), and the photo bank offer for a real photo and an AI image.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import sharp from 'sharp';

import { findPhotos } from '@/lib/photos/find';
import { PHOTO_PROFILES } from '@/lib/photos/profiles';
import { EMPTY_LEDGER, type UsedLedger } from '@/lib/photos/used-match';
import { bankOffer, type IntakeItem } from '@/lib/stories/roa/intake';
import { COMMONS_API, findRealPhotos, NASA_API, realNeed, type RealDeps } from '@/lib/stories/roa/real';

const solid = (seed: number, size = { width: 600, height: 1300 }) =>
  sharp({ create: { ...size, channels: 3, background: { r: (seed * 53) % 256, g: (seed * 97) % 256, b: (seed * 31) % 256 } } }).jpeg().toBuffer();

const seedOf = (url: string) => [...url].reduce((n, ch) => n + ch.charCodeAt(0), 0);
const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });

/** Commons and NASA, keyed by URL; anything else is a 404. `wide` makes the Commons find 3:1. */
function archives(opts: { wide?: boolean } = {}) {
  const urls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.startsWith(COMMONS_API)) {
      return json({
        query: {
          pages: [{
            title: 'File:Night_sky.jpg',
            imageinfo: [{
              url: 'https://upload.test/orig/night.jpg', thumburl: 'https://upload.test/thumb/night.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Night_sky.jpg',
              width: opts.wide ? 4800 : 1600, height: opts.wide ? 1600 : 2400,
              extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: 'Jane Doe' }, DateTimeOriginal: { value: '2019-05-01 10:00' }, ObjectName: { value: 'Night sky' } },
              metadata: [{ name: 'Make', value: 'NIKON CORPORATION' }, { name: 'Model', value: 'NIKON D7200' }, { name: 'FNumber', value: '28/10' }, { name: 'ISOSpeedRatings', value: 3200 }],
            }],
          }],
        },
      });
    }
    if (url.startsWith(`${NASA_API}/search`)) {
      return json({ collection: { items: [{ data: [{ nasa_id: 'iss001', title: 'Aurora from the ISS', date_created: '2017-03-01T00:00:00Z', center: 'JSC', media_type: 'image' }] }] } });
    }
    if (url === `${NASA_API}/metadata/iss001`) return json({ location: 'https://meta.test/iss001.json' });
    if (url === 'https://meta.test/iss001.json') return json({ 'EXIF:Make': 'Canon', 'EXIF:Model': 'Canon EOS 5D', 'EXIF:FocalLength': '24 mm', 'AVAIL:Location': 'Low Earth orbit' });
    if (url.startsWith('https://images-assets.nasa.gov/') || url.startsWith('https://upload.test/')) {
      return new Response(new Uint8Array(await solid(seedOf(url))), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return Object.assign(fn, { urls });
}

const deps = (http: typeof fetch, over: Partial<RealDeps> = {}): RealDeps & { notes: string[] } => {
  const notes: string[] = [];
  return { fetch: http, avoidUrls: new Set(), avoidKeys: new Set(), log: (m) => notes.push(m), notes, ...over };
};

test('roa profile: open or government, credit off the frame, 1200 px tall, 9:16-croppable, no faces/brands/text, archives only', () => {
  const p = PHOTO_PROFILES.roa;
  assert.equal(p.licence, 'open_or_government');
  assert.equal(p.sources, 'archives');
  assert.equal(p.creditOnFrame, false);
  assert.equal(p.minHeight, 1200);
  assert.equal(p.maxAspect, 16 / 9);
  assert.deepEqual([...(p.refuse ?? [])], ['faces', 'brands', 'text']);
  assert.deepEqual([PHOTO_PROFILES.trivia.minShortSide, PHOTO_PROFILES.trivia.coverMinShortSide, PHOTO_PROFILES.trivia.allowLogo], [600, 1080, false]);
});

test('findPhotos(roa): the archives path, never the harvest; free; credit kept off the frame; too wide refused; exclude holds', async () => {
  const http = archives({ wide: true });
  const budget = { usd: 0, capUsd: 0.3 };
  const run = async () => { throw new Error('the harvest must not run for roa'); };
  const out = await findPhotos([realNeed({ subject: 'nature_weather', words: 'night sky' })], PHOTO_PROFILES.roa, { now: () => new Date(), fetch: http, run: run as never }, {
    exclude: new Set(['https://images.nasa.gov/details/iss001']),
    budget,
    limit: 4,
  });
  assert.equal(budget.usd, 0);
  assert.equal(out.photos[0], null, 'Commons is 3:1 and NASA is excluded');
  assert.match(out.traces[0]!.join('\n'), /1 too wide, 1 excluded/);

  const ok = await findPhotos([realNeed({ subject: 'nature_weather', words: 'night sky' })], PHOTO_PROFILES.roa, { now: () => new Date(), fetch: archives() }, { exclude: new Set(), budget, limit: 4 });
  assert.deepEqual(ok.photos[0], { src: 'https://upload.test/thumb/night.jpg', credit: '', kind: 'scene' });
  assert.deepEqual(ok.found![0]!.map((f) => f.source), ['commons', 'nasa']);
});

test('findRealPhotos (shared): space asks NASA first; EXIF camera, place and year reach the provenance; the original and its URL are kept', async () => {
  const http = archives();
  const d = deps(http, { finder: 'shared', used: EMPTY_LEDGER });
  const photos = await findRealPhotos(d, { subject: 'space', words: 'aurora over earth' });
  assert.deepEqual(photos.map((p) => p.provenance.kind), ['nasa', 'commons']);
  const [nasa, commons] = photos as [(typeof photos)[number], (typeof photos)[number]];
  assert.equal(nasa.provenance.place, 'Low Earth orbit');
  assert.equal(nasa.provenance.camera?.body, 'Canon EOS 5D');
  assert.equal(nasa.provenance.year, '2017');
  assert.equal(nasa.provenance.src, 'https://images-assets.nasa.gov/image/iss001/iss001~large.jpg');
  assert.equal(commons.provenance.camera?.body, 'Nikon D7200');
  assert.equal(commons.provenance.camera?.iso, 3200);
  assert.equal(commons.provenance.licence, 'CC BY-SA 4.0');
  assert.equal(commons.provenance.src, 'https://upload.test/thumb/night.jpg');
  assert.ok(commons.original && commons.original.length > 0);
  assert.ok(d.notes.some((n) => n.startsWith('real shared: archives')), d.notes.join('\n'));
});

const ledger = (over: Partial<UsedLedger>): UsedLedger => ({ ...EMPTY_LEDGER, ...over });

for (const finder of ['legacy', 'shared'] as const) {
  test(`findRealPhotos (${finder}): the used-photo ledger refuses a find by URL and by picture, on top of the own history`, async () => {
    const byUrl = deps(archives(), { finder, used: ledger({ urls: new Set(['https://upload.test/thumb/night.jpg']) }) });
    const got = await findRealPhotos(byUrl, { subject: 'nature_weather', words: 'night sky' });
    assert.deepEqual(got.map((p) => p.provenance.kind), ['nasa'], 'the Commons find was published by another type');

    const nasaPicture = 'f'.repeat(16);
    const nasaBytes = await solid(seedOf('https://images-assets.nasa.gov/image/iss001/iss001~large.jpg'));
    const byPicture = deps(archives(), {
      finder,
      used: ledger({ dhashes: [nasaPicture] }),
      hash: async (bytes) => ({ phash: '0'.repeat(16), dhash: bytes.equals(nasaBytes) ? nasaPicture : '1'.repeat(16) }),
    });
    const got2 = await findRealPhotos(byPicture, { subject: 'nature_weather', words: 'night sky' });
    assert.deepEqual(got2.map((p) => p.provenance.kind), ['commons'], 'the NASA picture matches a published one');
    assert.ok(byPicture.notes.some((n) => /published in the last 20 days \(same picture\)/.test(n)));
  });
}

const item = (over: Partial<IntakeItem>): IntakeItem => ({
  jpeg: Buffer.from('jpeg'),
  imageKey: 'abc123',
  truth: 'real',
  subject: 'nature_weather',
  trap: 'too_perfect',
  provenance: { kind: 'commons', url: 'https://commons.wikimedia.org/wiki/File:X.jpg', licence: 'CC BY-SA 4.0', credit: 'Jane Doe / Wikimedia Commons', year: '2019', src: 'https://upload.test/x.jpg' },
  original: Buffer.from('original'),
  about: { title: 'Mirror lake' },
  specText: 'mirror lake mountains',
  ...over,
});

test('bank offer: a real photo keeps its licence and credit (reusable); an AI image is generated, not reusable, with model and prompt', () => {
  const at = new Date('2026-11-17T09:00:00Z');
  const real = bankOffer(item({}), 'roa:abc123', at, 0.7)!;
  assert.equal(real.runKind, 'real_or_ai');
  const r = real.items[0]!;
  assert.deepEqual([r.url, r.licence, r.reuseOk, r.truth, r.credit, r.lane, r.bytes.toString()], ['https://upload.test/x.jpg', 'open', true, 'real', 'Jane Doe / Wikimedia Commons', 'commons-search', 'original']);
  const nasa = bankOffer(item({ provenance: { kind: 'nasa', url: 'https://images.nasa.gov/details/a', licence: 'Public domain (NASA)', credit: 'NASA/JSC', src: 'https://images-assets.nasa.gov/a.jpg' } }), 'k', at, 0.5)!;
  assert.equal(nasa.items[0]!.licence, 'government');
  assert.equal(bankOffer(item({ original: undefined }), 'k', at, 0.5), null, 'a real photo is never stored cut');
  assert.equal(bankOffer(item({ provenance: { kind: 'bank', url: 'https://b/1.jpg', licence: 'open', credit: 'x' } }), 'k', at, 0.5), null, 'already in the bank');

  const prompt = 'Hobbyist photo of a goat on a sunny hillside path';
  const ai = bankOffer(item({ truth: 'ai', trap: 'amateur', jpeg: Buffer.from('ai-jpeg'), original: undefined, provenance: { kind: 'generated', model: 'gpt-image-2', prompt, createdAt: at.toISOString() } }), 'roa:abc123', at, 0.8)!;
  const a = ai.items[0]!;
  assert.deepEqual([a.url, a.licence, a.reuseOk, a.truth, a.genModel, a.genPrompt, a.lane, a.bytes.toString()], ['storage:stories/roa/candidates/abc123.jpg', 'generated', false, 'ai', 'gpt-image-2', prompt, 'real-or-ai', 'ai-jpeg']);
  const viral = bankOffer(item({ truth: 'ai', trap: 'amateur', original: undefined, provenance: { kind: 'viral', url: 'https://x.test/p', model: 'Midjourney' } }), 'k', at, 0.8)!;
  assert.deepEqual([viral.items[0]!.licence, viral.items[0]!.reuseOk, viral.items[0]!.genModel, viral.items[0]!.genPrompt], ['generated', false, 'Midjourney', null]);
});
