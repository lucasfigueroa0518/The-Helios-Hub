/**
 * Field Notes photo pool: HEIC conversion, ingest and dedupe on PGlite (the real media_library and
 * field_notes schemas), and the pool rules as pure functions. Images are made with sharp; the bucket
 * is in memory. Nothing reaches the network or the real database.
 */
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { facesInline, ingestPhoto, hamming, NEAR_DUPLICATE_MAX_DISTANCE } from '@/lib/field-notes/photos/ingest';
import { FACES_LEASE_MINUTES, FACES_MAX_ATTEMPTS, runFacesStep } from '@/lib/field-notes/photos/faces-worker';
import { isHeif, toJpeg } from '@/lib/field-notes/photos/heic';
import { parseExif } from '@/lib/field-notes/photos/exif';
import { isAvailable, markUsed, pickPhotos, pickPostPhotos, checkPhotoPool, pickReplacement, poolVariety, publishedPhotoIds, rejectPhoto, releaseIfRested, restorePhoto } from '@/lib/field-notes/photos/pool';
import { mediaLibraryKey } from '@/lib/photos/used';
import { listPool, recordUse, releaseRested, restorePhotoToPool, retirePhoto, setPhotoTags } from '@/lib/field-notes/photos/store';
import { masterPath, type Query } from '@/lib/media-library/types';
import type { PhotoKind, PoolPhoto } from '@/lib/field-notes/types';
import { memoryBucket } from './fixtures/media-library/pglite';
import { finalizeUploadRoute, signUploadRoute, sniffMime, type FinalizeEnv, type SignEnv } from '@/app/api/field-notes/photos/handler';
import { FACES_AUTO_LABEL, INCOMING_PATH, MAX_UPLOAD_BYTES, OVERSIZE_MESSAGE, PHOTO_KIND_LABEL, POSTING_NOTICE, UPLOAD_KINDS } from '@/app/api/field-notes/photos/rules';
import { outcomeOf, precheck, uploadFiles, type SendFile } from '@/components/field-notes/upload-client';
import { createFacePhotoDetector, decideFacePhoto, FACE_RULES, iou, type DetectFacePhoto, type FaceAnalysis, type FaceHit } from '@/lib/field-notes/photos/faces';
import { PHOTO_KINDS } from '@/lib/field-notes/types';

const schemaSql = (file: string) =>
  readFileSync(path.join(process.cwd(), 'db', file), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('\\'))
    .join('\n');

async function openDb(): Promise<Query> {
  const pg = new PGlite();
  await pg.exec(schemaSql('media_library_schema.sql'));
  await pg.exec(schemaSql('field_notes_schema.sql'));
  return async (text, params) => ({ rows: (await pg.query(text, params as unknown[])).rows as any[] });
}

/** A busy picture (seeded blocks of grey), so different seeds hash far apart. */
async function picture(seed: number, o: { width?: number; height?: number } = {}): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const w = 96;
  const h = 72;
  const raw = Buffer.alloc(w * h * 3);
  let s = seed * 2654435761;
  const cells = new Map<number, number>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const key = Math.floor(y / 9) * 100 + Math.floor(x / 12);
      if (!cells.has(key)) {
        s = (s * 1103515245 + 12345) >>> 0;
        cells.set(key, s >>> 24);
      }
      raw.fill(cells.get(key)!, (y * w + x) * 3, (y * w + x) * 3 + 3);
    }
  }
  let img = sharp(raw, { raw: { width: w, height: h, channels: 3 } });
  if (o.width) img = img.resize(o.width, o.height);
  return img.jpeg({ quality: 92 }).toBuffer();
}

/** A JPEG with iPhone-style EXIF including a GPS block. */
async function withLocation(): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp(await picture(7))
    .withExif({
      IFD0: { Make: 'Apple', Model: 'iPhone 15 Pro' },
      IFD2: { DateTimeOriginal: '2026:10:30 14:05:09', OffsetTimeOriginal: '-04:00' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '40/1 26/1 46/1', GPSLongitudeRef: 'W', GPSLongitude: '79/1 58/1 56/1' },
    })
    .jpeg({ quality: 92 })
    .toBuffer();
}

const setup = async () => ({ db: await openDb(), bucket: memoryBucket() });

// ── ingest and dedupe ───────────────────────────────────────────────────────

test('a new photo is stored as an own, non-reusable bank photo plus a live pool row', async () => {
  const { db, bucket } = await setup();
  const r = await ingestPhoto({ db, bucket }, { bytes: await picture(1), mime: 'image/jpeg', uploadedBy: 'tommy' });
  assert.equal(r.kind, 'stored');
  if (r.kind !== 'stored') return;
  const { rows } = await db(
    `SELECT p.licence, p.reuse_ok, p.credit, p.width, p.height, p.dhash, f.status, f.uploaded_by FROM media_library.photos p JOIN field_notes.pool f ON f.photo_id = p.id WHERE p.id = $1`,
    [r.photoId],
  );
  assert.deepEqual({ ...rows[0] }, { licence: 'own', reuse_ok: false, credit: 'Helios team', width: 96, height: 72, dhash: r.dhash, status: 'live', uploaded_by: 'tommy' });
  assert.equal(bucket.uploads, 2);
  assert.match(r.dhash, /^[0-9a-f]{16}$/);
});

test('the same bytes again are an exact duplicate: nothing new is stored', async () => {
  const { db, bucket } = await setup();
  const bytes = await picture(2);
  const first = await ingestPhoto({ db, bucket }, { bytes, mime: 'image/jpeg', uploadedBy: 'tommy' });
  const second = await ingestPhoto({ db, bucket }, { bytes, mime: 'image/jpeg', uploadedBy: 'lucas' });
  assert.equal(first.kind, 'stored');
  assert.deepEqual(second, { kind: 'duplicate_exact', matchId: first.kind === 'stored' ? first.photoId : '', distance: 0 });
  assert.equal((await db(`SELECT 1 FROM field_notes.pool`)).rows.length, 1);
  assert.equal(bucket.uploads, 2);
});

test('a resized re-export is a near duplicate; a different picture is stored', async () => {
  const { db, bucket } = await setup();
  const first = await ingestPhoto({ db, bucket }, { bytes: await picture(3), mime: 'image/jpeg', uploadedBy: 'tommy' });
  const near = await ingestPhoto({ db, bucket }, { bytes: await picture(3, { width: 48, height: 36 }), mime: 'image/jpeg', uploadedBy: 'lucas' });
  assert.equal(near.kind, 'duplicate_near');
  if (near.kind !== 'duplicate_near' || first.kind !== 'stored') return;
  assert.equal(near.matchId, first.photoId);
  assert.ok(near.distance > 0 && near.distance <= NEAR_DUPLICATE_MAX_DISTANCE, `distance ${near.distance}`);
  const other = await ingestPhoto({ db, bucket }, { bytes: await picture(4), mime: 'image/jpeg', uploadedBy: 'lucas' });
  assert.equal(other.kind, 'stored');
  assert.equal((await db(`SELECT 1 FROM field_notes.pool`)).rows.length, 2);
});

test('the near-duplicate distance is a parameter', async () => {
  const { db, bucket } = await setup();
  await ingestPhoto({ db, bucket }, { bytes: await picture(3), mime: 'image/jpeg', uploadedBy: 'tommy' });
  const resized = await picture(3, { width: 48, height: 36 });
  const strict = await ingestPhoto({ db, bucket }, { bytes: resized, mime: 'image/jpeg', uploadedBy: 'tommy' }, { maxNearDistance: -1 });
  assert.equal(strict.kind, 'stored');
});

test('a rejected (retired) photo still blocks its own near duplicate', async () => {
  const { db, bucket } = await setup();
  const first = await ingestPhoto({ db, bucket }, { bytes: await picture(5), mime: 'image/jpeg', uploadedBy: 'tommy' });
  if (first.kind !== 'stored') throw new Error('not stored');
  await retirePhoto(db, first.photoId, 'readable screen');
  const again = await ingestPhoto({ db, bucket }, { bytes: await picture(5, { width: 48, height: 36 }), mime: 'image/jpeg', uploadedBy: 'tommy' });
  assert.equal(again.kind, 'duplicate_near');
});

test('hamming counts differing bits', () => {
  assert.equal(hamming('0000000000000000', '0000000000000000'), 0);
  assert.equal(hamming('0000000000000000', 'ffffffffffffffff'), 64);
  assert.equal(hamming('0000000000000001', '0000000000000003'), 1);
});

// ── EXIF and location ───────────────────────────────────────────────────────

test('EXIF: capture time, camera and the presence of a location are read', async () => {
  const sharp = (await import('sharp')).default;
  const exif = parseExif((await sharp(await withLocation()).metadata()).exif);
  assert.deepEqual(exif, { capturedAt: '2026-10-30T14:05:09-04:00', camera: 'Apple iPhone 15 Pro', orientation: 1, hadLocation: true });
  assert.deepEqual(parseExif(undefined), { capturedAt: null, camera: null, orientation: null, hadLocation: false });
  assert.equal(parseExif(Buffer.from('not exif at all')).camera, null);
});

