/**
 * Bald-Eagle D3, the photo hold (lib/photos/pending.ts folded into lib/photos/used.ts), offline with a stubbed
 * database: a photo chosen by another item that is built but not yet posted is held; an item's own photos don't
 * block it (excludeItem); brand assets stay exempt; the 20-day published rule reads and answers as before.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { PENDING_ITEMS_SQL, PENDING_UNDATED_DAYS, pendingCandidate, pendingHold, pendingPhotos, pendingPhotoUrls, waitingItemsOn } from '@/lib/photos/pending';
import { mediaLibraryKey, readPublishedLedger, readUsedLedger, usedMatch, USED_PHOTO_DAYS } from '@/lib/photos/used';
import { ledgerFrom, usedReason } from '@/lib/photos/used-guard';
import { recentPhotoUses, recentUsedPhotoUrls } from '@/lib/stories/sources/carousel';
import { photoLedgerUrl } from '@/lib/stories/render/types';

const NOW = new Date('2026-11-12T08:00:00Z');
const BUILT = '2026-11-11T08:00:00Z';
const PHASH = 'a1b2c3d4e5f60718';
const DHASH = 'f0f0f0f0f0f0f0f0';

/** Waiting items as the pending read returns them: one per type that carries photos. */
const PENDING_ROWS = [
  {
    vertical: 'stories',
    id: 'set-1',
    built_at: BUILT,
    doc: {
      series: 'morning_download',
      frames: [
        { seq: 1, role: 'opener', photo: { src: 'https://img.test/newspapers.jpg', kind: 'thematic' } },
        { seq: 2, role: 'story', photo: { src: 'https://img.test/ceo.jpg', kind: 'person' } },
        { seq: 3, role: 'story', photo: { src: 'https://img.test/stories-logo.png', kind: 'logo' } },
      ],
    },
  },
  {
    vertical: 'carousels',
    id: 'post-1',
    built_at: BUILT,
    idea: 'https://news.test/story-1',
    doc: { render: { slides: [{ photoUrl: 'https://img.test/carousel.jpg', photoKind: 'scene', position: 0 }, { photoUrl: 'https://img.test/wordmark.png', photoKind: 'logo', position: 1 }] } },
  },
  {
    vertical: 'lfd',
    id: 'lfd-1',
    built_at: BUILT,
    doc: { stories: [{ photo: { src: 'https://img.test/lfd.jpg', kind: 'scene' } }, { photo: { src: 'https://img.test/meme.jpg', kind: 'meme' } }], render: { slides: [] } },
  },
  { vertical: 'field_notes', id: 'fn-1', built_at: BUILT, doc: { photo_ids: ['p-team'], bank: [{ id: 'p-team', dhash: DHASH }] } },
  {
    vertical: 'reel_ai_drama',
    id: 'job-1',
    built_at: BUILT,
    doc: {
      uses: [
        { asset_key: PHASH, character_image: false, data: { url: 'https://img.test/drama.jpg', kind: 'photo' } },
        { asset_key: 'https://img.test/cutout.png', character_image: true, data: {} },
        { asset_key: 'https://img.test/drama-logo.png', character_image: false, data: { flags: ['logo'] } },
      ],
    },
  },
];

type Call = { text: string; params: unknown[] };

/** The hub database, stubbed: the published-photo read returns `published`, the waiting-items read `pending`. */
function stubDb(o: { published?: Array<{ url: string; phash?: string | null; dhash?: string | null }>; pending?: unknown[] | Error } = {}) {
  const calls: Call[] = [];
  const query = async (text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    if (text === PENDING_ITEMS_SQL) {
      if (o.pending instanceof Error) throw o.pending;
      return { rows: o.pending ?? [] };
    }
    if (text.includes('FROM social.used_photos')) return { rows: o.published ?? [] };
    throw new Error(`unexpected query: ${text.slice(0, 60)}`);
  };
  return { query, calls };
}

