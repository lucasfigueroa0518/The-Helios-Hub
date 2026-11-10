import assert from 'node:assert/strict';
import test from 'node:test';

import type { IgMedia } from '@/lib/instagram/graph';
import { captionsMatch, normalizeCaption, syncPublishedPhotos, type IgSyncDeps } from '@/lib/photos/ig-sync';
import type { CandidatePost, PublishedPostAdapter } from '@/lib/photos/published-posts';
import type { Query } from '@/lib/social/store/pg';

const NOW = new Date('2026-11-10T04:45:00Z');
const DAY = 86_400_000;

/** A stub database: the ig_media_matches and used_photos statements the sync runs, kept in memory. */
type MatchRow = { media_id: string; how: string; vertical?: string | null; post_id?: string | null };
function fakeDb(o: { matches?: MatchRow[]; logged?: string[]; noMatchesTable?: boolean } = {}) {
  const matches = [...(o.matches ?? [])];
  const used: unknown[][] = [];
  const upserts: unknown[][] = [];
  const query: Query = async (text, params = []) => {
    if (o.noMatchesTable && text.includes('social.ig_media_matches')) throw Object.assign(new Error('relation "social.ig_media_matches" does not exist'), { code: '42P01' });
    if (text.startsWith('SELECT 1 FROM social.ig_media_matches')) return { rows: matches.length ? [{ '?column?': 1 }] : [] };
    if (text.startsWith('SELECT media_id, how FROM social.ig_media_matches')) {
      const ids = params[0] as string[];
      return { rows: matches.filter((m) => ids.includes(m.media_id)) };
    }
    if (text.startsWith('SELECT vertical, post_id FROM social.ig_media_matches')) return { rows: matches.filter((m) => m.post_id) };
    if (text.startsWith('SELECT 1 FROM social.used_photos')) return { rows: (o.logged ?? []).includes(params[0] as string) || used.some((u) => u[2] === params[0]) ? [{}] : [] };
    if (text.includes('INSERT INTO social.used_photos')) {
      used.push(params);
      return { rows: [] };
    }
    if (text.includes('INSERT INTO social.ig_media_matches')) {
      upserts.push(params);
      const row: MatchRow = { media_id: params[0] as string, vertical: params[3] as string | null, post_id: params[4] as string | null, how: params[5] as string };
      const at = matches.findIndex((m) => m.media_id === row.media_id);
      if (at >= 0) matches[at] = row;
      else matches.push(row);
      return { rows: [] };
    }
    throw new Error(`unexpected query: ${text.slice(0, 80)}`);
  };
  return { query, used, upserts, matches };
}

const media = (o: Partial<IgMedia> & { id: string }): IgMedia => ({
  surface: 'feed',
  timestamp: '2026-11-09T14:10:00Z',
  caption: null,
  mediaType: 'CAROUSEL_ALBUM',
  mediaUrl: null,
  thumbnailUrl: null,
  permalink: null,
  children: [],
  ...o,
});

const post = (o: Partial<CandidatePost> & { postId: string }): CandidatePost => ({
  vertical: 'carousels',
  caption: null,
  builtAt: new Date('2026-11-09T08:00:00Z'),
  coverRender: null,
  photos: [{ url: `https://img/${o.postId}.jpg`, slide: 2, credit: 'AP' }],
  ...o,
});

function adapter(vertical: CandidatePost['vertical'], o: { byId?: Record<string, CandidatePost>; pool?: CandidatePost[]; asked?: string[]; hang?: Set<string> }): PublishedPostAdapter {
  return {
    vertical,
    byMediaId: async (id) => {
      o.asked?.push(id);
      if (o.hang?.has(id)) return new Promise<never>(() => undefined);
      return o.byId?.[id] ?? null;
    },
    candidates: async () => o.pool ?? [],
  };
}