test('the stored copies carry no location: no EXIF block, no GPS tags, while the row keeps time and camera', async () => {
  const { db, bucket } = await setup();
  const input = await withLocation();
  const r = await ingestPhoto({ db, bucket }, { bytes: input, mime: 'image/jpeg', uploadedBy: 'tommy' });
  if (r.kind !== 'stored') throw new Error('not stored');
  assert.equal(r.exif.hadLocation, true);
  assert.equal(r.exif.camera, 'Apple iPhone 15 Pro');
  const sharp = (await import('sharp')).default;
  assert.equal(parseExif((await sharp(input).metadata()).exif).hadLocation, true, 'the fixture really has GPS');
  assert.equal(bucket.objects.size, 2);
  for (const [, object] of bucket.objects) {
    const meta = await sharp(object.body).metadata();
    assert.equal(meta.exif, undefined);
    assert.equal(parseExif(meta.exif).hadLocation, false);
    assert.equal(object.body.includes(Buffer.from('GPS')), false);
    assert.equal(object.body.includes(Buffer.from('Exif')), false);
  }
  const { rows } = await db(`SELECT exif FROM field_notes.pool`);
  assert.deepEqual(rows[0].exif, { ...r.exif });
  assert.equal(JSON.stringify(rows[0].exif).includes('40'), false);
});

test('dimensions follow the EXIF orientation and the thumb is at most 480 px', async () => {
  const { db, bucket } = await setup();
  const sharp = (await import('sharp')).default;
  const turned = await sharp(await picture(6, { width: 1200, height: 900 })).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const r = await ingestPhoto({ db, bucket }, { bytes: turned, mime: 'image/jpeg', uploadedBy: 'lucas' });
  if (r.kind !== 'stored') throw new Error('not stored');
  assert.equal(r.exif.orientation, 6);
  assert.equal(r.width, 900);
  assert.equal(r.height, 1200);
  const thumb = [...bucket.objects].find(([k]) => k.startsWith('thumbs/'))![1].body;
  const meta = await sharp(thumb).metadata();
  assert.equal(Math.max(meta.width!, meta.height!), 480);
  assert.ok(meta.height! > meta.width!);
});

// ── HEIC ────────────────────────────────────────────────────────────────────

