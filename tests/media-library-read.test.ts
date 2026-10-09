/**
 * The photo library's read side (DECISIONS_LOG D49): lib/media-library/read.ts
 * on PGlite, the thumbnail route's pure handler, and the rule that the read
 * code reaches no network module (the hub's library page will import it).
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { THUMB_CACHE_CONTROL, THUMB_SIGN_SECONDS, thumbResponse } from '@/app/api/media-library/thumb/[id]/handler';
import { libraryPhoto, librarySummary, listLibrary, photoObjectPath } from '@/lib/media-library/read';
import type { Query } from '@/lib/media-library/types';
import { openBankTestDb } from './fixtures/media-library/pglite';

let n = 0;
async function photo(query: Query, opts: { urls: Array<{ url: string; lane: string; source: string }>; tags?: string[]; qids?: string[]; licence?: string; reuse?: boolean; status?: string; firstDaysAgo?: number }): Promise<string> {
  n++;
  const sha = (n + 100).toString(16).padStart(64, '0');
  const { rows } = await query(
    `INSERT INTO media_library.photos (sha256, master_path, thumb_path, mime, bytes, width, height, credit, licence, reuse_ok, qids, tags, status, first_seen_at, last_seen_at)
     VALUES ($1, $2, $3, 'image/jpeg', 1000, 1200, 800, 'credit ' || $1, $4, $5, $6::text[], $7::text[], $8, now() - make_interval(days => $9), now() - make_interval(days => $9)) RETURNING id`,
    [sha, `originals/${sha.slice(0, 2)}/${sha}.jpg`, `thumbs/${sha.slice(0, 2)}/${sha}.jpg`, opts.licence ?? 'open', opts.reuse ?? true, opts.qids ?? [], opts.tags ?? [], opts.status ?? 'stored', opts.firstDaysAgo ?? 0],
  );
  for (const u of opts.urls) {
    await query(`INSERT INTO media_library.photo_sources (url, photo_id, source, lane, credit, licence, reuse_ok, status, last_ok_at) VALUES ($1, $2, $3, $4, 'c', 'open', true, 'stored', now())`, [u.url, rows[0].id, u.source, u.lane]);
  }
  return rows[0].id as string;
}

async function seeded() {
  const { query } = await openBankTestDb();
  const clock = await photo(query, { urls: [{ url: 'https://s/clock.jpg', lane: 'stocksnap', source: 'stock' }, { url: 'https://s/clock-copy.jpg', lane: 'openverse', source: 'stock' }], tags: ['wall clock', 'wall', 'clock'] });
  const trump = await photo(query, { urls: [{ url: 'https://c/trump.jpg', lane: 'headshot', source: 'commons' }], qids: ['Q22686'], tags: ['donald', 'trump'], firstDaysAgo: 10 });
  const official = await photo(query, { urls: [{ url: 'https://openai.com/x.png', lane: 'official', source: 'official' }], licence: 'company', reuse: false, tags: ['chip'] });
  const removed = await photo(query, { urls: [{ url: 'https://s/bad.jpg', lane: 'openverse', source: 'stock' }], tags: ['clock'], status: 'removed' });
  await query(`INSERT INTO social.used_photos (url, used_at, story_id, slide) VALUES ('https://s/clock.jpg', '2026-10-01T03:00:00Z', 'a', 5), ('https://s/clock-copy.jpg', '2026-10-06T03:00:00Z', 'b', 4)`);
  await query(
    `INSERT INTO media_library.sightings (url, run_kind, run_ref, slide, request_query, request_kind, outcome, vision, tile_tags, fit)
     VALUES ('https://s/clock.jpg', 'carousel', 'a', 5, 'wall clock', 'thematic', 'picked', '{"scene":"wall clock","pass":true,"what_it_shows":"a clock"}', '{wall clock}', 0.9)`,
  );
  return { query, ids: { clock, trump, official, removed } };
}

test('absent schema: the read side says so and never throws', async () => {
  const { query } = await openBankTestDb({ withBank: false });
  assert.deepEqual(await listLibrary(query), { absent: true });
  assert.deepEqual(await librarySummary(query), { absent: true });
  assert.equal(await libraryPhoto(query, '00000000-0000-4000-8000-000000000000'), null);
  assert.equal(await photoObjectPath(query, '00000000-0000-4000-8000-000000000000'), null);
});

test('listLibrary: items with their use count across every source URL; filters; facets; paging', async () => {
  const { query, ids } = await seeded();
  const all = await listLibrary(query);
  assert.ok(!all.absent);
  assert.equal(all.total, 3, 'removed photos are not listed by default');
  const clock = all.items.find((i) => i.id === ids.clock)!;
  assert.equal(clock.thumbUrl, `/api/media-library/thumb/${ids.clock}`);
  assert.deepEqual([clock.useCount, clock.lastUsedAt?.slice(0, 10)], [2, '2026-10-06'], 'used through either of its URLs');
  assert.deepEqual(clock.lanes.sort(), ['openverse', 'stocksnap']);
  const ids_ = async (f: Parameters<typeof listLibrary>[1]) => {
    const r = await listLibrary(query, f);
    assert.ok(!r.absent);
    return r.items.map((i) => i.id).sort();
  };
  assert.deepEqual(await ids_({ tag: 'Clock' }), [ids.clock]);
  assert.deepEqual(await ids_({ lane: 'headshot' }), [ids.trump]);
  assert.deepEqual(await ids_({ source: 'official' }), [ids.official]);
  assert.deepEqual(await ids_({ licence: 'company' }), [ids.official]);
  assert.deepEqual(await ids_({ qid: 'Q22686' }), [ids.trump]);
  assert.deepEqual(await ids_({ used: true }), [ids.clock]);
  assert.deepEqual(await ids_({ used: false }), [ids.trump, ids.official].sort());
  assert.deepEqual(await ids_({ status: 'removed' }), [ids.removed]);
  const page2 = await listLibrary(query, { page: 2, pageSize: 2 });
  assert.ok(!page2.absent);
  assert.deepEqual([page2.items.length, page2.total, page2.page, page2.pageSize], [1, 3, 2, 2]);
  assert.deepEqual(all.facets.licences.find((f) => f.value === 'open'), { value: 'open', count: 2 });
  assert.ok(all.facets.tags.some((f) => f.value === 'clock'));
});

test('libraryPhoto: one photo with its sources and sightings; bad or unknown ids are null', async () => {
  const { query, ids } = await seeded();
  const p = await libraryPhoto(query, ids.clock);
  assert.ok(p);
  assert.deepEqual(p.sources.map((s) => s.url).sort(), ['https://s/clock-copy.jpg', 'https://s/clock.jpg']);
  assert.deepEqual(p.sightings.map((g) => [g.outcome, g.requestQuery, g.visionPass, g.whatItShows]), [['picked', 'wall clock', true, 'a clock']]);
  assert.equal(await libraryPhoto(query, 'not-a-uuid'), null);
  assert.equal(await libraryPhoto(query, '00000000-0000-4000-8000-000000000000'), null);
});

test('librarySummary: the fullness line', async () => {
  const { query } = await seeded();
  const s = await librarySummary(query);
  assert.ok(!s.absent);
  assert.deepEqual([s.stored, s.reusable, s.addedLast7d], [3, 2, 2]);
  assert.ok(s.lastAddedAt);
  assert.deepEqual(s.bySource, { commons: 1, official: 1, stock: 1 });
});

test('thumbnail handler: 401 without a session, 400 for a bad id, 404 unknown or removed, 302 to a 10-minute signed URL', async () => {
  const { query, ids } = await seeded();
  const signed: Array<[string, number]> = [];
  const deps = (session: unknown) => ({ session: async () => session, query, sign: async (p: string, s: number) => (signed.push([p, s]), `https://storage.test/sign/${p}?token=t`) });
  assert.equal((await thumbResponse(deps(null), ids.clock, null)).status, 401);
  assert.equal((await thumbResponse(deps({ user: 'u' }), 'nope', null)).status, 400);
  assert.equal((await thumbResponse(deps({ user: 'u' }), '00000000-0000-4000-8000-000000000000', null)).status, 404);
  assert.equal((await thumbResponse(deps({ user: 'u' }), ids.removed, null)).status, 404);
  const ok = await thumbResponse(deps({ user: 'u' }), ids.clock, null);
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.get('cache-control'), THUMB_CACHE_CONTROL);
  assert.equal(THUMB_CACHE_CONTROL, 'private, max-age=300');
  assert.match(ok.headers.get('location')!, /^https:\/\/storage\.test\/sign\/thumbs\//);
  const master = await thumbResponse(deps({ user: 'u' }), ids.clock, 'master');
  assert.match(master.headers.get('location')!, /\/sign\/originals\//);
  assert.deepEqual(signed.map((s) => s[1]), [THUMB_SIGN_SECONDS, THUMB_SIGN_SECONDS]);
  assert.equal(THUMB_SIGN_SECONDS, 600);
  const noSchema = await openBankTestDb({ withBank: false });
  assert.equal((await thumbResponse({ ...deps({ user: 'u' }), query: noSchema.query }, ids.clock, null)).status, 404);
});

// ── No network from the read side (the hub scope test's rule, for the page that will import it) ──

const ROOT = process.cwd();
const NETWORK = [/^lib\/media-bucket\.ts$/, /^lib\/anthropic(-client)?\.ts$/, /^lib\/supabase\.ts$/, /\/jev\//, /^lib\/instagram\//];
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function reach(start: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    out.push(file);
    const text = strip(readFileSync(path.join(ROOT, file), 'utf8'));
    for (const m of text.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g)) {
      if (/^\s*(?:import|export)\s+type\s/.test(m[0])) continue;
      const spec = m[1]!;
      const base = spec.startsWith('@/') ? spec.slice(2) : spec.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)) : null;
      if (!base) {
        out.push(`package:${spec}`);
        continue;
      }
      const hit = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, base].find((c) => existsSync(path.join(ROOT, c)) && statSync(path.join(ROOT, c)).isFile());
      if (hit) queue.push(hit);
    }
  }
  return out;
}

test('the library read code and the photo grid reach no network module, no fetch and no package', () => {
  for (const start of ['lib/media-library/read.ts', 'components/social-hub/library/PhotoGrid.tsx']) {
    const files = reach(start);
    assert.deepEqual(files.filter((f) => f.startsWith('package:')), [], `${start} imports a package`);
    assert.deepEqual(files.filter((f) => NETWORK.some((re) => re.test(f))), [], `${start} reaches a network module`);
    for (const f of files) assert.doesNotMatch(strip(readFileSync(path.join(ROOT, f), 'utf8')), /\bfetch\s*\(/, f);
    assert.doesNotMatch(strip(readFileSync(path.join(ROOT, start), 'utf8')), /\b(INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM)\b/i, `${start} writes SQL`);
  }
});