/** Hashes are the bytes' text, so a test names the pHash a URL "has". */
function deps(db: ReturnType<typeof fakeDb>, o: { feed: IgMedia[]; stories?: IgMedia[]; adapters: PublishedPostAdapter[]; bytes?: Record<string, string>; dryRun?: boolean; now?: Date }) {
  const since: Date[] = [];
  const lines: string[] = [];
  const read = async (ref: string) => {
    const b = o.bytes?.[ref];
    if (!b) throw new Error(`404 ${ref}`);
    return Buffer.from(b);
  };
  const d: IgSyncDeps = {
    query: db.query,
    listing: { feedMedia: async (s) => (since.push(s), o.feed), liveStories: async () => o.stories ?? [] },
    fetchBytes: read,
    download: (bucket, path) => read(`storage:${bucket}/${path}`),
    now: () => o.now ?? NOW,
    log: (line) => lines.push(line),
    adapters: o.adapters,
    hash: async (b) => ({ phash: b.toString(), dhash: `d${b.toString().slice(1)}` }),
    dryRun: o.dryRun,
  };
  return { d, since, lines };
}

test('a post our publish recorded matches by media id; its photos are logged at the Instagram time', async () => {
  const db = fakeDb({ matches: [{ media_id: 'old', how: 'caption', vertical: 'carousels', post_id: 'p0' }] });
  const p = post({ postId: 'p1' });
  const { d, since } = deps(db, { feed: [media({ id: 'm1' })], adapters: [adapter('carousels', { byId: { m1: p } })], bytes: { 'https://img/p1.jpg': 'aaaaaaaaaaaaaaaa' } });
  const r = await syncPublishedPhotos(d);
  assert.equal(since[0].getTime(), NOW.getTime() - 21 * DAY, 'every run lists the whole 20-day window, plus a day');
  assert.deepEqual(r.matched, { media_id: 1, caption: 0, image: 0 });
  assert.equal(r.photosLogged, 1);
  const [row] = db.used;
  assert.equal(row[0], 'https://img/p1.jpg');
  assert.equal(row[1], '2026-11-09T14:10:00.000Z');
  assert.equal(row[2], 'carousels:p1');
  assert.deepEqual(row.slice(9), ['carousels', 'm1', 'aaaaaaaaaaaaaaaa', 'daaaaaaaaaaaaaaa']);
  assert.deepEqual(db.upserts[0].slice(0, 7), ['m1', '2026-11-09T14:10:00Z', 'feed', 'carousels', 'p1', 'media_id', 1]);
});

test('an empty table reads 21 days back too', async () => {
  const db = fakeDb();
  const { d, since } = deps(db, { feed: [], adapters: [] });
  const r = await syncPublishedPhotos(d);
  assert.equal(r.lookbackDays, 21);
  assert.equal(since[0].getTime(), NOW.getTime() - 21 * DAY);
});

test('a post posted by hand matches by its caption (case, emoji and spacing aside)', async () => {
  const db = fakeDb();
  const a = post({ postId: 'a', vertical: 'lfd', caption: 'Do you realize what just happened in AI? ⬅️\n\nPhotos: AP, Reuters' });
  const b = post({ postId: 'b', vertical: 'lfd', caption: 'Do you realize what just happened in AI? ⬅️\n\nPhotos: Getty' });
  const { d } = deps(db, { feed: [media({ id: 'm2', caption: 'do you realize what just happened in AI?\nPhotos: AP,  Reuters' })], adapters: [adapter('lfd', { pool: [a, b] })], bytes: { 'https://img/a.jpg': '1111111111111111' } });
  const r = await syncPublishedPhotos(d);
  assert.deepEqual(r.matched, { media_id: 0, caption: 1, image: 0 });
  assert.equal(db.used[0][2], 'lfd:a');
});

test('two posts with the same caption are ambiguous: no match, nothing logged, retried later', async () => {
  const db = fakeDb();
  const same = 'The same caption on two different posts, long enough to count';
  const { d } = deps(db, { feed: [media({ id: 'm3', caption: same })], adapters: [adapter('carousels', { pool: [post({ postId: 'x', caption: same }), post({ postId: 'y', caption: same })] })] });
  const r = await syncPublishedPhotos(d);
  assert.equal(r.unmatched, 1);
  assert.equal(db.used.length, 0);
  assert.deepEqual(db.upserts[0].slice(3, 7), [null, null, 'none', 0]);
});