test('HEIC is detected by type or by its ftyp brand; an unsupported type is refused', async () => {
  assert.equal(isHeif(Buffer.alloc(12), 'image/heic'), true);
  assert.equal(isHeif(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic')]), ''), true);
  assert.equal(isHeif(await picture(1), 'image/jpeg'), false);
  await assert.rejects(() => toJpeg(Buffer.from('x'), 'application/pdf'), /Unsupported image type/);
});

test('PNG converts to JPEG; JPEG passes through untouched', async () => {
  const sharp = (await import('sharp')).default;
  const jpeg = await picture(1);
  assert.equal(await toJpeg(jpeg, 'image/jpeg'), jpeg);
  const png = await sharp(jpeg).png().toBuffer();
  assert.equal((await sharp(await toJpeg(png, 'image/png')).metadata()).format, 'jpeg');
});

// A real HEIC cannot be generated offline here (sharp's prebuilt libheif has no HEVC encoder, and sips
// cannot encode in a sandbox), so this uses a HEIC that ships with macOS, when this machine has one.
const systemHeic = ['/System/Library/Templates/Data/Library/User Pictures/Flowers/Lotus.heic', '/Library/User Pictures/Flowers/Lotus.heic'].find(existsSync);
const heicSkip = process.platform !== 'darwin' || !systemHeic ? 'needs macOS (sips) and a system HEIC sample; the Linux runtime has no HEVC decoder yet' : false;

test('HEIC converts to a readable JPEG and ingests with the original bytes hashed', { skip: heicSkip }, async () => {
  const sharp = (await import('sharp')).default;
  const heic = readFileSync(systemHeic!);
  const jpeg = await toJpeg(heic, 'image/heic');
  assert.equal((await sharp(jpeg).metadata()).format, 'jpeg');
  const { db, bucket } = await setup();
  const r = await ingestPhoto({ db, bucket }, { bytes: heic, mime: 'image/heic', uploadedBy: 'tommy' });
  assert.equal(r.kind, 'stored');
  const { rows } = await db(`SELECT mime, bytes, sha256 FROM media_library.photos`);
  assert.equal(rows[0].mime, 'image/heic');
  assert.equal(rows[0].bytes, heic.byteLength);
  const again = await ingestPhoto({ db, bucket }, { bytes: heic, mime: 'image/heic', uploadedBy: 'lucas' });
  assert.equal(again.kind, 'duplicate_exact');
});

// ── pool rules ──────────────────────────────────────────────────────────────

const photo = (id: string, o: Partial<PoolPhoto> = {}): PoolPhoto => ({
  photoId: id,
  uploadedBy: 'tommy',
  uploadedAt: '2026-10-01T12:00:00.000Z',
  status: 'live',
  lastUsedPostSeq: null,
  rejectReason: null,
  kind: 'working',
  opener: false,
  ...o,
});

test('pick is newest upload first, skips retired, and honours count', () => {
  const pool = [
    photo('a', { uploadedAt: '2026-10-01T00:00:00Z' }),
    photo('b', { uploadedAt: '2026-10-03T00:00:00Z' }),
    photo('c', { uploadedAt: '2026-10-02T00:00:00Z' }),
    photo('d', { uploadedAt: '2026-10-04T00:00:00Z', status: 'retired' }),
  ];
  assert.deepEqual(pickPhotos({ pool, nextSeq: 5, restPosts: 8, count: 2 }).map((p) => p.photoId), ['b', 'c']);
  assert.deepEqual(pickPhotos({ pool, nextSeq: 5, restPosts: 8, count: 10 }).map((p) => p.photoId), ['b', 'c', 'a']);
  assert.deepEqual(pickPhotos({ pool, nextSeq: 5, restPosts: 8, count: 0 }), []);
  assert.equal(pool[0]!.photoId, 'a', 'the input is not reordered');
});

test('rest boundary: used at post 10 with rest 8, it sits out posts 11 to 18 and returns at 19', () => {
  const resting = photo('r', { status: 'resting', lastUsedPostSeq: 10 });
  assert.equal(isAvailable(resting, 18, 8), false, 'nextSeq - last = restPosts: still resting');
  assert.equal(isAvailable(resting, 19, 8), true, 'restPosts + 1: back');
  assert.deepEqual(pickPhotos({ pool: [resting], nextSeq: 18, restPosts: 8, count: 1 }), []);
  assert.equal(pickPhotos({ pool: [resting], nextSeq: 19, restPosts: 8, count: 1 }).length, 1);
});

test('a returned photo competes by upload date, not by how long it rested', () => {
  const pool = [photo('old', { uploadedAt: '2026-09-01T00:00:00Z' }), photo('rested-new', { uploadedAt: '2026-10-09T00:00:00Z', status: 'resting', lastUsedPostSeq: 1 })];
  assert.equal(pickPhotos({ pool, nextSeq: 20, restPosts: 8, count: 1 })[0]!.photoId, 'rested-new');
});

test('status transitions: use rests, rest ends back to live, reject retires with a reason, restore brings it back', () => {
  const used = markUsed(photo('x'), 4);
  assert.equal(used.status, 'resting');
  assert.equal(used.lastUsedPostSeq, 4);
  assert.equal(releaseIfRested(used, 12, 8).status, 'resting');
  assert.equal(releaseIfRested(used, 13, 8).status, 'live');
  const rejected = rejectPhoto(used, ' stranger in frame ');
  assert.deepEqual([rejected.status, rejected.rejectReason], ['retired', 'stranger in frame']);
  assert.throws(() => rejectPhoto(used, '  '), /reason/);
  assert.throws(() => markUsed(rejected, 5), /retired/);
  assert.equal(isAvailable(rejected, 99, 8), false);
  const back = restorePhoto(rejected);
  assert.deepEqual([back.status, back.rejectReason], ['resting', null]);
  assert.equal(restorePhoto(rejectPhoto(photo('y'), 'blur')).status, 'live');
});

// ── store ───────────────────────────────────────────────────────────────────

test('store: use, release, retire and restore agree with the pure rules', async () => {
  const { db, bucket } = await setup();
  const ids: string[] = [];
  for (const seed of [10, 20, 30]) {
    const r = await ingestPhoto({ db, bucket }, { bytes: await picture(seed), mime: 'image/jpeg', uploadedBy: 'lucas' });
    if (r.kind !== 'stored') throw new Error('not stored');
    ids.push(r.photoId);
  }
  await recordUse(db, [ids[0]!, ids[1]!], 10);
  let pool = await listPool(db);
  assert.deepEqual(pool.map((p) => p.status).sort(), ['live', 'resting', 'resting']);
  assert.equal(pickPhotos({ pool, nextSeq: 11, restPosts: 8, count: 5 }).length, 1);
  assert.equal(await releaseRested(db, 18, 8), 0);
  assert.equal(await releaseRested(db, 19, 8), 2);
  assert.equal(await retirePhoto(db, ids[2]!, 'third-party logo'), true);
  await assert.rejects(() => retirePhoto(db, ids[2]!, ' '), /reason/);
  pool = await listPool(db);
  assert.equal(pool.find((p) => p.photoId === ids[2])!.rejectReason, 'third-party logo');
  assert.equal(pickPhotos({ pool, nextSeq: 20, restPosts: 8, count: 5 }).length, 2);
  assert.equal(await restorePhotoToPool(db, ids[2]!), true);
  assert.equal((await listPool(db)).find((p) => p.photoId === ids[2])!.status, 'live');
});

// ── variety picker ──────────────────────────────────────────────────────────

const R = { nextSeq: 50, restPosts: 8 };
const day = (n: number) => `2026-10-${String(n).padStart(2, '0')}T00:00:00Z`;
/** n photos of a kind, numbered so a higher number is a newer upload. */
const many = (kind: PhotoKind, n: number, from = 1, o: Partial<PoolPhoto> = {}) =>
  Array.from({ length: n }, (_, i) => photo(`${kind}-${from + i}`, { kind, uploadedAt: day(from + i), ...o }));
const kindsOf = (pool: PoolPhoto[], ids: string[]) => ids.map((id) => pool.find((p) => p.photoId === id)!.kind);
const adjacentSame = (k: PhotoKind[]) => k.some((x, i) => i > 0 && x === k[i - 1]);
const maxOfKind = (k: PhotoKind[]) => Math.max(...['working', 'scenery', 'people', 'event'].map((x) => k.filter((y) => y === x).length));

test('picker: the cover is a people photo, a starred opener first, even when older', () => {
  const pool = [...many('working', 8, 5), photo('face-new', { kind: 'people', uploadedAt: day(20) }), photo('face-star', { kind: 'people', opener: true, uploadedAt: day(2) }), ...many('scenery', 2, 30)];
  const r = pickPostPhotos({ pool, ...R, count: 5 });
  assert.equal(r.photoIds[0], 'face-star');
  assert.equal(r.photoIds.length, 5);
  assert.equal(new Set(r.photoIds).size, 5);
  const noStar = pickPostPhotos({ pool: pool.map((p) => ({ ...p, opener: false })), ...R, count: 5 });
  assert.equal(noStar.photoIds[0], 'face-new');
  assert.ok(noStar.warnings.some((w) => /no people photo is starred as an opener/.test(w)));
});

test('picker: with no people photo the cover falls back and says so', () => {
  const r = pickPostPhotos({ pool: many('working', 6), ...R, count: 5 });
  assert.ok(r.warnings.some((w) => /no people photo was available/.test(w)));
});

test('picker: tip slides use working, scenery and event; no neighbours share a kind and no kind exceeds 2 when the pool allows', () => {
  const pool = [...many('people', 2, 1), ...many('working', 12, 1), ...many('scenery', 3, 20), ...many('event', 3, 40)];
  for (const count of [5, 6]) {
    const r = pickPostPhotos({ pool, ...R, count });
    const k = kindsOf(pool, r.photoIds);
    const tips = k.slice(1, -1);
    assert.equal(r.photoIds.length, count);
    assert.equal(new Set(r.photoIds).size, count, 'never a photo twice');
    assert.equal(k[0], 'people');
    assert.ok(!tips.includes('people'), k.join(','));
    assert.equal(adjacentSame(tips), false, k.join(','));
    assert.ok(maxOfKind(tips) <= 2, k.join(','));
    assert.deepEqual(r.warnings.filter((w) => /share a kind|photos on the tip slides/.test(w)), []);
  }
});

test('picker: Follow takes scenery first', () => {
  const pool = [...many('people', 1, 1), ...many('working', 4, 5), ...many('event', 2, 20), ...many('scenery', 4, 30)];
  const r = pickPostPhotos({ pool, ...R, count: 5 });
  const k = kindsOf(pool, r.photoIds);
  assert.equal(k[k.length - 1], 'scenery');
});

test('picker: a forced repeat or a people photo on a tip slide is reported, not hidden', () => {
  const pool = [...many('people', 3, 1), ...many('working', 3, 10)];
  const r = pickPostPhotos({ pool, ...R, count: 6 });
  assert.equal(r.photoIds.length, 6);
  assert.ok(r.warnings.some((w) => /share a kind|people photo|photos on the tip slides/.test(w)), r.warnings.join(' | '));
});

test('picker: only photos available under the rest rule, never retired ones', () => {
  const pool = [
    ...many('people', 1, 1, { status: 'resting', lastUsedPostSeq: 45, opener: true }),
    ...many('people', 1, 5, { status: 'retired', opener: true }),
    ...many('working', 6, 10),
  ];
  const r = pickPostPhotos({ pool, ...R, count: 5 });
  assert.ok(r.photoIds.every((id) => id.startsWith('working')));
  const later = pickPostPhotos({ pool, nextSeq: 54, restPosts: 8, count: 5 });
  assert.equal(later.photoIds[0], 'people-1');
});

test('picker: tiny pools return what exists and say so; count 0 is empty', () => {
  const two = [photo('a', { uploadedAt: day(1) }), photo('b', { kind: 'event', uploadedAt: day(2) })];
  const r = pickPostPhotos({ pool: two, ...R, count: 5 });
  assert.equal(r.photoIds.length, 2);
  assert.ok(r.warnings.some((w) => /pool too narrow: 2 photos are available and the post needs 5/.test(w)));
  assert.deepEqual(pickPostPhotos({ pool: [], ...R, count: 5 }).photoIds, []);
  assert.deepEqual(pickPostPhotos({ pool: two, ...R, count: 0 }).photoIds, []);
});

test('picker: does not mutate its input and is deterministic', () => {
  const pool = [...many('people', 2, 1), ...many('working', 6, 1), ...many('scenery', 2, 10)];
  const copy = JSON.stringify(pool);
  const a = pickPostPhotos({ pool, ...R, count: 5 });
  assert.equal(JSON.stringify(pool), copy);
  assert.deepEqual(pickPostPhotos({ pool, ...R, count: 5 }), a);
});

test('pool check: a run needs a people photo and 5 ready photos before anything is paid for', () => {
  assert.equal(checkPhotoPool({ pool: [...many('people', 1), ...many('working', 4)], ...R }).ok, true);
  const noFaces = checkPhotoPool({ pool: many('working', 8), ...R });
  assert.equal(noFaces.ok, false);
  assert.match(!noFaces.ok ? noFaces.message : '', /Faces/);
  assert.equal(checkPhotoPool({ pool: [...many('people', 1), ...many('working', 2)], ...R }).ok, false);
});

test('replacement: a different available photo, honouring neighbours, the opener rule and the exclude list', () => {
  const pool = [...many('working', 8, 1), ...many('scenery', 3, 20), ...many('people', 3, 30, { opener: true })];
  const first = pickPostPhotos({ pool, ...R, count: 5 });
  const chosen = first.photoIds;
  const k = kindsOf(pool, chosen);
  // A middle slide: new id, not in the post, kind differs from both neighbours.
  const mid = pickReplacement({ pool, ...R, chosen, index: 2, exclude: [chosen[2]!] })!;
  assert.ok(mid && !chosen.includes(mid.photoId));
  const mk = pool.find((p) => p.photoId === mid.photoId)!.kind;
  assert.notEqual(mk, k[1]);
  assert.notEqual(mk, k[3]);
  // The first slide stays lively: a starred opener when one is left.
  const open = pickReplacement({ pool, ...R, chosen, index: 0, exclude: [chosen[0]!] })!;
  assert.equal(pool.find((p) => p.photoId === open.photoId)!.opener, true);
  // Excluded ids never come back, even if they are the best fit.
  const best = pickReplacement({ pool, ...R, chosen, index: 4, exclude: [chosen[4]!] })!;
  const again = pickReplacement({ pool, ...R, chosen, index: 4, exclude: [chosen[4]!, best.photoId] })!;
  assert.notEqual(again.photoId, best.photoId);
  assert.notEqual(again.photoId, chosen[4]);
  // Nothing left: null.
  const small = [photo('x'), photo('y')];
  assert.equal(pickReplacement({ pool: small, ...R, chosen: ['x', 'y'], index: 1, exclude: [] }), null);
  assert.equal(pickReplacement({ pool: [...small, photo('z')], ...R, chosen: ['x', 'y'], index: 1, exclude: ['z'] }), null);
});

test('replacement: a resting or retired photo is never offered', () => {
  const pool = [photo('a'), photo('b'), photo('c', { status: 'resting', lastUsedPostSeq: 49 }), photo('d', { status: 'retired' }), photo('e', { uploadedAt: day(1) })];
  const r = pickReplacement({ pool, ...R, chosen: ['a', 'b'], index: 1, exclude: ['b'] })!;
  assert.equal(r.photoId, 'e');
});

test('variety summary: counts per kind over live photos and the two warnings', () => {
  const none = poolVariety([]);
  assert.deepEqual(none.warnings, []);
  const laptops = poolVariety(many('working', 5));
  assert.equal(laptops.counts.working, 5);
  assert.equal(laptops.warnings.length, 2);
  const ok = poolVariety([...many('working', 5), photo('s', { kind: 'scenery', opener: true }), photo('s2', { kind: 'scenery' }), photo('p', { kind: 'people' }), photo('rest', { kind: 'event', status: 'resting', lastUsedPostSeq: 1 })]);
  assert.deepEqual(ok.counts, { working: 5, scenery: 2, people: 1, event: 0 });
  assert.equal(ok.openers, 1);
  assert.deepEqual(ok.warnings, []);
  assert.equal(poolVariety([...many('working', 5), photo('s', { kind: 'scenery', opener: true })]).warnings.length, 2);
  // Faces are tagged (with the opener) automatically, so an unstarred Faces photo is no longer a warning.
  assert.deepEqual(poolVariety([...many('working', 2), photo('s', { kind: 'scenery' }), photo('e', { kind: 'event' }), photo('p', { kind: 'people' })]).warnings, []);
  assert.ok(poolVariety(many('working', 3)).warnings.some((w) => /found automatically/.test(w)));
});

test('store and schema: the kind and opener columns exist with their CHECK, the migration runs twice, tags round-trip', async () => {
  const { db, bucket } = await setup();
  // Applying the schema again changes nothing and does not fail.
  const pg2 = new PGlite();
  await pg2.exec(schemaSql('media_library_schema.sql'));
  await pg2.exec(schemaSql('field_notes_schema.sql'));
  await pg2.exec(schemaSql('field_notes_schema.sql'));
  const cols = (await pg2.query(`SELECT column_name, column_default, is_nullable FROM information_schema.columns WHERE table_schema='field_notes' AND table_name='pool' AND column_name IN ('kind','opener') ORDER BY column_name`)).rows as any[];
  assert.deepEqual(cols.map((c) => [c.column_name, c.is_nullable]), [['kind', 'NO'], ['opener', 'NO']]);
  assert.match(cols[0].column_default, /'working'/);
  const checks = (await pg2.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'field_notes_pool_kind_check'`)).rows as any[];
  assert.equal(checks[0].n, 1);

  const r = await ingestPhoto({ db, bucket }, { bytes: await picture(40), mime: 'image/jpeg', uploadedBy: 'tommy', kind: 'people', opener: true });
  if (r.kind !== 'stored') throw new Error('not stored');
  assert.deepEqual((await listPool(db)).map((p) => [p.kind, p.opener]), [['people', true]]);
  assert.equal(await setPhotoTags(db, r.photoId, { kind: 'event' }), true);
  assert.deepEqual((await listPool(db)).map((p) => [p.kind, p.opener]), [['event', true]]);
  assert.equal(await setPhotoTags(db, r.photoId, { opener: false }), true);
  assert.deepEqual((await listPool(db)).map((p) => [p.kind, p.opener]), [['event', false]]);
  assert.equal(await setPhotoTags(db, '00000000-0000-4000-8000-000000000000', { kind: 'event' }), false);
  await assert.rejects(() => setPhotoTags(db, r.photoId, {}), /nothing/);
  // The database itself refuses an unknown kind.
  await assert.rejects(async () => { await db(`UPDATE field_notes.pool SET kind = 'selfie'`); });
});

// ── direct-to-storage upload: sign, then finalize ───────────────────────────

const TOMMY = async () => ({ email: 'tommy@heliosmarketing.org' });
const NOBODY = async () => null;
const UUID = '0b6f1c2e-3d4a-4e5f-8a9b-0c1d2e3f4a5b';
const INCOMING = `incoming/field-notes/${UUID}`;

/** A stub storage client: a map of objects, no network. */
function incomingStore(initial: Record<string, Buffer> = {}) {
  const objects = new Map(Object.entries(initial));
  const removed: string[] = [];
  return {
    objects,
    removed,
    download: async (p: string) => {
      const b = objects.get(p);
      if (!b) throw new Error('Download failed (404)');
      return b;
    },
    remove: async (paths: string[]) => {
      for (const p of paths) {
        removed.push(p);
        objects.delete(p);
      }
    },
  };
}

async function finalizeEnv(initial: Record<string, Buffer> = {}, detectFaces?: DetectFacePhoto) {
  const { db, bucket } = await setup();
  const store = incomingStore(initial);
  const env: FinalizeEnv = { session: TOMMY, download: store.download, remove: store.remove, ingest: (u) => ingestPhoto({ db, bucket, detectFaces }, u) };
  return { db, bucket, store, env };
}

const signEnv = (over: Partial<SignEnv> = {}): SignEnv => ({
  session: TOMMY,
  newId: () => UUID,
  sign: async (p) => ({ uploadUrl: `https://storage.test/upload/sign/photo-bank/${p}?token=t`, token: 't' }),
  ...over,
});

test('sign: a signed URL for incoming/field-notes/<uuid>; no session is 401; bad type and oversize are refused before any URL', async () => {
  const ok = await signUploadRoute(signEnv(), { name: 'IMG_1.HEIC', type: '', size: 5_000_000 });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.path, INCOMING);
  assert.match(body.uploadUrl, /photo-bank/);
  assert.equal(body.token, 't');
  assert.ok(INCOMING_PATH.test(body.path));

  assert.equal((await signUploadRoute(signEnv({ session: NOBODY }), { name: 'a.jpg', type: 'image/jpeg', size: 10 })).status, 401);
  const pdf = await signUploadRoute(signEnv(), { name: 'n.pdf', type: 'application/pdf', size: 10 });
  assert.equal(pdf.status, 415);
  const big = await signUploadRoute(signEnv(), { name: 'big.jpg', type: 'image/jpeg', size: MAX_UPLOAD_BYTES + 1 });
  assert.equal(big.status, 413);
  assert.deepEqual(await big.json(), { kind: 'too_large', reason: OVERSIZE_MESSAGE });
  // 25 MB itself is allowed.
  assert.equal((await signUploadRoute(signEnv(), { name: 'edge.jpg', type: 'image/jpeg', size: MAX_UPLOAD_BYTES })).status, 200);
});

test('sign: a storage failure is a typed failure, not a thrown error', async () => {
  const res = await signUploadRoute(signEnv({ sign: async () => { throw new Error('storage down'); } }), { name: 'a.jpg', type: 'image/jpeg', size: 10 });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { kind: 'failed', reason: 'storage down' });
});

test('finalize: downloads, stores for the logged-in user, tags a detected face as Faces with the opener, and removes the incoming object', async () => {
  const seen: number[] = [];
  const { db, store, bucket, env } = await finalizeEnv({ [INCOMING]: await picture(21) }, async (jpeg) => { seen.push(jpeg.byteLength); return { face: true, reason: 'stub face' }; });
  const res = await finalizeUploadRoute(env, { path: INCOMING, name: 'IMG_1.jpg', kind: 'event' });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.kind, 'stored');
  assert.equal(json.photoKind, 'people');
  assert.deepEqual(json.faces, { checked: true, tagged: true, reason: 'stub face' });
  assert.equal(seen.length, 1, 'the detector saw the converted JPEG once');
  const pool = await listPool(db);
  assert.equal(pool.length, 1);
  assert.equal(pool[0]!.uploadedBy, 'tommy@heliosmarketing.org');
  assert.equal(pool[0]!.kind, 'people');
  assert.equal(pool[0]!.opener, true);
  assert.deepEqual(store.removed, [INCOMING]);
  assert.equal(store.objects.size, 0);
  assert.ok(bucket.objects.size >= 2, 'master and thumb are stored');
});