test('a photo chosen by another waiting item is held, for every type that carries photos, with the keys the ledger uses', async () => {
  const { query } = stubDb({ pending: PENDING_ROWS });
  const l = await readUsedLedger(query as never, NOW);
  for (const url of ['https://img.test/newspapers.jpg', 'https://img.test/ceo.jpg', 'https://img.test/carousel.jpg', 'https://img.test/lfd.jpg', 'https://img.test/drama.jpg', mediaLibraryKey('p-team')]) {
    assert.ok(l.urls.has(url), `${url} is held`);
  }
  assert.deepEqual(l.phashes, [PHASH], 'an AI Drama asset is held by its pHash too');
  assert.deepEqual(l.dhashes, [DHASH], 'a Field Notes team photo is held by its bank dHash too (as its own rest rule keys it)');
  assert.equal(usedMatch(l, { url: 'https://img.test/newspapers.jpg' }), 'chosen by an item waiting to post (same URL)');
  assert.match(usedMatch(l, { dhash: DHASH })!, /same picture/);
  assert.equal(await usedReason(l, { url: 'https://img.test/ceo.jpg' }), 'chosen by an item waiting to post (same URL)', 'the guard every finder uses refuses it');
});

test('brand assets stay exempt: logos, meme templates and character cutouts are never held', async () => {
  const { query } = stubDb({ pending: PENDING_ROWS });
  const l = await readUsedLedger(query as never, NOW);
  for (const url of ['https://img.test/stories-logo.png', 'https://img.test/wordmark.png', 'https://img.test/meme.jpg', 'https://img.test/cutout.png', 'https://img.test/drama-logo.png']) {
    assert.ok(!l.urls.has(url), `${url} is a brand asset`);
  }
  // A logo pick is exempt even where a waiting item holds the same URL.
  assert.equal(await usedReason(l, { url: 'https://img.test/carousel.jpg', kind: 'logo' }), null);
});

test("excludeItem: an item's own photos don't block it; everyone else's still do; the hub's type name works too", async () => {
  const { query } = stubDb({ pending: PENDING_ROWS });
  const own = await readUsedLedger(query as never, NOW, undefined, { excludeItem: { vertical: 'stories', id: 'set-1' } });
  assert.ok(!own.urls.has('https://img.test/newspapers.jpg') && !own.urls.has('https://img.test/ceo.jpg'), 'the set being rebuilt keeps its own photos');
  assert.ok(own.urls.has('https://img.test/carousel.jpg') && own.urls.has('https://img.test/lfd.jpg'), 'other items still hold theirs');
  const lfd = await pendingPhotoUrls(query as never, NOW, { excludeItem: { vertical: 'last_few_days', id: 'lfd-1' } });
  assert.ok(!lfd.has('https://img.test/lfd.jpg'));
  assert.ok(lfd.has('https://img.test/newspapers.jpg'));
  // Another set with the same id in another type is not excluded.
  const other = await pendingPhotoUrls(query as never, NOW, { excludeItem: { vertical: 'carousels', id: 'set-1' } });
  assert.ok(other.has('https://img.test/newspapers.jpg'));
});

test('the shared readers carry the hold and excludeItem without caller changes (ledgerFrom, recentUsedPhotoUrls, recentPhotoUses)', async () => {
  const { query } = stubDb({ pending: PENDING_ROWS });
  const viaGuard = await ledgerFrom(query as never, () => NOW)();
  assert.ok(viaGuard.urls.has('https://img.test/newspapers.jpg'));
  const viaGuardOwn = await ledgerFrom(query as never, () => NOW, { excludeItem: { vertical: 'stories', id: 'set-1' } })();
  assert.ok(!viaGuardOwn.urls.has('https://img.test/newspapers.jpg'));
  const db = { query: async (text: string, params?: unknown[]) => query(text, params) } as never;
  assert.ok((await recentUsedPhotoUrls(db, NOW)).has('https://img.test/carousel.jpg'));
  assert.ok(!(await recentUsedPhotoUrls(db, NOW, USED_PHOTO_DAYS, { excludeItem: { vertical: 'carousels', id: 'post-1' } })).has('https://img.test/carousel.jpg'));
  const uses = await recentPhotoUses(db, NOW);
  assert.deepEqual([...(uses.get('https://img.test/ceo.jpg') ?? [])], ['stories:set-1']);
});