test('captions: short ones never match on their own, and a different post never matches', () => {
  assert.equal(captionsMatch(normalizeCaption('New post!'), normalizeCaption('New post!')), false);
  const ours = normalizeCaption('Anthropic shipped a new model this week and here is what it means for your team today.');
  assert.equal(captionsMatch(`${ours} ai tech`, ours), true);
  assert.equal(captionsMatch(normalizeCaption('Anthropic shipped a new model this week and here is what it means for your team tomorrow.'), ours), false);
});

test('without a media id or caption, the cover image matches within the near-duplicate distance', async () => {
  const db = fakeDb();
  const near = post({ postId: 'near', vertical: 'ai_events', coverRender: 'storage:social-slides/ae/slide-01.jpg' });
  const far = post({ postId: 'far', vertical: 'ai_events', coverRender: 'storage:social-slides/ae2/slide-01.jpg' });
  const m = media({ id: 'm4', children: [{ id: 'c1', mediaType: 'IMAGE', mediaUrl: 'https://cdn.ig/c1.jpg' }] });
  const { d } = deps(db, {
    feed: [m],
    adapters: [adapter('ai_events', { pool: [near, far] })],
    bytes: { 'https://cdn.ig/c1.jpg': '0000000000000000', 'storage:social-slides/ae/slide-01.jpg': '000000000000000f', 'storage:social-slides/ae2/slide-01.jpg': 'ffffffffffffffff', 'https://img/near.jpg': 'abababababababab' },
  });
  const r = await syncPublishedPhotos(d);
  assert.deepEqual(r.matched, { media_id: 0, caption: 0, image: 1 });
  assert.equal(db.used[0][2], 'ai_events:near');
});

test('two covers equally close are ambiguous: no image match', async () => {
  const db = fakeDb();
  const m = media({ id: 'm5', children: [{ id: 'c1', mediaType: 'IMAGE', mediaUrl: 'https://cdn.ig/c1.jpg' }] });
  const { d } = deps(db, {
    feed: [m],
    adapters: [adapter('carousels', { pool: [post({ postId: 'a', coverRender: 'storage:s/a.jpg' }), post({ postId: 'b', coverRender: 'storage:s/b.jpg' })] })],
    bytes: { 'https://cdn.ig/c1.jpg': '0000000000000000', 'storage:s/a.jpg': '0000000000000001', 'storage:s/b.jpg': '0000000000000003' },
  });
  const r = await syncPublishedPhotos(d);
  assert.equal(r.unmatched, 1);
  assert.equal(db.used.length, 0);
});

test('a post the ledger already holds is matched with 0 photos', async () => {
  const db = fakeDb({ logged: ['lfd:p9'] });
  const { d } = deps(db, { feed: [media({ id: 'm6' })], adapters: [adapter('lfd', { byId: { m6: post({ postId: 'p9', vertical: 'lfd' }) } })] });
  const r = await syncPublishedPhotos(d);
  assert.equal(r.alreadyLogged, 1);
  assert.equal(db.used.length, 0);
  assert.deepEqual(db.upserts[0].slice(5, 7), ['media_id', 0]);
});

test('a photo whose bytes cannot be read still logs a URL-only row', async () => {
  const db = fakeDb();
  const { d, lines } = deps(db, { feed: [media({ id: 'm7' })], adapters: [adapter('carousels', { byId: { m7: post({ postId: 'p7' }) } })] });
  const r = await syncPublishedPhotos(d);
  assert.equal(r.photosLogged, 1);
  assert.deepEqual(db.used[0].slice(0, 1).concat(db.used[0].slice(11)), ['https://img/p7.jpg', null, null]);
  assert.match(lines[0], /logged by URL only/);
});