test('finalize: location is stripped from the stored copies and the row keeps time and camera', async () => {
  const { bucket, env } = await finalizeEnv({ [INCOMING]: await withLocation() });
  const json = await (await finalizeUploadRoute(env, { path: INCOMING, name: 'gps.jpg', kind: 'scenery' })).json();
  assert.equal(json.kind, 'stored');
  assert.equal(json.exif.camera, 'Apple iPhone 15 Pro');
  const sharp = (await import('sharp')).default;
  for (const { body } of bucket.objects.values()) assert.equal((await sharp(body).metadata()).exif, undefined);
});

test('finalize: exact and near duplicates are a 200 with the match, and the incoming object is still removed', async () => {
  const second = `incoming/field-notes/${UUID.replace('0b6f', '1c7a')}`;
  const third = `incoming/field-notes/${UUID.replace('0b6f', '2d8b')}`;
  const bytes = await picture(22);
  const { store, env } = await finalizeEnv({ [INCOMING]: bytes, [second]: bytes, [third]: await picture(22, { width: 48, height: 36 }) });
  const first = await (await finalizeUploadRoute(env, { path: INCOMING, name: 'a.jpg', kind: 'working' })).json();
  const exact = await (await finalizeUploadRoute(env, { path: second, name: 'b.jpg', kind: 'working' })).json();
  assert.deepEqual(exact, { kind: 'duplicate_exact', matchId: first.photoId, distance: 0 });
  const near = await (await finalizeUploadRoute(env, { path: third, name: 'c.jpg', kind: 'working' })).json();
  assert.equal(near.kind, 'duplicate_near');
  assert.equal(near.matchId, first.photoId);
  assert.deepEqual(store.removed, [INCOMING, second, third]);
});

test('finalize: the type of an uploaded object is read from its content first, then its name', async () => {
  const jpeg = await picture(23);
  assert.equal(sniffMime(jpeg, 'whatever'), 'image/jpeg');
  assert.equal(sniffMime(Buffer.from('....ftypheic....'), 'x'), 'image/heic');
  assert.equal(sniffMime(Buffer.from('not an image'), 'x.png'), 'image/png');
  assert.equal(sniffMime(Buffer.from('not an image'), 'x.gif'), null);
});

test('finalize: no session, a path that is not an incoming upload, or no kind are refused and nothing is read', async () => {
  const { store, env } = await finalizeEnv({ [INCOMING]: await picture(24), 'masters/x': Buffer.from('keep') });
  assert.equal((await finalizeUploadRoute({ ...env, session: NOBODY }, { path: INCOMING, name: 'a.jpg', kind: 'working' })).status, 401);
  for (const bad of ['masters/x', `${INCOMING}/../x`, 'incoming/field-notes/not-a-uuid', '', undefined]) {
    assert.equal((await finalizeUploadRoute(env, { path: bad, name: 'a.jpg', kind: 'working' })).status, 400);
  }
  assert.equal((await finalizeUploadRoute(env, { path: INCOMING, name: 'a.jpg', kind: 'faces' })).status, 400);
  // Faces are never picked by the uploader: the face check decides.
  assert.equal((await finalizeUploadRoute(env, { path: INCOMING, name: 'a.jpg', kind: 'people' })).status, 400);
  assert.deepEqual(store.removed, []);
  assert.ok(store.objects.has('masters/x'));
});