test('the published 20-day rule is unchanged: same read, same window, same answer; nothing waiting adds nothing', async () => {
  const published = [{ url: 'https://img.test/published.jpg', phash: null, dhash: DHASH }, { url: 'https://img.test/published-2.jpg', phash: PHASH, dhash: null }];
  const { query, calls } = stubDb({ published, pending: [] });
  const l = await readUsedLedger(query as never, NOW);
  assert.deepEqual(l, await readPublishedLedger(query as never, NOW), 'with nothing waiting, the ledger is exactly the published one');
  assert.deepEqual([[...l.urls], l.phashes, l.dhashes], [['https://img.test/published.jpg', 'https://img.test/published-2.jpg'], [PHASH], [DHASH]]);
  assert.equal(l.pendingUrls, undefined);
  assert.equal(usedMatch(l, { url: 'https://img.test/published.jpg' }), `published in the last ${USED_PHOTO_DAYS} days (same URL)`);
  assert.match(calls[0]!.text, /FROM social\.used_photos/, 'the published read comes first');
  assert.deepEqual(calls[0]!.params, [NOW.toISOString(), USED_PHOTO_DAYS]);
  assert.deepEqual(calls[1]!.params, [NOW.toISOString(), PENDING_UNDATED_DAYS], 'the waiting items: posting day not passed (undated: built in the last 3 days)');
  // A caller's own window applies to the published half; a shorter one caps the undated half too.
  const { query: q2, calls: c2 } = stubDb({ published, pending: [] });
  await readUsedLedger(q2 as never, NOW, 7);
  assert.deepEqual(c2.map((c) => c.params[1]), [7, PENDING_UNDATED_DAYS]);
  const { query: q3, calls: c3 } = stubDb({ published, pending: [] });
  await readUsedLedger(q3 as never, NOW, 0);
  assert.equal(c3.length, 1, 'a rule turned off (0 days) reads no waiting items');
});

test('published and waiting together: both held, the published reason wins for a URL in both', async () => {
  const { query } = stubDb({ published: [{ url: 'https://img.test/newspapers.jpg' }], pending: PENDING_ROWS });
  const l = await readUsedLedger(query as never, NOW);
  assert.equal(usedMatch(l, { url: 'https://img.test/newspapers.jpg' }), `published in the last ${USED_PHOTO_DAYS} days (same URL)`);
  assert.equal(usedMatch(l, { url: 'https://img.test/ceo.jpg' }), 'chosen by an item waiting to post (same URL)');
  assert.equal(usedMatch(l, { url: 'https://img.test/fresh.jpg' }), null);
});

test('a waiting-items read that fails holds nothing extra and never fails the ledger; a published-read failure still throws', async () => {
  const missing = Object.assign(new Error('relation "stories.sets" does not exist'), { code: '42P01' });
  const { query } = stubDb({ published: [{ url: 'https://img.test/published.jpg' }], pending: missing });
  const l = await readUsedLedger(query as never, NOW);
  assert.deepEqual([...l.urls], ['https://img.test/published.jpg']);
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (m: string) => warned.push(m);
  try {
    const { query: q2 } = stubDb({ pending: new Error('timeout') });
    assert.equal((await pendingPhotos(q2 as never, NOW)).urls.size, 0);
  } finally {
    console.warn = warn;
  }
  assert.match(warned[0]!, /only published photos are held/);
  await assert.rejects(readUsedLedger((async () => { throw Object.assign(new Error('down'), { code: '08006' }); }) as never, NOW), /down/);
});