test('a post matched on an earlier night is skipped; a dry run writes nothing', async () => {
  const db = fakeDb({ matches: [{ media_id: 'm8', how: 'media_id', vertical: 'carousels', post_id: 'p8' }] });
  const p = post({ postId: 'p10' });
  const { d } = deps(db, { feed: [media({ id: 'm8' }), media({ id: 'm9' })], adapters: [adapter('carousels', { byId: { m9: p } })], dryRun: true });
  const r = await syncPublishedPhotos(d);
  assert.equal(r.skipped, 1);
  assert.equal(r.matched.media_id, 1);
  assert.equal(r.matches[0].photos, 1);
  assert.equal(db.used.length + db.upserts.length, 0);
});

const frame = (id: string, at: string) => media({ id, surface: 'story', mediaType: 'IMAGE', mediaUrl: `https://cdn.ig/${id}.jpg`, timestamp: at });
const storySet = (id: string) => post({ postId: id, vertical: 'stories', coverRender: `storage:stories/sets/${id}/01.jpg`, frameRenders: [`storage:stories/sets/${id}/01.jpg`, `storage:stories/sets/${id}/02.jpg`] });

test('two live story frames posted within the hour that match one set (and no other) log that set once', async () => {
  const db = fakeDb();
  const { d } = deps(db, {
    feed: [],
    stories: [frame('s1', '2026-11-09T14:10:00Z'), frame('s2', '2026-11-09T14:12:00Z')],
    adapters: [adapter('stories', { pool: [storySet('set1'), storySet('set2')] }), adapter('carousels', { pool: [post({ postId: 'c', coverRender: 'storage:s/c.jpg' })] })],
    bytes: {
      'https://cdn.ig/s1.jpg': '1234123412341234', 'https://cdn.ig/s2.jpg': 'abcdabcdabcdabcd',
      'storage:stories/sets/set1/01.jpg': '1234123412341234', 'storage:stories/sets/set1/02.jpg': 'abcdabcdabcdabcd',
      'storage:stories/sets/set2/01.jpg': '9999999999999999', 'storage:stories/sets/set2/02.jpg': '7777777777777777',
      'storage:s/c.jpg': '1234123412341234',
    },
  });
  const r = await syncPublishedPhotos(d);
  assert.deepEqual(r.matched, { media_id: 0, caption: 0, image: 2 });
  assert.deepEqual([...new Set(db.used.map((u) => u[2]))], ['stories:set1']);
  assert.equal(db.used.length, 1, 'the set is logged once');
  assert.deepEqual(db.upserts.map((u) => [u[0], u[2], u[4]]), [['s2', 'story', 'set1'], ['s1', 'story', 'set1']]);
});

test('a story frame never matches a set by image alone, nor when another set matches too; by media id it does', async () => {
  const bytes = {
    'https://cdn.ig/s1.jpg': '1234123412341234', 'https://cdn.ig/s2.jpg': 'abcdabcdabcdabcd', 'https://cdn.ig/s3.jpg': '1234123412341234',
    'storage:stories/sets/set1/01.jpg': '1234123412341234', 'storage:stories/sets/set1/02.jpg': 'abcdabcdabcdabcd',
    'storage:stories/sets/set2/01.jpg': '1234123412341234', 'storage:stories/sets/set2/02.jpg': '7777777777777777',
  };
  // One frame alone: it could be any set's.
  const lone = fakeDb();
  const one = await syncPublishedPhotos(deps(lone, { feed: [], stories: [frame('s2', '2026-11-09T14:12:00Z')], adapters: [adapter('stories', { pool: [storySet('set1'), storySet('set2')] })], bytes }).d);
  assert.equal(one.unmatched, 1);
  assert.equal(lone.used.length, 0);
  // Two frames, but the first also matches another set (set2's cover): neither matches.
  const both = fakeDb();
  const two = await syncPublishedPhotos(deps(both, { feed: [], stories: [frame('s1', '2026-11-09T14:10:00Z'), frame('s2', '2026-11-09T14:12:00Z')], adapters: [adapter('stories', { pool: [storySet('set1'), storySet('set2')] })], bytes }).d);
  assert.equal(two.unmatched, 2);
  assert.equal(both.used.length, 0);
  // Two frames that match one set, but more than an hour apart: neither matches.
  const apart = fakeDb();
  const far = await syncPublishedPhotos(deps(apart, { feed: [], stories: [frame('s2', '2026-11-09T14:12:00Z'), frame('s3', '2026-11-09T16:00:00Z')], adapters: [adapter('stories', { pool: [storySet('set1')] })], bytes }).d);
  assert.equal(far.unmatched, 2);
  // The media id our publish recorded matches a single frame.
  const byId = fakeDb();
  const r = await syncPublishedPhotos(deps(byId, { feed: [], stories: [frame('s2', '2026-11-09T14:12:00Z')], adapters: [adapter('stories', { byId: { s2: storySet('set1') } })], bytes }).d);
  assert.deepEqual(r.matched, { media_id: 1, caption: 0, image: 0 });
  assert.equal(byId.used[0]![2], 'stories:set1');
});