test('finalize: an object that never arrived, an empty file, a non-image and an oversize object each fail with a reason and clean up', async () => {
  const empty = `incoming/field-notes/${UUID.replace('0b6f', '3e9c')}`;
  const junk = `incoming/field-notes/${UUID.replace('0b6f', '4fad')}`;
  const huge = `incoming/field-notes/${UUID.replace('0b6f', '5abe')}`;
  const missing = `incoming/field-notes/${UUID.replace('0b6f', '6bcf')}`;
  const { store, env } = await finalizeEnv({ [empty]: Buffer.alloc(0), [junk]: Buffer.from('not an image at all'), [huge]: Buffer.alloc(MAX_UPLOAD_BYTES + 1) });
  const gone = await finalizeUploadRoute(env, { path: missing, name: 'a.jpg', kind: 'working' });
  assert.equal(gone.status, 404);
  assert.equal((await gone.json()).kind, 'failed');
  assert.equal((await finalizeUploadRoute(env, { path: empty, name: 'a.jpg', kind: 'working' })).status, 415);
  const bad = await finalizeUploadRoute(env, { path: junk, name: 'fake.jpg', kind: 'working' });
  assert.ok(bad.status === 415 || bad.status === 500);
  assert.ok(String((await bad.json()).reason).length > 0);
  const big = await finalizeUploadRoute(env, { path: huge, name: 'big.jpg', kind: 'working' });
  assert.equal(big.status, 413);
  assert.deepEqual(store.removed.sort(), [empty, junk, huge, missing].sort());
});

test('finalize: a bucket failure while storing is a typed failure and the incoming object is still removed', async () => {
  const db = await openDb();
  const store = incomingStore({ [INCOMING]: await picture(25) });
  const env: FinalizeEnv = { session: TOMMY, download: store.download, remove: store.remove, ingest: (u) => ingestPhoto({ db, bucket: memoryBucket({ fail: true }) }, u) };
  const res = await finalizeUploadRoute(env, { path: INCOMING, name: 'a.jpg', kind: 'working' });
  assert.equal(res.status, 500);
  assert.equal((await res.json()).kind, 'failed');
  assert.deepEqual(store.removed, [INCOMING]);
  assert.equal((await listPool(db)).length, 0);
});

test('the box limit is 25 MB and says so; a file over it fails before anything is sent', () => {
  assert.equal(MAX_UPLOAD_BYTES, 25_000_000);
  assert.match(OVERSIZE_MESSAGE, /25 MB/);
  assert.equal(precheck({ name: 'a.heic', type: 'image/heic', size: 20_000_000 }), null);
  assert.equal(precheck({ name: 'a.heic', type: 'image/heic', size: MAX_UPLOAD_BYTES + 1 }), OVERSIZE_MESSAGE);
});

test('the box sends one file at a time, reports queued/uploading/processing/done/duplicate/failed, and keeps going after a failure', async () => {
  const file = (name: string, type = 'image/jpeg', size = 10) => new File([new Uint8Array(size)], name, { type });
  const items = [
    file('a.jpg'),
    file('b.jpg'),
    file('big.jpg', 'image/jpeg', MAX_UPLOAD_BYTES + 1),
    file('c.pdf', 'application/pdf'),
    file('d.jpg'),
    file('e.jpg'),
  ].map((f) => ({ file: f, kind: 'scenery' as const }));
  const order: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const send: SendFile = async (f, tags, onStage) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    order.push(`${f.name}:${tags.kind}`);
    onStage('uploading');
    await new Promise((r) => setTimeout(r, 1));
    onStage('processing');
    inFlight--;
    if (f.name === 'b.jpg') throw new Error('network down');
    if (f.name === 'd.jpg') return { status: 200, json: { kind: 'duplicate_exact', matchId: 'm1', distance: 0 } };
    return { status: 200, json: { kind: 'stored', photoId: 'p-' + f.name } };
  };
  const events: string[] = [];
  const out = await uploadFiles(items, send, (i, o) => events.push(`${i}:${o.state}`), (i, stage) => events.push(`${i}:${stage}`));
  assert.equal(maxInFlight, 1);
  assert.deepEqual(order, ['a.jpg:scenery', 'b.jpg:scenery', 'd.jpg:scenery', 'e.jpg:scenery']);
  assert.deepEqual(out.map((o) => o.state), ['done', 'failed', 'failed', 'failed', 'duplicate', 'done']);
  assert.equal((out[1] as { reason: string }).reason, 'network down');
  assert.equal((out[2] as { reason: string }).reason, OVERSIZE_MESSAGE);
  assert.match((out[3] as { reason: string }).reason, /HEIC, HEIF, JPEG, PNG or WebP/);
  assert.match((out[4] as { reason: string }).reason, /Exact duplicate/);
  assert.deepEqual(events.slice(0, 3), ['0:uploading', '0:processing', '0:done']);
});

test('the upload box says every photo may be posted, and `people` is shown as Faces while still stored as people', () => {
  assert.match(POSTING_NOTICE, /may be posted/);
  assert.equal(PHOTO_KIND_LABEL.people, 'Faces');
  assert.equal(FACES_AUTO_LABEL, 'Faces (auto)');
  // The uploader picks working, scenery or event; Faces is never a choice and there is no star at upload.
  assert.deepEqual([...UPLOAD_KINDS], ['working', 'scenery', 'event']);
  const box = readFileSync(path.join(process.cwd(), 'components/field-notes/UploadBox.tsx'), 'utf8');
  assert.match(box, /UPLOAD_KINDS\.map/);
  assert.doesNotMatch(box, /PHOTO_KINDS|Opener|Star/);
  assert.deepEqual(Object.keys(PHOTO_KIND_LABEL).sort(), [...PHOTO_KINDS].sort());
  for (const label of Object.values(PHOTO_KIND_LABEL)) assert.doesNotMatch(label, /people/i);
  const ui = readFileSync(path.join(process.cwd(), 'components/field-notes/UploadBox.tsx'), 'utf8') + readFileSync(path.join(process.cwd(), 'components/field-notes/PoolGrid.tsx'), 'utf8');
  assert.doesNotMatch(ui, /[^_]KIND_LABEL/);
  assert.doesNotMatch(ui, />\s*People\s*</);
});

// ── automatic Faces tagging (lib/field-notes/photos/faces.ts) ──────────────

/** A frontal face: box in 0-1 of the photo, eyes, nose and mouth where a face looking at the camera has them. */
function faceHit(o: { x?: number; y?: number; w?: number; score?: number; yaw?: number } = {}): FaceHit {
  const x = o.x ?? 0.4, y = o.y ?? 0.3, w = o.w ?? 0.2, h = w * (4 / 3);
  const cx = x + w / 2;
  const span = w * 0.4;
  return {
    score: o.score ?? 0.95, x, y, w, h,
    keypoints: [
      { x: cx - span / 2, y: y + h * 0.35 }, { x: cx + span / 2, y: y + h * 0.35 },
      { x: cx + (o.yaw ?? 0) * span, y: y + h * 0.55 }, { x: cx, y: y + h * 0.75 },
      { x: x + 0.01, y: y + h * 0.4 }, { x: x + w - 0.01, y: y + h * 0.4 },
    ],
  };
}

/** The confirmation passes a real face would get: the same face found straight and mirrored on its crop. */
function confirmedAnalysis(face: FaceHit, o: { direct?: number; mirrored?: number } = {}): FaceAnalysis {
  const width = 1000, height = 750;
  const side = FACE_RULES.cropScale * Math.max(face.w * width, face.h * height);
  const crop = { x: (face.x + face.w / 2) - side / width / 2, y: (face.y + face.h / 2) - side / height / 2, w: side / width, h: side / height };
  const inCrop = { x: (face.x - crop.x) / crop.w, y: (face.y - crop.y) / crop.h, w: face.w / crop.w, h: face.h / crop.h };
  const hit = (score: number, mirrored: boolean): FaceHit => ({ score, ...inCrop, x: mirrored ? 1 - inCrop.x - inCrop.w : inCrop.x, keypoints: [] });
  return { width, height, faces: [face], checks: [{ face: 0, crop, direct: o.direct === 0 ? [] : [hit(o.direct ?? 0.9, false)], mirrored: o.mirrored === 0 ? [] : [hit(o.mirrored ?? 0.9, true)] }] };
}

test('faces: a large, frontal, confirmed face is a face photo', () => {
  const v = decideFacePhoto(confirmedAnalysis(faceHit()));
  assert.equal(v.face, true, v.reason);
  assert.ok(v.box && v.score === 0.95);
});

test('faces: every gate on its own turns a face photo into "not a face photo" (precision first)', () => {
  const no = (a: FaceAnalysis, why: RegExp) => {
    const v = decideFacePhoto(a);
    assert.equal(v.face, false);
    assert.match(v.reason, why);
  };
  no({ width: 1000, height: 750, faces: [], checks: [] }, /no face found/);
  no(confirmedAnalysis(faceHit({ score: 0.8 })), /score 0.80 below 0.85/);
  // A distant face: 3% of the short side.
  no(confirmedAnalysis(faceHit({ w: 0.0225 })), /below 6%/);
  // A small face (a full-body shot) needs a higher score.
  no(confirmedAnalysis(faceHit({ w: 0.06, score: 0.88 })), /small face .* below 0.9/);
  assert.equal(decideFacePhoto(confirmedAnalysis(faceHit({ w: 0.06, score: 0.92 }))).face, true);
  // Turned away: the nose far off the eyes' midpoint.
  no(confirmedAnalysis(faceHit({ yaw: 0.45 })), /turned away/);
  // Not found again on the crop, or only straight and not mirrored.
  no(confirmedAnalysis(faceHit(), { direct: 0 }), /not confirmed on the crop/);
  no(confirmedAnalysis(faceHit(), { mirrored: 0.6 }), /not confirmed on the mirrored crop/);
  no({ ...confirmedAnalysis(faceHit()), checks: [] }, /no confirmation pass/);
  // Landmarks missing or outside the box.
  no(confirmedAnalysis({ ...faceHit(), keypoints: [] }), /landmarks missing/);
  const f = faceHit();
  no(confirmedAnalysis({ ...f, keypoints: f.keypoints.map((k, i) => (i === 3 ? { x: k.x, y: 0.99 } : k)) }), /outside the face box/);
});