test('the waiting-items read: every type by its own waiting status, the hub’s deletes, rejections and publishes left out', () => {
  assert.match(PENDING_ITEMS_SQL, /s\.status IN \('ready', 'approved', 'scheduled', 'publishing'\) AND s\.series <> 'free_vs_paid'/);
  assert.match(PENDING_ITEMS_SQL, /p\.status = 'review' AND p\.origin = 'pipeline'/, 'Carousels: pipeline posts in review (dev posts never)');
  assert.match(PENDING_ITEMS_SQL, /FROM lfd\.posts p, win\s+WHERE p\.status = 'review'/);
  assert.match(PENDING_ITEMS_SQL, /FROM field_notes\.posts p, win\s+WHERE p\.status = 'review'/);
  assert.match(PENDING_ITEMS_SQL, /j\.status = 'ok'/);
  assert.doesNotMatch(PENDING_ITEMS_SQL, /ai_events\.posts/, 'AI Events is rebuilt in place, so its waiting posters are not held');
  assert.match(PENDING_ITEMS_SQL, /ci\.deleted_at IS NOT NULL OR ap\.decision = 'rejected'/);
  assert.match(PENDING_ITEMS_SQL, /sc\.status = 'published'/);
});

test('M2: recentPhotoUses labels a waiting photo by who holds it, so Morning Download keeps its own story’s carousel photo (S-29)', async () => {
  const { query } = stubDb({ published: [{ url: 'https://img.test/published.jpg' }], pending: PENDING_ROWS });
  const db = { query: async (text: string, params?: unknown[]) => query(text, params) } as never;
  const uses = await recentPhotoUses(db, NOW);
  assert.deepEqual([...uses.get('https://img.test/published.jpg')!], ['']);
  assert.deepEqual([...uses.get('https://img.test/carousel.jpg')!], ['https://news.test/story-1'], 'a carousel post: its news story id (the carousel candidate’s ref)');
  assert.deepEqual([...uses.get('https://img.test/newspapers.jpg')!], ['stories:set-1']);
  // Morning Download's rule (lib/stories/build/morning-download.ts): keep unless anyone other than the story itself holds it.
  const otherStory = (url: string, ref: string) => [...(uses.get(url) ?? [])].some((id) => id !== ref);
  assert.equal(otherStory('https://img.test/carousel.jpg', 'https://news.test/story-1'), false, 'its own carousel post holds it: kept');
  assert.equal(otherStory('https://img.test/carousel.jpg', 'https://news.test/story-2'), true, 'another story: not kept');
  assert.equal(otherStory('https://img.test/published.jpg', 'https://news.test/story-1'), true, 'published: never kept');
  assert.equal(otherStory('https://img.test/newspapers.jpg', 'https://news.test/story-1'), true, 'a waiting Stories set holds it: not kept');
});

// ── S3 on the real schemas (PGlite): only items whose posting day hasn't passed hold photos ──