test('a run cut short resumes the older posts next night; matched posts are never handled again, unmatched ones only while new', async () => {
  const db = fakeDb({ matches: [{ media_id: 'gone-old', how: 'none' }, { media_id: 'gone-new', how: 'none' }] });
  const at = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
  const feed = [media({ id: 'm-new', timestamp: at(1) }), media({ id: 'm-mid', timestamp: at(6) }), media({ id: 'm-old', timestamp: at(15) }), media({ id: 'gone-old', timestamp: at(12) }), media({ id: 'gone-new', timestamp: at(1.5) })];
  const byId = { 'm-new': post({ postId: 'pn' }), 'm-mid': post({ postId: 'pm' }), 'm-old': post({ postId: 'po' }) };
  // Night 1: the newest post is handled first; the next one never returns (the run times out there).
  const asked1: string[] = [];
  void syncPublishedPhotos(deps(db, { feed, adapters: [adapter('carousels', { byId, asked: asked1, hang: new Set(['m-mid']) })] }).d);
  for (let i = 0; i < 50 && asked1.length < 3; i++) await new Promise((r) => setImmediate(r));
  assert.deepEqual(asked1, ['m-new', 'gone-new', 'm-mid'], 'newest first; an unmatched post newer than 3 days is tried again, an older one is not');
  assert.deepEqual(db.upserts.map((u) => [u[0], u[5]]), [['m-new', 'media_id'], ['gone-new', 'none']], 'each post is recorded as soon as it is handled');
  // Night 2, a day later: the two posts the cut-short run never reached are handled; the matched one is not.
  const asked2: string[] = [];
  const r = await syncPublishedPhotos(deps(db, { feed, adapters: [adapter('carousels', { byId, asked: asked2 })], now: new Date(NOW.getTime() + DAY) }).d);
  assert.deepEqual(asked2, ['gone-new', 'm-mid', 'm-old']);
  assert.equal(r.skipped, 2);
  assert.deepEqual(db.used.map((u) => u[2]), ['carousels:pn', 'carousels:pm', 'carousels:po']);
});

test('the per-run cap leaves the oldest posts for the next run', async () => {
  const db = fakeDb();
  const feed = [media({ id: 'a', timestamp: '2026-11-01T10:00:00Z' }), media({ id: 'b', timestamp: '2026-11-05T10:00:00Z' }), media({ id: 'c', timestamp: '2026-11-08T10:00:00Z' })];
  const { d } = deps(db, { feed, adapters: [adapter('carousels', {})] });
  const r = await syncPublishedPhotos({ ...d, maxMedia: 2 });
  assert.equal(r.deferred, 1);
  assert.deepEqual(db.upserts.map((u) => u[0]), ['c', 'b']);
});

test('before db/social_used_photos_v2.sql: no ig_media_matches table logs and returns, never throws or asks Instagram', async () => {
  const db = fakeDb({ noMatchesTable: true });
  const { d, since, lines } = deps(db, { feed: [media({ id: 'm1' })], adapters: [] });
  const r = await syncPublishedPhotos(d);
  assert.match(r.error ?? '', /ig_media_matches is missing/);
  assert.equal(since.length, 0, 'Instagram was not asked');
  assert.match(lines[0]!, /ig_media_matches is missing/);
  assert.equal(db.used.length + db.upserts.length, 0);
});