test('faces: the reason names the furthest gate any face reached, and one passing face is enough', () => {
  const pass = confirmedAnalysis(faceHit());
  const weak = faceHit({ x: 0.05, score: 0.5 });
  const withWeak: FaceAnalysis = { ...pass, faces: [weak, pass.faces[0]!], checks: [{ ...pass.checks[0]!, face: 1 }] };
  assert.equal(decideFacePhoto(withWeak).face, true);
  assert.equal(iou({ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 1, h: 1 }), 1);
  assert.equal(iou({ x: 0, y: 0, w: 1, h: 1 }, { x: 2, y: 2, w: 1, h: 1 }), 0);
});

test('ingest with a face check: a detected face becomes people with the opener; anything else keeps the uploader kind', async () => {
  const { db, bucket } = await setup();
  const yes: DetectFacePhoto = async () => ({ face: true, reason: 'stub face' });
  const no: DetectFacePhoto = async () => ({ face: false, reason: 'no face found' });
  const down: DetectFacePhoto = async () => ({ face: false, unavailable: true, reason: 'face detector unavailable: no browser' });
  const broken: DetectFacePhoto = async () => { throw new Error('boom'); };
  const tagged = await ingestPhoto({ db, bucket, detectFaces: yes }, { bytes: await picture(60), mime: 'image/jpeg', uploadedBy: 'tommy', kind: 'scenery' });
  const plain = await ingestPhoto({ db, bucket, detectFaces: no }, { bytes: await picture(61), mime: 'image/jpeg', uploadedBy: 'tommy', kind: 'scenery', opener: true });
  // An uploader's `people` is not trusted when the detector says no: it becomes working, never a cover.
  const claimed = await ingestPhoto({ db, bucket, detectFaces: no }, { bytes: await picture(62), mime: 'image/jpeg', uploadedBy: 'tommy', kind: 'people', opener: true });
  const unavailable = await ingestPhoto({ db, bucket, detectFaces: down }, { bytes: await picture(63), mime: 'image/jpeg', uploadedBy: 'tommy', kind: 'event' });
  const threw = await ingestPhoto({ db, bucket, detectFaces: broken }, { bytes: await picture(64), mime: 'image/jpeg', uploadedBy: 'tommy', kind: 'working' });
  const results = [tagged, plain, claimed, unavailable, threw];
  assert.ok(results.every((r) => r.kind === 'stored'));
  const s = results as Extract<typeof tagged, { kind: 'stored' }>[];
  assert.deepEqual(s.map((r) => [r.photoKind, r.faces.checked, r.faces.tagged]), [['people', true, true], ['scenery', true, false], ['working', true, false], ['event', false, false], ['working', false, false]]);
  assert.match(s[4]!.faces.reason, /boom/);
  const pool = new Map((await listPool(db)).map((p) => [p.photoId, [p.kind, p.opener]]));
  assert.deepEqual(s.map((r) => pool.get(r.photoId)), [['people', true], ['scenery', false], ['working', false], ['event', false], ['working', false]]);
});

test('ingest: a duplicate is refused before the face check runs', async () => {
  const { db, bucket } = await setup();
  let calls = 0;
  const count: DetectFacePhoto = async () => { calls++; return { face: false, reason: 'x' }; };
  const bytes = await picture(65);
  await ingestPhoto({ db, bucket, detectFaces: count }, { bytes, mime: 'image/jpeg', uploadedBy: 'tommy', kind: 'working' });
  await ingestPhoto({ db, bucket, detectFaces: count }, { bytes, mime: 'image/jpeg', uploadedBy: 'tommy', kind: 'working' });
  await ingestPhoto({ db, bucket, detectFaces: count }, { bytes: await picture(65, { width: 48, height: 36 }), mime: 'image/jpeg', uploadedBy: 'tommy', kind: 'working' });
  assert.equal(calls, 1);
});

test('the upload row says when a photo was tagged Faces (auto), and when the face check could not run', () => {
  const stored = { kind: 'stored', photoId: 'p1' };
  const face = outcomeOf('a.jpg', 200, { ...stored, photoKind: 'people', faces: { checked: true, tagged: true, reason: 'r' } });
  assert.equal(face.state === 'done' && face.faces, true);
  assert.match(face.state === 'done' ? face.note : '', /Faces \(auto\)/);
  const off = outcomeOf('b.jpg', 200, { ...stored, photoKind: 'working', faces: { checked: false, tagged: false, reason: 'r' } });
  assert.match(off.state === 'done' ? off.note : '', /could not run/);
  const plain = outcomeOf('c.jpg', 200, { ...stored, photoKind: 'scenery', faces: { checked: true, tagged: false, reason: 'r' } });
  assert.equal(plain.state === 'done' ? plain.note : '', 'Done: added to the pool.');
});

test('faces: the real MediaPipe check loads offline and tags no synthetic photo (pattern, cartoon, noise)', async () => {
  const { chromium } = await import('playwright');
  const sharp = (await import('sharp')).default;
  const browser = await chromium.launch();
  try {
    const detect = createFacePhotoDetector(browser);
    const smiley = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="100%" height="100%" fill="#dde"/><circle cx="400" cy="300" r="200" fill="#fc0"/><circle cx="330" cy="250" r="28"/><circle cx="470" cy="250" r="28"/><path d="M300 370 Q400 450 500 370" stroke="#000" stroke-width="16" fill="none"/></svg>')).jpeg().toBuffer();
    const noise = Buffer.alloc(320 * 240 * 3);
    for (let i = 0, s = 7; i < noise.length; i++) noise[i] = (s = (s * 1103515245 + 12345) >>> 0) >>> 24;
    const noisy = await sharp(noise, { raw: { width: 320, height: 240, channels: 3 } }).jpeg().toBuffer();
    for (const img of [await picture(70, { width: 960, height: 720 }), smiley, noisy]) {
      const v = await detect(img);
      assert.equal(v.face, false, v.reason);
      assert.notEqual(v.unavailable, true);
    }
    await detect.close();
  } finally {
    await browser.close();
  }
});

// ── face check on the worker (lib/field-notes/photos/faces-worker.ts) ───────

/** A db plus a bucket that can also be read back (the worker downloads masters). */
async function workerSetup() {
  const { db, bucket } = await setup();
  const download = async (p: string) => {
    const o = bucket.objects.get(p);
    if (!o) throw new Error(`no object ${p}`);
    return o.body;
  };
  /** A new upload the way the finalize route stores it on Vercel: deferred, no detector. */
  const upload = async (seed: number, kind: 'working' | 'scenery' | 'event' = 'scenery') => {
    const r = await ingestPhoto({ db, bucket, deferFaces: true }, { bytes: await picture(seed), mime: 'image/jpeg', uploadedBy: 'tommy', kind });
    if (r.kind !== 'stored') throw new Error('not stored');
    return r;
  };
  const row = async (id: string) =>
    (await db(`SELECT kind, opener, faces_result, faces_checked_at, faces_attempts, faces_claimed_at FROM field_notes.pool WHERE photo_id = $1::uuid`, [id])).rows[0] as {
      kind: string; opener: boolean; faces_result: string | null; faces_checked_at: Date | null; faces_attempts: number; faces_claimed_at: Date | null;
    };
  return { db, bucket, download, upload, row };
}

/** A detector session that answers by photo (keyed by the bytes it is handed) and counts what it saw. */
function stubSession(answer: (jpeg: Buffer) => Promise<FaceVerdictLike> | FaceVerdictLike) {
  const seen: Buffer[] = [];
  let opened = 0;
  let closed = 0;
  return {
    seen,
    get opened() { return opened; },
    get closed() { return closed; },
    open: async () => {
      opened++;
      return { detect: (async (jpeg: Buffer) => { seen.push(jpeg); return answer(jpeg); }) as DetectFacePhoto, close: async () => { closed++; } };
    },
  };
}
type FaceVerdictLike = Awaited<ReturnType<DetectFacePhoto>>;

test('finalize on Vercel stores the photo unchecked with the uploader kind, and runs no detector', async () => {
  const { db, bucket } = await setup();
  const store = incomingStore({ [INCOMING]: await picture(80) });
  let calls = 0;
  // The route's wiring: deferFaces always, a detector only with FIELD_NOTES_FACES_INLINE=1 (off by default).
  const detectFaces = facesInline({}) ? (async () => { calls++; return { face: true, reason: 'x' }; }) : undefined;
  const env: FinalizeEnv = { session: TOMMY, download: store.download, remove: store.remove, ingest: (u) => ingestPhoto({ db, bucket, deferFaces: true, detectFaces }, u) };
  const json = await (await finalizeUploadRoute(env, { path: INCOMING, name: 'IMG_9.jpg', kind: 'event' })).json();
  assert.equal(json.kind, 'stored');
  assert.equal(json.photoKind, 'event');
  assert.equal(json.faces.pending, true);
  assert.equal(json.faces.checked, false);
  assert.equal(calls, 0, 'no detector ran');
  const r = (await db(`SELECT kind, opener, faces_result, faces_checked_at FROM field_notes.pool`)).rows[0];
  assert.deepEqual([r.kind, r.opener, r.faces_result, r.faces_checked_at], ['event', false, 'pending', null]);
  assert.equal((await listPool(db))[0]!.facesCheck, 'pending');
  // The row in the box says faces come shortly after.
  const outcome = outcomeOf('IMG_9.jpg', 200, json);
  assert.match(outcome.state === 'done' ? outcome.note : '', /Faces are checked shortly after upload/);
});