test('S3: stale items hold nothing; today’s and later ones do; undated Carousels posts for 3 days; deleted and published items never', async () => {
  const { readFileSync } = await import('node:fs');
  const { openHubTestDb } = await import('./fixtures/social-hub/pglite');
  const { pg, query } = await openHubTestDb();
  await pg.exec(readFileSync('db/reel_ai_drama_schema.sql', 'utf8').split('\n').filter((l) => !l.startsWith('\\')).join('\n'));
  const now = new Date('2026-11-12T15:00:00Z'); // 10 AM in New York: today is 2026-11-12
  let n = 0;
  const set = async (nyDate: string, status: string, url: string) => {
    const { rows } = await pg.query<{ id: string }>(
      `INSERT INTO stories.sets (series, ny_date, status, trigger, style, built_at, slot_minute) VALUES ('morning_download', $1, $2, 'auto', 'polished', $3, $4) RETURNING id::text AS id`,
      [nyDate, status, '2026-11-10T08:00:00Z', Math.floor(Math.random() * 1000)],
    );
    await pg.query(`INSERT INTO stories.frames (set_id, seq, role, backdrop, copy, photo) VALUES ($1, 1, 'opener', 'black', '{}'::jsonb, $2::jsonb)`, [rows[0]!.id, JSON.stringify({ src: url, kind: 'thematic' })]);
    return rows[0]!.id;
  };
  await set('2026-11-10', 'ready', 'https://img.test/stale-set.jpg');
  await set('2026-11-12', 'ready', 'https://img.test/today-set.jpg');
  await set('2026-11-14', 'approved', 'https://img.test/cushion-set.jpg');
  await set('2026-11-13', 'rejected', 'https://img.test/rejected-set.jpg');
  const carousel = async (createdAt: string, url: string) => {
    const { rows } = await pg.query<{ id: string }>(
      `INSERT INTO social.posts (slug, title, story_id, status, origin, render, created_at) VALUES ($1, 't', $2, 'review', 'pipeline', $3::jsonb, $4) RETURNING id::text AS id`,
      [`c-${++n}`, `story-${url}`, JSON.stringify({ slides: [{ photoUrl: url, photoKind: 'scene', position: 0 }] }), createdAt],
    ).catch(async (err) => {
      throw new Error(`social.posts insert: ${err.message}`);
    });
    return rows[0]!.id;
  };
  await carousel('2026-11-11T07:00:00Z', 'https://img.test/fresh-carousel.jpg');
  await carousel('2026-11-05T07:00:00Z', 'https://img.test/old-carousel.jpg');
  const lfd = async (nyDate: string, url: string) => {
    const { rows } = await pg.query<{ id: string }>(
      `INSERT INTO lfd.posts (slug, ny_date, status, stories, render, caption, created_at) VALUES ($1, $2, 'review', $3::jsonb, '{"slides": []}'::jsonb, '', $2::date - interval '5 hours') RETURNING id::text AS id`,
      [`lfd-${++n}`, nyDate, JSON.stringify([{ photo: { src: url, kind: 'scene' } }])],
    );
    return rows[0]!.id;
  };
  await lfd('2026-11-11', 'https://img.test/yesterday-lfd.jpg');
  const todayLfd = await lfd('2026-11-12', 'https://img.test/today-lfd.jpg');
  const deletedLfd = await lfd('2026-11-12', 'https://img.test/deleted-lfd.jpg');
  await pg.query(`INSERT INTO social_hub.content_items (vertical, format, native_ref, deleted_at) VALUES ('last_few_days', 'feed', $1, now())`, [deletedLfd]);

  const publishedLfd = await lfd('2026-11-13', 'https://img.test/published-lfd.jpg');
  const { rows: ci } = await pg.query<{ id: string }>(`INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ('last_few_days', 'feed', $1) RETURNING id::text AS id`, [publishedLfd]);
  await pg.query(
    `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source) VALUES ($1, 'last_few_days', '2026-11-13', 'morning', '2026-11-13T14:30:00Z', 'published', 'auto')`,
    [ci[0]!.id],
  );

  const held = await pendingPhotoUrls(query as never, now);
  assert.deepEqual([...held].sort(), ['https://img.test/cushion-set.jpg', 'https://img.test/fresh-carousel.jpg', 'https://img.test/today-lfd.jpg', 'https://img.test/today-set.jpg']);

  // S4: a remake of today's Last Few Days excludes the day's waiting post(s).
  const today = await waitingItemsOn(query as never, 'lfd', '2026-11-12');
  assert.deepEqual(today.map((e) => e.id).sort(), [todayLfd, deletedLfd].sort());
  const remake = await pendingPhotoUrls(query as never, now, { excludeItem: today });
  assert.ok(!remake.has('https://img.test/today-lfd.jpg'));
  assert.ok(remake.has('https://img.test/today-set.jpg'));
  await pg.close();
});