test('the inline face check is opt-in for local dev only: FIELD_NOTES_FACES_INLINE=1', () => {
  assert.equal(facesInline({}), false);
  assert.equal(facesInline({ FIELD_NOTES_FACES_INLINE: '0' }), false);
  assert.equal(facesInline({ FIELD_NOTES_FACES_INLINE: '1' }), true);
  const route = readFileSync(path.join(process.cwd(), 'app/api/field-notes/photos/finalize/route.ts'), 'utf8');
  assert.match(route, /deferFaces: true, detectFaces: facesInline\(\) \? detectFacePhotoLive : undefined/);
});

test('inline (local dev): a checked photo is stored checked; a check that cannot run leaves it pending for the worker', async () => {
  const { db, bucket } = await setup();
  const yes = await ingestPhoto({ db, bucket, deferFaces: true, detectFaces: async () => ({ face: true, reason: 'stub' }) }, { bytes: await picture(81), mime: 'image/jpeg', uploadedBy: 't', kind: 'working' });
  const down = await ingestPhoto({ db, bucket, deferFaces: true, detectFaces: async () => ({ face: false, unavailable: true, reason: 'no browser' }) }, { bytes: await picture(82), mime: 'image/jpeg', uploadedBy: 't', kind: 'working' });
  if (yes.kind !== 'stored' || down.kind !== 'stored') throw new Error('not stored');
  const rows = new Map((await db(`SELECT photo_id::text AS id, kind, faces_result, faces_checked_at IS NOT NULL AS checked FROM field_notes.pool`)).rows.map((r) => [r.id, [r.kind, r.faces_result, r.checked]]));
  assert.deepEqual(rows.get(yes.photoId), ['people', 'faces', true]);
  assert.deepEqual(rows.get(down.photoId), ['working', 'pending', false]);
});

test('worker step: a face photo becomes Faces (auto) with the opener, a non-face photo keeps its kind, both are marked checked', async () => {
  const { db, download, upload, row } = await workerSetup();
  const face = await upload(83, 'scenery');
  const plain = await upload(84, 'event');
  const faceMaster = await download(masterPath(face.sha256));
  const s = stubSession(async (jpeg) => (jpeg.equals(faceMaster) ? { face: true, reason: 'stub face' } : { face: false, reason: 'no face found' }));
  const out = await runFacesStep({ db, download, openDetector: s.open });
  assert.deepEqual([out.claimed, out.faces, out.none, out.unavailable, out.retrying], [2, 1, 1, 0, 0]);
  assert.equal(s.opened, 1, 'one shared detector for the batch');
  assert.equal(s.closed, 1, 'and it is closed after');
  const f = await row(face.photoId);
  const p = await row(plain.photoId);
  assert.deepEqual([f.kind, f.opener, f.faces_result], ['people', true, 'faces']);
  assert.deepEqual([p.kind, p.opener, p.faces_result], ['event', false, 'none']);
  assert.ok(f.faces_checked_at && p.faces_checked_at);
  assert.equal(f.faces_claimed_at, null);
  const pool = new Map((await listPool(db)).map((x) => [x.photoId, x.facesCheck]));
  assert.deepEqual([pool.get(face.photoId), pool.get(plain.photoId)], ['faces', 'none']);
  // Nothing left: the next poll claims nothing and opens no browser.
  const again = await runFacesStep({ db, download, openDetector: s.open });
  assert.equal(again.claimed, 0);
  assert.equal(s.opened, 1);
});

test('worker step: a detector failure is retried once, then marked unavailable and keeps its kind (never retried forever)', async () => {
  const { db, download, upload, row } = await workerSetup();
  const a = await upload(85, 'working');
  const down = stubSession(async () => ({ face: false, unavailable: true, reason: 'face detector unavailable: no browser' }));
  const first = await runFacesStep({ db, download, openDetector: down.open });
  assert.deepEqual([first.claimed, first.retrying, first.unavailable], [1, 1, 0]);
  let r = await row(a.photoId);
  assert.deepEqual([r.faces_result, r.faces_checked_at, r.faces_attempts, r.faces_claimed_at], ['pending', null, 1, null]);
  const second = await runFacesStep({ db, download, openDetector: down.open });
  assert.deepEqual([second.claimed, second.retrying, second.unavailable], [1, 0, 1]);
  r = await row(a.photoId);
  assert.match(String(r.faces_result), /^unavailable: face detector unavailable: no browser \(after 2 tries\)$/);
  assert.ok(r.faces_checked_at);
  assert.deepEqual([r.kind, r.opener], ['working', false]);
  assert.equal((await listPool(db))[0]!.facesCheck, 'unavailable');
  assert.equal((await runFacesStep({ db, download, openDetector: down.open })).claimed, 0, 'no third try');

  // No browser at all (the open throws) is the same path; a master that cannot be read too.
  const b = await upload(86, 'scenery');
  const broken = async () => { throw new Error('chromium missing'); };
  await runFacesStep({ db, download, openDetector: broken });
  await runFacesStep({ db, download, openDetector: broken });
  assert.match(String((await row(b.photoId)).faces_result), /^unavailable: face detector unavailable: chromium missing/);
  const c = await upload(87, 'scenery');
  const ok = stubSession(async () => ({ face: true, reason: 'x' }));
  const noFile = async () => { throw new Error('404'); };
  await runFacesStep({ db, download: noFile, openDetector: ok.open });
  await runFacesStep({ db, download: noFile, openDetector: ok.open });
  const cr = await row(c.photoId);
  assert.match(String(cr.faces_result), /^unavailable: master not readable: 404/);
  assert.equal(cr.kind, 'scenery');
  assert.equal(ok.seen.length, 0);
});

test('worker step: a thrown detector stops the batch; the photos after it go back untried', async () => {
  const { db, download, upload, row } = await workerSetup();
  const ids = [(await upload(88)).photoId, (await upload(89)).photoId, (await upload(90)).photoId];
  const crash = stubSession(async () => { throw new Error('page crashed'); });
  const out = await runFacesStep({ db, download, openDetector: crash.open });
  assert.deepEqual([out.claimed, out.retrying, out.released], [3, 1, 2]);
  assert.equal(crash.seen.length, 1);
  assert.equal(crash.closed, 1);
  const attempts = await Promise.all(ids.map(async (id) => (await row(id)).faces_attempts));
  assert.deepEqual(attempts.sort(), [0, 0, 1]);
});

test('worker step: never touches a checked row or a row from before the face check, and skips a live lease', async () => {
  const { db, bucket, download, upload, row } = await workerSetup();
  // An older pool photo (no face-check columns set): stays as its uploader tagged it, never claimed (Rule 2).
  const legacy = await ingestPhoto({ db, bucket }, { bytes: await picture(91), mime: 'image/jpeg', uploadedBy: 'lead', kind: 'working' });
  if (legacy.kind !== 'stored') throw new Error('not stored');
  // A checked row, even one that still reads 'pending' by mistake once checked_at is set.
  const checked = await upload(92);
  await db(`UPDATE field_notes.pool SET faces_result = 'none', faces_checked_at = now() WHERE photo_id = $1::uuid`, [checked.photoId]);
  const odd = await upload(93);
  await db(`UPDATE field_notes.pool SET faces_checked_at = now() WHERE photo_id = $1::uuid`, [odd.photoId]);
  // Another worker holds this one right now.
  const leased = await upload(94);
  await db(`UPDATE field_notes.pool SET faces_claimed_at = now() - interval '1 minute', faces_attempts = 1 WHERE photo_id = $1::uuid`, [leased.photoId]);
  // A retired pending photo is not checked.
  const retired = await upload(95);
  await retirePhoto(db, retired.photoId, 'stranger');
  const before = (await db(`SELECT photo_id::text AS id, kind, opener, faces_result, faces_checked_at, faces_attempts FROM field_notes.pool ORDER BY photo_id`)).rows;
  const yes = stubSession(async () => ({ face: true, reason: 'x' }));
  const out = await runFacesStep({ db, download, openDetector: yes.open });
  assert.equal(out.claimed, 0);
  assert.equal(yes.opened, 0, 'no browser when nothing is pending');
  const after = (await db(`SELECT photo_id::text AS id, kind, opener, faces_result, faces_checked_at, faces_attempts FROM field_notes.pool ORDER BY photo_id`)).rows;
  assert.deepEqual(after, before);
  assert.equal((await row(legacy.photoId)).faces_result, null);
  assert.equal((await listPool(db)).find((p) => p.photoId === legacy.photoId)!.facesCheck, null);

  // A lease older than FACES_LEASE_MINUTES belongs to a dead worker: claimed again; out of tries, it is given up.
  await db(`UPDATE field_notes.pool SET faces_claimed_at = now() - make_interval(mins => $2::int), faces_attempts = $3 WHERE photo_id = $1::uuid`, [leased.photoId, FACES_LEASE_MINUTES + 1, FACES_MAX_ATTEMPTS]);
  const late = await runFacesStep({ db, download, openDetector: yes.open });
  assert.deepEqual([late.claimed, late.unavailable], [1, 1]);
  assert.equal(yes.opened, 0, 'a photo out of tries opens no browser');
  assert.match(String((await row(leased.photoId)).faces_result), /gave up/);
});