test('SS-23: AI Trivia and Real or AI? sets are held under their own types; Real or AI? by stable storage key and original URL', async () => {
  assert.match(PENDING_ITEMS_SQL, /CASE WHEN s\.series IN \('ai_trivia', 'real_or_ai'\) THEN s\.series ELSE 'stories' END/);
  assert.match(PENDING_ITEMS_SQL, /i\.vertical IN \('ai_trivia', 'real_or_ai'\) AND ci\.vertical = 'stories'/);
  const signed = (token: string) => `https://proj.supabase.co/storage/v1/object/sign/stories/roa/candidates/abc.jpg?token=${token}`;
  const roa = pendingCandidate({
    vertical: 'real_or_ai', id: 'set-r', built_at: '2026-11-16T10:00:00Z',
    doc: {
      series: 'real_or_ai',
      frames: [{ seq: 1, role: 'roa_question', photo: { src: signed('a'), credit: '', kind: 'scene' } }, { seq: 2, role: 'roa_reveal', photo: { src: signed('b'), credit: '', kind: 'scene' } }],
      rounds: [{ key: 'roa:abc', truth: 'real', provenance: { kind: 'commons', url: 'https://commons.wikimedia.org/wiki/File:A.jpg', licence: 'CC BY 4.0', credit: 'A', src: 'https://upload.test/a.jpg' } }, { key: 'roa:def', truth: 'ai', provenance: { kind: 'generated', model: 'm', prompt: 'p', createdAt: 'x' } }],
    },
  })!;
  assert.equal(roa.vertical, 'real_or_ai');
  assert.deepEqual(roa.photos.map((p) => p.url), ['storage:stories/roa/candidates/abc.jpg', 'https://upload.test/a.jpg']);
  const trivia = pendingCandidate({ vertical: 'ai_trivia', id: 'set-t', built_at: '2026-11-16T10:00:00Z', doc: { series: 'ai_trivia', frames: [{ seq: 2, role: 'question', photo: { src: 'https://w/q.jpg', credit: 'Q', kind: 'scene' } }] } })!;
  assert.deepEqual([trivia.vertical, trivia.photos.map((p) => p.url)], ['ai_trivia', ['https://w/q.jpg']]);

  const query = async () => ({ rows: [{ vertical: 'ai_trivia', id: 'set-t', built_at: '2026-11-16T10:00:00Z', doc: { series: 'ai_trivia', frames: [{ seq: 2, role: 'question', photo: { src: 'https://w/q.jpg', credit: 'Q', kind: 'scene' } }] } }] });
  const hold = await pendingHold(query as never, new Date('2026-11-16T12:00:00Z'));
  assert.deepEqual(hold.owners.get('https://w/q.jpg'), [{ vertical: 'ai_trivia', id: 'set-t', idea: null }]);
  const skipped = await pendingHold(query as never, new Date('2026-11-16T12:00:00Z'), { excludeItem: { vertical: 'ai_trivia', id: 'set-t' } });
  assert.equal(skipped.urls.size, 0, 'a rebuild of its own set is not blocked');
});

test('WC12: a band-fitted Morning Download photo is held and recorded by its source URL, not its signed storage copy', async () => {
  const stored = 'https://proj.supabase.co/storage/v1/object/sign/stories/sets/set-b/photos/abc.jpg?token=t';
  const photo = { src: stored, sourceUrl: 'https://news.test/ceo.jpg', credit: 'Photo: Wire', kind: 'scene' as const, contained: true };
  const row = { vertical: 'stories', id: 'set-b', built_at: BUILT, doc: { series: 'morning_download', frames: [{ seq: 2, role: 'story', photo }, { seq: 3, role: 'story', photo: { src: 'https://img.test/plain.jpg', kind: 'scene' } }] } };
  assert.deepEqual(pendingCandidate(row)!.photos.map((p) => p.url), ['https://news.test/ceo.jpg', 'https://img.test/plain.jpg']);
  const hold = await pendingHold((async () => ({ rows: [row] })) as never, NOW);
  assert.deepEqual(hold.owners.get('https://news.test/ceo.jpg'), [{ vertical: 'stories', id: 'set-b', idea: null }]);
  assert.equal(hold.urls.has(stored), false);
  // What the worker records at publish (worker.ts recordPublishedPhoto): the source, else src.
  assert.equal(photoLedgerUrl(photo), 'https://news.test/ceo.jpg');
  assert.equal(photoLedgerUrl({ src: 'https://img.test/plain.jpg' }), 'https://img.test/plain.jpg');
});