test('worker step: two concurrent steps never check the same photo', async () => {
  const { db, download, upload, row } = await workerSetup();
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) ids.push((await upload(100 + i)).photoId);
  const checkedBytes: string[] = [];
  const slow = () => stubSession(async (jpeg) => {
    await new Promise((r) => setTimeout(r, 5));
    checkedBytes.push(jpeg.toString('base64'));
    return { face: false, reason: 'no face found' };
  });
  const [s1, s2] = [slow(), slow()];
  const [a, b] = await Promise.all([
    runFacesStep({ db, download, openDetector: s1.open, limit: 3 }),
    runFacesStep({ db, download, openDetector: s2.open, limit: 3 }),
  ]);
  assert.equal(a.claimed + b.claimed, 5);
  assert.ok(a.claimed > 0 && b.claimed > 0, 'both steps ran a batch');
  assert.equal(new Set(checkedBytes).size, checkedBytes.length, 'no photo checked twice');
  assert.equal(checkedBytes.length, 5);
  for (const id of ids) {
    const r = await row(id);
    assert.equal(r.faces_result, 'none');
    assert.equal(r.faces_attempts, 1);
  }
  // The claim is one statement with FOR UPDATE SKIP LOCKED (so two worker processes skip each other's rows too).
  const src = readFileSync(path.join(process.cwd(), 'lib/field-notes/photos/faces-worker.ts'), 'utf8');
  assert.match(src, /FOR UPDATE SKIP LOCKED/);
});

test('picker: an unchecked photo is never the cover; only a checked Faces photo counts as people', async () => {
  const { db, bucket, upload } = await workerSetup();
  const face = await ingestPhoto({ db, bucket, deferFaces: true, detectFaces: async () => ({ face: true, reason: 'stub' }) }, { bytes: await picture(110), mime: 'image/jpeg', uploadedBy: 't', kind: 'working' });
  if (face.kind !== 'stored') throw new Error('not stored');
  await new Promise((r) => setTimeout(r, 5));
  for (let i = 0; i < 5; i++) await upload(111 + i, i % 2 ? 'scenery' : 'working');
  const pool = await listPool(db);
  assert.equal(pool.filter((p) => p.facesCheck === 'pending').length, 5);
  assert.ok(pool.filter((p) => p.facesCheck === 'pending').every((p) => p.kind !== 'people'));
  const pick = pickPostPhotos({ pool, nextSeq: 1, restPosts: 8, count: 5 });
  assert.equal(pick.photoIds[0], face.photoId, 'the checked Faces photo is the cover, not a newer unchecked one');
  // With only unchecked photos there is no people photo: the pool check stops the run before anything is paid for.
  const onlyPending = pool.filter((p) => p.facesCheck === 'pending');
  assert.equal(checkPhotoPool({ pool: onlyPending, nextSeq: 1, restPosts: 8 }).ok, false);
  assert.ok(pickPostPhotos({ pool: onlyPending, nextSeq: 1, restPosts: 8, count: 5 }).warnings.some((w) => /no people photo was available/.test(w)));
});

test('schema: the face-check columns exist, the migration applies twice, and the result CHECK refuses junk', async () => {
  const pg = new PGlite();
  await pg.exec(schemaSql('media_library_schema.sql'));
  await pg.exec(schemaSql('field_notes_schema.sql'));
  await pg.exec(schemaSql('field_notes_schema.sql'));
  const cols = (await pg.query(`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='field_notes' AND table_name='pool' AND column_name LIKE 'faces_%' ORDER BY column_name`)).rows as any[];
  assert.deepEqual(cols.map((c) => [c.column_name, c.data_type, c.is_nullable]), [
    ['faces_attempts', 'integer', 'NO'],
    ['faces_checked_at', 'timestamp with time zone', 'YES'],
    ['faces_claimed_at', 'timestamp with time zone', 'YES'],
    ['faces_result', 'text', 'YES'],
  ]);
  assert.equal(cols.find((c) => c.column_name === 'faces_checked_at').column_default, null, 'no default: existing rows stay NULL (no backfill)');
  assert.equal(cols.find((c) => c.column_name === 'faces_result').column_default, null);
  const n = (await pg.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'field_notes_pool_faces_result_check'`)).rows as any[];
  assert.equal(n[0].n, 1);
  const photo = (await pg.query(`INSERT INTO media_library.photos (sha256, master_path, thumb_path, mime, bytes, width, height, credit, licence, reuse_ok) VALUES (repeat('a', 64), 'm', 't', 'image/jpeg', 1, 1, 1, 'c', 'own', false) RETURNING id`)).rows as any[];
  await pg.query(`INSERT INTO field_notes.pool (photo_id, uploaded_by) VALUES ($1, 'x')`, [photo[0].id]);
  // A row inserted without the face columns is never queued: NULL result, NULL checked_at, 0 attempts.
  const fresh = (await pg.query(`SELECT faces_result, faces_checked_at, faces_attempts FROM field_notes.pool`)).rows as any[];
  assert.deepEqual([fresh[0].faces_result, fresh[0].faces_checked_at, fresh[0].faces_attempts], [null, null, 0]);
  await assert.rejects(() => pg.query(`UPDATE field_notes.pool SET faces_result = 'maybe'`));
  await pg.query(`UPDATE field_notes.pool SET faces_result = 'unavailable: no browser'`);
});

test('picker: the Follow photo is reserved before the tip slides, scenery then event then working', () => {
  // One scenery photo only: it goes to Follow, not to a tip slide.
  const pool = [photo('face', { kind: 'people', uploadedAt: day(1) }), ...many('working', 6, 2), photo('calm', { kind: 'scenery', uploadedAt: day(40) })];
  const r = pickPostPhotos({ pool, ...R, count: 7 });
  assert.equal(r.photoIds.at(-1), 'calm');
  assert.equal(r.photoIds.length, 7);
  // No scenery: an event photo beats a working one, and a working Follow is warned about.
  const ev = [photo('face', { kind: 'people', uploadedAt: day(1) }), ...many('working', 6, 2), photo('party', { kind: 'event', uploadedAt: day(3) })];
  assert.equal(pickPostPhotos({ pool: ev, ...R, count: 7 }).photoIds.at(-1), 'party');
  const work = pickPostPhotos({ pool: [photo('face', { kind: 'people', uploadedAt: day(1) }), ...many('working', 6, 2)], ...R, count: 5 });
  assert.ok(work.warnings.some((w) => /Follow slide uses a working photo/.test(w)));
});

test('picker: the cover prefers a tagger-confirmed face photo and never takes one the tagger refuted', () => {
  const pool = [
    ...many('scenery', 3, 2), ...many('working', 3, 10),
    { ...photo('star-unchecked', { kind: 'people', opener: true, uploadedAt: day(30) }) },
    { ...photo('confirmed', { kind: 'people', uploadedAt: day(5) }), facesCheck: 'faces' },
    { ...photo('refuted', { kind: 'people', opener: true, uploadedAt: day(40) }), facesCheck: 'none' },
  ] as PoolPhoto[];
  const r = pickPostPhotos({ pool, ...R, count: 5 });
  assert.equal(r.photoIds[0], 'confirmed');
  assert.ok(!r.warnings.some((w) => /not confirmed by the face tagger/.test(w)));
  const noConfirmed = pickPostPhotos({ pool: pool.filter((p) => p.photoId !== 'confirmed'), ...R, count: 5 });
  assert.equal(noConfirmed.photoIds[0], 'star-unchecked');
  assert.ok(noConfirmed.warnings.some((w) => /not confirmed by the face tagger/.test(w)));
});

test('CI-32: a team photo published in the last 20 days (by its bank key or its dHash) is skipped; the rest rule still holds', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 10, 1, h)).toISOString();
  const p = (id: string, kind: PhotoKind, h: number, o: Partial<PoolPhoto> = {}): PoolPhoto => ({ photoId: id, uploadedBy: 't', uploadedAt: at(h), status: 'live', lastUsedPostSeq: null, rejectReason: null, kind, opener: false, ...o });
  const pool = [p('face-new', 'people', 9), p('face-old', 'people', 1), p('w1', 'working', 8), p('w2', 'working', 7), p('s1', 'scenery', 6), p('e1', 'event', 5), p('rest', 'scenery', 4, { status: 'resting', lastUsedPostSeq: 19 })];
  const ledger = { urls: new Set([mediaLibraryKey('face-new')]), phashes: [], dhashes: ['f0f0f0f0f0f0f0f0'] };
  const published = publishedPhotoIds(pool, ledger, new Map([['w1', 'f0f0f0f0f0f0f0f1'], ['w2', '0f0f0f0f0f0f0f0f']]));
  assert.deepEqual([...published].sort(), ['face-new', 'w1'], 'by key and by a near dHash');
  const pick = pickPostPhotos({ pool, nextSeq: 20, restPosts: 8, count: 5, published });
  assert.equal(pick.photoIds[0], 'face-old', 'the newest Faces photo was published, so the next one opens');
  for (const id of ['face-new', 'w1', 'rest']) assert.ok(!pick.photoIds.includes(id), id);
  // Too few left: today's shortage behaviour (fewer photos, a plain warning).
  const short = pickPostPhotos({ pool, nextSeq: 20, restPosts: 8, count: 6, published });
  assert.equal(short.photoIds.length, 4);
  assert.ok(short.warnings.some((w) => /pool too narrow/.test(w)));
});
