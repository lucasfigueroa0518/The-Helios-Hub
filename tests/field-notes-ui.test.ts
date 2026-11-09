/**
 * Field Notes page and API routes (CONTRACT sections 7 and 9, owner F). Handlers run with an injected
 * session and, where SQL matters, PGlite loaded with the real media_library and field_notes schemas and an
 * in-memory bucket. Nothing reaches the network, a model, or the real database.
 */
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { fieldNotesPoolRoute, REASON_REQUIRED } from '@/app/api/field-notes/pool/handler';
import { fieldNotesRunRoute } from '@/app/api/field-notes/run/handler';
import { LEAF_REQUIRED, WANT_REQUIRED, guessSubject, seedRoute, normalizeSourceUrl } from '@/app/api/field-notes/seed/handler';
import { parsePanelSettings, settingsPost } from '@/app/api/field-notes/settings/handler';
import { slideResponse } from '@/app/api/field-notes/slides/[postId]/[n]/handler';
import { loadPanelData } from '@/components/field-notes/load';
import { ingestPhoto } from '@/lib/field-notes/photos/ingest';
import { listPool, restorePhotoToPool, retirePhoto, setPhotoTags } from '@/lib/field-notes/photos/store';
import { SOURCE_REGISTRY } from '@/lib/field-notes/sources/registry';
import { CONTENT_LEAVES, type PhotoKind } from '@/lib/field-notes/types';
import type { Query } from '@/lib/media-library/types';
import { memoryBucket } from './fixtures/media-library/pglite';

const schemaSql = (file: string) =>
  readFileSync(path.join(process.cwd(), 'db', file), 'utf8').split(/\r?\n/).filter((line) => !line.startsWith('\\')).join('\n');

async function openDb(): Promise<{ pg: PGlite; db: Query }> {
  const pg = new PGlite();
  await pg.exec(schemaSql('media_library_schema.sql'));
  await pg.exec(schemaSql('field_notes_schema.sql'));
  return { pg, db: async (text, params) => ({ rows: (await pg.query(text, params as unknown[])).rows as any[] }) };
}

const TOMMY = async () => ({ email: 'tommy@heliosmarketing.org' });
const NOBODY = async () => null;

/** A busy picture so different seeds hash far apart (as in the photo tests). */
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

// The upload routes (sign, finalize), the upload box's sequential sender and the dedupe are covered by
// tests/field-notes-photos.test.ts (the signed-URL flow); this file keeps the pool, seed, run, settings, slides and panel.

async function uploadEnv() {
  const { db } = await openDb();
  return { db, bucket: memoryBucket() };
}

// ── pool: reject and restore ────────────────────────────────────────────────

async function poolEnv() {
  const { db, bucket } = await uploadEnv();
  const stored = await ingestPhoto({ db, bucket }, { bytes: await picture(9), mime: 'image/jpeg', uploadedBy: 'lucas@heliosmarketing.org' });
  if (stored.kind !== 'stored') throw new Error('not stored');
  return { db, photoId: stored.photoId, env: { session: TOMMY, reject: (id: string, why: string) => retirePhoto(db, id, why), restore: (id: string) => restorePhotoToPool(db, id), tag: (id: string, t: { kind?: PhotoKind; opener?: boolean }) => setPhotoTags(db, id, t) } };
}

test('pool: Reject needs a reason (none, or only spaces, is refused and nothing changes)', async () => {
  const { db, photoId, env } = await poolEnv();
  for (const reason of [undefined, '', '   ']) {
    const res = await fieldNotesPoolRoute(env, { action: 'reject', photoId, reason });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, REASON_REQUIRED);
  }
  assert.equal((await listPool(db))[0]!.status, 'live');
});

test('pool: Reject with a reason retires the photo; Restore brings it back', async () => {
  const { db, photoId, env } = await poolEnv();
  const rej = await fieldNotesPoolRoute(env, { action: 'reject', photoId, reason: ' readable private screen ' });
  assert.equal(rej.status, 200);
  const retired = (await listPool(db))[0]!;
  assert.equal(retired.status, 'retired');
  assert.equal(retired.rejectReason, 'readable private screen');
  assert.equal((await fieldNotesPoolRoute(env, { action: 'restore', photoId })).status, 200);
  assert.equal((await listPool(db))[0]!.status, 'live');
  // Restoring a photo that is not rejected is a 409, an unknown one a 404 on reject.
  assert.equal((await fieldNotesPoolRoute(env, { action: 'restore', photoId })).status, 409);
  assert.equal((await fieldNotesPoolRoute(env, { action: 'reject', photoId: '00000000-0000-4000-8000-000000000000', reason: 'x' })).status, 404);
  assert.equal((await fieldNotesPoolRoute(env, { action: 'delete', photoId })).status, 400);
  assert.equal((await fieldNotesPoolRoute({ ...env, session: NOBODY }, { action: 'restore', photoId })).status, 401);
});

test('pool: an auto-tagged Faces photo shows "Faces (auto)", and one click on "Not faces" removes the tag (no re-upload)', async () => {
  const { db, bucket } = await uploadEnv();
  const stored = await ingestPhoto({ db, bucket, detectFaces: async () => ({ face: true, reason: 'stub face' }) }, { bytes: await picture(31), mime: 'image/jpeg', uploadedBy: 'tommy@heliosmarketing.org', kind: 'scenery' });
  if (stored.kind !== 'stored') throw new Error('not stored');
  assert.deepEqual([(await listPool(db))[0]!.kind, (await listPool(db))[0]!.opener], ['people', true]);

  const React = await import('react');
  (globalThis as { React?: unknown }).React = React;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { AppRouterContext } = await import('next/dist/shared/lib/app-router-context.shared-runtime');
  const { PoolGrid } = await import('@/components/field-notes/PoolGrid');
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {}, hmrRefresh() {} };
  const html = renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: router as never }, React.createElement(PoolGrid, { pool: await listPool(db) })));
  assert.match(html, />Faces \(auto\)</);
  assert.match(html, />Not faces</);
  assert.doesNotMatch(html, /<select/, 'a Faces photo is not re-tagged by hand to another kind from a menu');

  // The button sends exactly this body; the pool route applies it in one request.
  const grid = readFileSync(path.join(process.cwd(), 'components/field-notes/PoolGrid.tsx'), 'utf8');
  assert.match(grid, /act\(\{ action: 'tag', kind: 'working', opener: false \}\)/);
  const env = { session: TOMMY, reject: (id: string, why: string) => retirePhoto(db, id, why), restore: (id: string) => restorePhotoToPool(db, id), tag: (id: string, t: { kind?: PhotoKind; opener?: boolean }) => setPhotoTags(db, id, t) };
  assert.equal((await fieldNotesPoolRoute(env, { action: 'tag', photoId: stored.photoId, kind: 'working', opener: false })).status, 200);
  assert.deepEqual([(await listPool(db))[0]!.kind, (await listPool(db))[0]!.opener], ['working', false]);
  const after = renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: router as never }, React.createElement(PoolGrid, { pool: await listPool(db) })));
  assert.doesNotMatch(after, /Faces \(auto\)<\/span>/);
  assert.match(after, /<option value="working" selected="">Working<\/option>|<select[^>]*>.*Working/);
});

test('pool: a photo not checked yet shows "Checking for faces…"; once the worker tags it, "Faces (auto)" and "Not faces"', async () => {
  const { db, bucket } = await uploadEnv();
  const download = async (p: string) => bucket.objects.get(p)!.body;
  // Stored the way finalize does on Vercel (no detector there), and an older photo from before the face check.
  const fresh = await ingestPhoto({ db, bucket, deferFaces: true }, { bytes: await picture(32), mime: 'image/jpeg', uploadedBy: 'tommy@heliosmarketing.org', kind: 'scenery' });
  const older = await ingestPhoto({ db, bucket }, { bytes: await picture(33), mime: 'image/jpeg', uploadedBy: 'lucas@heliosmarketing.org', kind: 'event' });
  if (fresh.kind !== 'stored' || older.kind !== 'stored') throw new Error('not stored');

  const React = await import('react');
  (globalThis as { React?: unknown }).React = React;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { AppRouterContext } = await import('next/dist/shared/lib/app-router-context.shared-runtime');
  const { PoolGrid } = await import('@/components/field-notes/PoolGrid');
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {}, hmrRefresh() {} };
  const render = async () => {
    // Through the page loader, so the face check reaches the grid the way the page passes it.
    const { pool } = await loadPanelData(db);
    const html = renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: router as never }, React.createElement(PoolGrid, { pool })));
    const card = (id: string) => html.split('<li').find((li) => li.includes(id)) ?? '';
    return { fresh: card(fresh.photoId), older: card(older.photoId) };
  };
  let cards = await render();
  assert.match(cards.fresh, /Checking for faces…/);
  assert.match(cards.fresh, /<select/, 'the kind can still be changed while the check is pending');
  assert.doesNotMatch(cards.fresh, />Faces \(auto\)</);
  assert.doesNotMatch(cards.fresh, />Not faces</);
  assert.doesNotMatch(cards.older, /Checking for faces/, 'an older photo is not queued and says nothing about a check');

  const { runFacesStep } = await import('@/lib/field-notes/photos/faces-worker');
  const out = await runFacesStep({ db, download, openDetector: async () => ({ detect: async () => ({ face: true, reason: 'stub face' }), close: async () => undefined }) });
  assert.equal(out.claimed, 1, 'only the new upload is checked');
  cards = await render();
  assert.match(cards.fresh, />Faces \(auto\)</);
  assert.match(cards.fresh, />Not faces</);
  assert.doesNotMatch(cards.fresh, /Checking for faces/);
  assert.match(cards.older, /<select/);
  assert.equal((await listPool(db)).find((p) => p.photoId === older.photoId)!.kind, 'event');
});

test('pool: tagging and starring need a session, validate the body, and change only the tags', async () => {
  const { db, photoId, env } = await poolEnv();
  assert.equal((await listPool(db))[0]!.kind, 'working');
  assert.equal((await fieldNotesPoolRoute({ ...env, session: NOBODY }, { action: 'tag', photoId, kind: 'event' })).status, 401);
  assert.equal((await listPool(db))[0]!.kind, 'working');
  assert.equal((await fieldNotesPoolRoute(env, { action: 'tag', photoId, kind: 'event' })).status, 200);
  assert.equal((await fieldNotesPoolRoute(env, { action: 'tag', photoId, opener: true })).status, 200);
  const after = (await listPool(db))[0]!;
  assert.deepEqual([after.kind, after.opener, after.status], ['event', true, 'live']);
  assert.equal((await fieldNotesPoolRoute(env, { action: 'tag', photoId, kind: 'selfie' })).status, 400);
  assert.equal((await fieldNotesPoolRoute(env, { action: 'tag', photoId })).status, 400);
  assert.equal((await fieldNotesPoolRoute(env, { action: 'tag', photoId, opener: 'yes' })).status, 400);
  assert.equal((await fieldNotesPoolRoute(env, { action: 'tag', photoId: '00000000-0000-4000-8000-000000000000', kind: 'people' })).status, 404);
  assert.equal((await fieldNotesPoolRoute(env, { action: 'tag', photoId, opener: false })).status, 200);
  assert.deepEqual([(await listPool(db))[0]!.kind, (await listPool(db))[0]!.opener], ['event', false]);
});

// ── seed ────────────────────────────────────────────────────────────────────

/** The two required tags every seed now carries. */
const TAGS = { leaf: 'skill', want: 'faster' } as const;

test('seed: a link creates a tip with source_kind seed, as a candidate, and queues nothing else', async () => {
  const { pg, db } = await openDb();
  const res = await seedRoute({ session: TOMMY, db }, { ...TAGS, url: 'https://github.com/acme/widget-skill#readme', note: 'Run it on a PDF and get a one-page summary.' });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.kind, 'created');
  const tips = (await pg.query(`SELECT source_kind, source_url, subject, branch, leaf, want, tier, use_with_result, status, seeded_by, untrusted_content FROM field_notes.tips`)).rows as any[];
  assert.deepEqual(tips, [{
    source_kind: 'seed',
    source_url: 'https://github.com/acme/widget-skill',
    subject: 'acme/widget-skill',
    branch: null,
    leaf: 'skill',
    want: 'faster',
    tier: null,
    use_with_result: 'Run it on a PDF and get a one-page summary.',
    status: 'candidate',
    seeded_by: 'tommy@heliosmarketing.org',
    untrusted_content: null,
  }]);
  assert.equal((await pg.query(`SELECT 1 FROM field_notes.runs`)).rows.length, 0, 'a seed queues no run');
  assert.equal((await pg.query(`SELECT 1 FROM field_notes.posts`)).rows.length, 0);
});

test('seed: the same source URL again is reported as a duplicate, not an error', async () => {
  const { pg, db } = await openDb();
  const first = await (await seedRoute({ session: TOMMY, db }, { ...TAGS, url: 'https://docs.acme.dev/features/shortcuts' })).json();
  const res = await seedRoute({ session: TOMMY, db }, { ...TAGS, url: 'https://docs.acme.dev/features/shortcuts#top', note: 'again' });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.kind, 'duplicate');
  assert.equal(json.tipId, first.tipId);
  assert.equal(json.status, 'candidate');
  assert.equal((await pg.query(`SELECT 1 FROM field_notes.tips`)).rows.length, 1);
});

test('seed: a link whose tip was set aside or expired is put back as a candidate, and a drafted one is not', async () => {
  const { pg, db } = await openDb();
  const first = await (await seedRoute({ session: TOMMY, db }, { ...TAGS, url: 'https://docs.acme.dev/features/retry' })).json();
  for (const status of ['rejected', 'expired']) {
    await pg.query(`UPDATE field_notes.tips SET status = $1 WHERE id = $2`, [status, first.tipId]);
    const again = await (await seedRoute({ session: TOMMY, db }, { url: 'https://docs.acme.dev/features/retry', leaf: 'technique', want: 'better', note: 'Use the shortcut and get the summary.' })).json();
    assert.equal(again.kind, 'reopened', status);
    const row = (await pg.query(`SELECT status, use_with_result, leaf, want FROM field_notes.tips WHERE id = $1`, [first.tipId])).rows[0] as { status: string; use_with_result: string; leaf: string; want: string };
    assert.equal(row.status, 'candidate');
    assert.equal(row.use_with_result, 'Use the shortcut and get the summary.');
    assert.deepEqual([row.leaf, row.want], ['technique', 'better'], 'a reopened tip carries the new seeder\'s leaf and want');
  }
  await pg.query(`UPDATE field_notes.tips SET status = 'drafted' WHERE id = $1`, [first.tipId]);
  assert.equal((await (await seedRoute({ session: TOMMY, db }, { ...TAGS, url: 'https://docs.acme.dev/features/retry' })).json()).kind, 'duplicate');
});

test('seed: the link is stored canonical, and a link a source already found becomes this seeder\'s seed', async () => {
  const { pg, db } = await openDb();
  await pg.query(`INSERT INTO field_notes.tips (source_kind, source_url, source_label, subject, use_with_result, want, leaf) VALUES ('docs', 'https://docs.acme.dev/features/found', 'Acme docs', 'Acme docs', 'u', 'cheaper', 'skill')`);
  const res = await seedRoute({ session: TOMMY, db }, { url: 'https://www.docs.acme.dev/features/found/?utm_source=x', leaf: 'coding_agent_feature', want: 'better', note: 'Use the shortcut.' });
  const json = await res.json();
  assert.equal(json.kind, 'reopened');
  assert.equal(json.sourceUrl, 'https://docs.acme.dev/features/found');
  const rows = (await pg.query(`SELECT source_kind, leaf, want, seeded_by, status, use_with_result FROM field_notes.tips`)).rows;
  assert.deepEqual(rows, [{ source_kind: 'seed', leaf: 'coding_agent_feature', want: 'better', seeded_by: 'tommy@heliosmarketing.org', status: 'candidate', use_with_result: 'Use the shortcut.' }]);
});

test('seed: bad links and an oversize note are 400s; no session is a 401; nothing is written', async () => {
  const { pg, db } = await openDb();
  for (const url of [undefined, '', 'not a link', 'ftp://x.com/a', 'https://user:pw@x.com/']) {
    assert.equal((await seedRoute({ session: TOMMY, db }, { ...TAGS, url })).status, 400, String(url));
  }
  assert.equal((await seedRoute({ session: TOMMY, db }, { ...TAGS, url: 'https://x.com/a', note: 'n'.repeat(1001) })).status, 400);
  assert.equal((await seedRoute({ session: NOBODY, db }, { ...TAGS, url: 'https://x.com/a' })).status, 401);
  assert.equal((await pg.query(`SELECT 1 FROM field_notes.tips`)).rows.length, 0);
  assert.deepEqual(normalizeSourceUrl('https://X.com/a#b'), { url: 'https://x.com/a' });
});

test('seed: a missing or unknown leaf or want is a 400 naming what to pick, and nothing is written', async () => {
  const { pg, db } = await openDb();
  const url = 'https://github.com/acme/widget-skill';
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ want: 'faster' }, LEAF_REQUIRED],
    [{ leaf: '', want: 'faster' }, LEAF_REQUIRED],
    [{ leaf: 'open_source_repo', want: 'faster' }, LEAF_REQUIRED],
    [{ leaf: 'SKILL', want: 'faster' }, LEAF_REQUIRED],
    [{ leaf: 'skill' }, WANT_REQUIRED],
    [{ leaf: 'skill', want: 'cheap' }, WANT_REQUIRED],
    [{ leaf: 'skill', want: 1 }, WANT_REQUIRED],
  ];
  for (const [tags, error] of cases) {
    const res = await seedRoute({ session: TOMMY, db }, { url, ...tags });
    assert.equal(res.status, 400, JSON.stringify(tags));
    assert.equal((await res.json()).error, error, JSON.stringify(tags));
  }
  assert.equal((await pg.query(`SELECT 1 FROM field_notes.tips`)).rows.length, 0);
});

// ── run ─────────────────────────────────────────────────────────────────────

/** A run queue with the real table: the schema's single-requested index is what refuses the second click. */
async function runEnv() {
  const { pg } = await openDb();
  let calls = 0;
  const run = async (email: string) => {
    calls++;
    const { rows } = await pg.query(`INSERT INTO field_notes.runs (trigger, requested_by) VALUES ('manual', $1) ON CONFLICT DO NOTHING RETURNING id`, [email]);
    return rows.length ? { queued: true, note: 'Run queued.' } : { queued: false, note: 'A Field Notes run is already queued or running.' };
  };
  return { pg, calls: () => calls, env: { session: TOMMY, run } };
}

test('run: Generate queues exactly one run and refuses a second', async () => {
  const { pg, env } = await runEnv();
  const first = await (await fieldNotesRunRoute(env)).json();
  const second = await fieldNotesRunRoute(env);
  assert.equal(first.queued, true);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).queued, false);
  const runs = (await pg.query(`SELECT status, trigger, requested_by FROM field_notes.runs`)).rows;
  assert.deepEqual(runs, [{ status: 'requested', trigger: 'manual', requested_by: 'tommy@heliosmarketing.org' }]);
});

test('run: no session is a 401 before anything is queued; a failure is a 500 with its message', async () => {
  const { calls, env, pg } = await runEnv();
  assert.equal((await fieldNotesRunRoute({ ...env, session: NOBODY })).status, 401);
  assert.equal(calls(), 0);
  assert.equal((await pg.query(`SELECT 1 FROM field_notes.runs`)).rows.length, 0);
  const boom = await fieldNotesRunRoute({ session: TOMMY, run: async () => { throw new Error('db down'); } });
  assert.equal(boom.status, 500);
  assert.equal((await boom.json()).error, 'db down');
});

// ── settings ────────────────────────────────────────────────────────────────

test('settings: shipped values read as auto_run off, publishing_live off, require_approval on, rest 8, cap 3, expiry 30', async () => {
  const { pg } = await openDb();
  const rows = (await pg.query(`SELECT key, value FROM field_notes.settings`)).rows as Array<{ key: string; value: unknown }>;
  assert.deepEqual(parsePanelSettings(rows), { autoRun: false, publishingLive: false, requireApproval: true, photoRestPosts: 8, maxPendingDrafts: 3, tipExpiryDays: 30 });
  assert.deepEqual(parsePanelSettings([]), parsePanelSettings(rows));
});

test('settings: switches go through posting (generate, live, autoPublish), numbers through their own write; bad input is a 400', async () => {
  const calls: string[] = [];
  const env = {
    session: TOMMY,
    read: async () => parsePanelSettings([]),
    writeSwitches: async (p: object, by: string) => void calls.push(`switches ${JSON.stringify(p)} by ${by}`),
    writeNumber: async (k: string, v: number) => void calls.push(`${k}=${v}`),
  };
  const ok = await settingsPost(env, { autoRun: true, requireApproval: false, publishingLive: true, photoRestPosts: 10, maxPendingDrafts: 2, tipExpiryDays: 14 });
  assert.equal(ok.status, 200);
  assert.deepEqual(calls, [
    'switches {"generate":true,"live":true,"autoPublish":true} by tommy@heliosmarketing.org',
    'photo_rest_posts=10', 'max_pending_drafts=2', 'tip_expiry_days=14',
  ]);
  calls.length = 0;
  for (const bad of [{}, { photoRestPosts: -1 }, { maxPendingDrafts: 0 }, { tipExpiryDays: 1.5 }, { autoRun: 'yes' }, { runCapUsd: 5 }, null]) {
    assert.equal((await settingsPost(env, bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await settingsPost({ ...env, session: NOBODY }, { autoRun: true })).status, 401);
  assert.deepEqual(calls, []);
});

// ── slides ──────────────────────────────────────────────────────────────────

test('slides: signed redirect for a rendered slide, 404 before render, 400 for a bad id, 401 without a session', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const deps = { session: TOMMY, slideObjects: async () => ['field-notes/a/v1/slide-01.jpg'], sign: async (p: string) => `https://signed.example/${p}` };
  const ok = await slideResponse(deps, id, '0');
  assert.equal(ok.status, 307);
  assert.equal(ok.headers.get('location'), 'https://signed.example/field-notes/a/v1/slide-01.jpg');
  assert.equal((await slideResponse(deps, id, '3')).status, 404);
  assert.equal((await slideResponse({ ...deps, slideObjects: async () => null }, id, '0')).status, 404);
  assert.equal((await slideResponse(deps, 'nope', '0')).status, 400);
  assert.equal((await slideResponse(deps, id, '-1')).status, 400);
  assert.equal((await slideResponse({ ...deps, session: NOBODY }, id, '0')).status, 401);
});

// ── panel data and components ───────────────────────────────────────────────

async function seedReviewPost(pg: PGlite) {
  const tipRow = async (url: string, label: string, subject: string, leaf: string | null, want: string | null, tier: string | null) =>
    ((await pg.query(`INSERT INTO field_notes.tips (source_kind, source_url, source_label, subject, leaf, want, tier, use_with_result) VALUES ('docs', $1, $2, $3, $4, $5, $6, 'Press the key and get the summary.') RETURNING id`, [url, label, subject, leaf, want, tier])).rows[0] as { id: string }).id;
  const tipIds = [
    await tipRow('https://docs.acme.dev/x', 'Acme docs', 'Acme Shortcuts', 'repo_free_alternative', 'cheaper', 'middle'),
    await tipRow('https://docs.beta.dev/y', 'Beta docs', 'Beta Loop', 'coding_agent_feature', 'faster', 'higher'),
    await tipRow('https://docs.gamma.dev/z', 'Gamma docs', 'Gamma Sweep', null, null, null),
  ];
  const run = (await pg.query(`INSERT INTO field_notes.runs (trigger, status, record) VALUES ('manual', 'ok', '{}'::jsonb) RETURNING id`)).rows[0] as { id: string };
  const slides = [
    { kind: 'cover', photoId: 'w', blocks: [{ role: 'headline', text: '3 AI tips to try' }] },
    ...['Acme Shortcuts', 'Beta Loop', 'Gamma Sweep'].map((t) => ({ kind: 'tip', photoId: 'x', blocks: [{ role: 'headline', text: t }] })),
    { kind: 'follow', photoId: 'y', blocks: [{ role: 'headline', text: 'Follow Helios' }] },
  ];
  const post = (await pg.query(
    `INSERT INTO field_notes.posts (run_id, tip_id, tip_ids, slug, ny_date, slides, caption, slide_objects, fit_problems, soft_notes) VALUES ($1, $2, $3::uuid[], 'acme-shortcuts', '2026-11-04', $4::jsonb, 'Caption text.', '["a","b","c","d","e"]'::jsonb, '["slide 1 too_long: text does not fit"]'::jsonb, '["slide 2 headline is not Title Case"]'::jsonb) RETURNING id::text AS id`,
    [run.id, tipIds[0], tipIds, JSON.stringify(slides)],
  )).rows[0] as { id: string };
  return post.id;
}

test('panel data: the pool and the posts in review, each with its tip, notes and problems', async () => {
  const { pg, db } = await openDb();
  const id = await seedReviewPost(pg);
  const data = await loadPanelData(db);
  assert.equal(data.pool.length, 0);
  assert.equal(data.posts.length, 1);
  const p = data.posts[0]!;
  assert.equal(p.id, id);
  assert.deepEqual(p.slideHeadlines, ['3 AI tips to try', 'Acme Shortcuts', 'Beta Loop', 'Gamma Sweep', 'Follow Helios']);
  assert.equal(p.hasSlides, true);
  assert.deepEqual(p.softNotes, ['slide 2 headline is not Title Case']);
  assert.deepEqual(p.fitProblems, ['slide 1 too_long: text does not fit']);
  assert.deepEqual(p.tips.map((t) => t.subject), ['Acme Shortcuts', 'Beta Loop', 'Gamma Sweep'], 'every tip, in slide order');
  assert.deepEqual(p.tips.map((t) => t.sourceUrl), ['https://docs.acme.dev/x', 'https://docs.beta.dev/y', 'https://docs.gamma.dev/z']);
  assert.deepEqual(p.tips.map((t) => [t.leaf, t.want, t.tier]), [['repo_free_alternative', 'cheaper', 'middle'], ['coding_agent_feature', 'faster', 'higher'], [null, null, null]]);
});

test('review panel: each tip slide shows its leaf, want and tier as plain labels, and an untagged tip says so', async () => {
  const React = await import('react');
  (globalThis as { React?: unknown }).React = React;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { AppRouterContext } = await import('next/dist/shared/lib/app-router-context.shared-runtime');
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {}, hmrRefresh() {} };
  const { pg, db } = await openDb();
  await seedReviewPost(pg);
  const { FieldNotesReviewPanel } = await import('@/components/field-notes/FieldNotesReviewPanel');
  const html = renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: router as never }, React.createElement(FieldNotesReviewPanel, { posts: (await loadPanelData(db)).posts })));
  const tips = html.split('<li>').slice(1).map((li) => li.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '));
  assert.equal(tips.length, 3);
  for (const label of ['Acme Shortcuts', 'Free alternative to a paid tool', 'Cheaper', 'Middle know-how']) assert.ok(tips[0]!.includes(label), label);
  for (const label of ['Beta Loop', 'Coding agent feature', 'Faster', 'Higher know-how']) assert.ok(tips[1]!.includes(label), label);
  for (const label of ['Gamma Sweep', 'Kind not tagged', 'Want not tagged', 'Know-how not tagged']) assert.ok(tips[2]!.includes(label), label);
  assert.doesNotMatch(html, /repo_free_alternative|coding_agent_feature|newly_possible|Open source repo|Paid tool feature/, 'labels are plain words, never raw values or the retired branches');
});

test('seed form: required leaf and want selects list every leaf and want in plain words', async () => {
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { FieldNotesSeedForm } = await import('@/components/field-notes/FieldNotesSeedForm');
  const { LEAF_LABEL, WANT_LABEL } = await import('@/components/field-notes/constants');
  const html = renderToStaticMarkup(React.createElement(FieldNotesSeedForm, { done() {} }));
  const selects = html.match(/<select[^>]*>/g) ?? [];
  assert.equal(selects.length, 2);
  for (const sel of selects) assert.match(sel, /required/);
  for (const label of [...Object.values(LEAF_LABEL), ...Object.values(WANT_LABEL)]) assert.ok(html.includes(`>${label}</option>`), label);
  assert.match(html, /What it points to/);
  assert.match(html, /What the reader gets/);
});

test('registry: every source names known leaves and carries verifiedOn, a read note, a fetch note and a vendor', () => {
  for (const e of SOURCE_REGISTRY) {
    assert.ok(e.leaves && e.leaves.length > 0, `${e.id} has leaves`);
    for (const l of e.leaves!) assert.ok(CONTENT_LEAVES.includes(l), `${e.id}: ${l}`);
    assert.match(e.verifiedOn ?? '', /^\d{4}-\d{2}-\d{2}$/, `${e.id} has verifiedOn`);
    assert.ok(e.read && e.note && e.vendor, `${e.id} has read, note and vendor`);
    assert.equal('branch' in e, false, `${e.id} has no branch`);
  }
  const ids = SOURCE_REGISTRY.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  const byVendor = new Map<string, number>();
  for (const e of SOURCE_REGISTRY) if (e.vendor !== 'any') byVendor.set(e.vendor!, (byVendor.get(e.vendor!) ?? 0) + 1);
  for (const [vendor, n] of byVendor) assert.ok(n <= SOURCE_REGISTRY.length / 3, `${vendor} is at most a third of the entries`);
});

test('components render without throwing: upload box, pool, review panel, seed form, run button, settings, and no emoji or exclamation marks', async () => {
  const React = await import('react');
  (globalThis as { React?: unknown }).React = React;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { AppRouterContext } = await import('next/dist/shared/lib/app-router-context.shared-runtime');
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {}, hmrRefresh() {} };
  const wrap = (el: React.ReactElement) => renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: router as never }, el));
  const { pg, db } = await openDb();
  await seedReviewPost(pg);
  const bucket = memoryBucket();
  await ingestPhoto({ db, bucket }, { bytes: await picture(11), mime: 'image/jpeg', uploadedBy: 'tommy@heliosmarketing.org' });
  const rejected = await ingestPhoto({ db, bucket }, { bytes: await picture(12), mime: 'image/jpeg', uploadedBy: 'lucas@heliosmarketing.org' });
  if (rejected.kind !== 'stored') throw new Error('not stored');
  await retirePhoto(db, rejected.photoId, 'a stranger in frame');
  const data = await loadPanelData(db);

  const { FieldNotesTopView } = await import('@/components/field-notes/FieldNotesTopView');
  const { FieldNotesSeedForm } = await import('@/components/field-notes/FieldNotesSeedForm');
  const { FieldNotesRunButton } = await import('@/components/field-notes/FieldNotesRunButton');
  const { FieldNotesSettingsPanel } = await import('@/components/field-notes/FieldNotesSettingsPanel');

  const top = wrap(React.createElement(FieldNotesTopView, { data, restPosts: 8 }));
  assert.match(top, /Add photos/);
  assert.match(top, /HEIC, HEIF, JPEG, PNG or WebP/);
  assert.match(top, /1 of about 25 live/);
  assert.match(top, /What do these photos show/);
  assert.match(top, /Faces are found automatically shortly after upload/);
  assert.match(top, /Live by kind: Working 1, Scenery 0, Faces \(auto\) 0, Event 0\./);
  assert.doesNotMatch(top, /starred|Opener/);
  assert.match(top, /No live photo is tagged Faces/);
  assert.match(top, /Fewer than 2 live photos are scenery or event/);
  // The upload box offers Working, Scenery and Event; Faces is never a choice there.
  const chips = [...top.matchAll(/class="rh-chip fn-kind[^"]*"[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(chips, ['Working', 'Scenery', 'Event']);
  // A non-face pool photo can switch kind among the three, never to Faces.
  assert.match(top, /<option value="event">Event<\/option>/);
  assert.doesNotMatch(top, /<option value="people">/);
  assert.match(top, /Rejected: a stranger in frame/);
  assert.match(top, /Restore/);
  assert.match(top, />Reject</);
  assert.match(top, /Waiting for review/);
  assert.match(top, /\/api\/field-notes\/slides\/[0-9a-f-]{36}\/1\?v=1/);
  for (const url of ['https://docs.acme.dev/x', 'https://docs.beta.dev/y', 'https://docs.gamma.dev/z']) assert.ok(top.includes(`href="${url}"`), `the review panel links ${url}`);
  assert.match(top, />Approve</);
  assert.doesNotMatch(top, />Rebuild</, "Field Notes has no Rebuild control");
  assert.match(top, /Fit problems/);
  assert.match(top, /Tommy|Lucas/);

  const empty = wrap(React.createElement(FieldNotesTopView, { data: { pool: [], posts: [] } }));
  assert.match(empty, /No photos yet/);
  assert.doesNotMatch(empty, /Waiting for review/);
  assert.match(wrap(React.createElement(FieldNotesTopView, { data: null, error: 'relation does not exist' })), /Could not load the photo pool/);

  const seed = wrap(React.createElement(FieldNotesSeedForm, { done() {} }));
  assert.match(seed, /Seed a Field Notes tip/);
  const run = wrap(React.createElement(FieldNotesRunButton));
  assert.match(run, />Generate</);
  const settings = wrap(React.createElement(FieldNotesSettingsPanel, { initial: parsePanelSettings([]) }));
  for (const label of ['Auto-run', 'Require approval', 'Publishing live', 'Photo rest', 'Pending draft cap', 'Tip expiry']) assert.match(settings, new RegExp(label));

  // Copy: plain voice, no exclamation marks and no emoji in anything the page says.
  for (const html of [top, empty, seed, run, settings]) {
    const text = html.replace(/<[^>]*>/g, ' ');
    assert.doesNotMatch(text, /!/);
    assert.doesNotMatch(text, /\p{Extended_Pictographic}/u);
  }
});

test('an empty seed note stores the prompt-safe stand-in, not a sentence the Writer would treat as fact', async () => {
  const { SEED_USE_PLACEHOLDER } = await import('@/app/api/field-notes/seed/handler');
  const { PLACEHOLDER_USE } = await import('@/lib/field-notes/store');
  assert.equal(SEED_USE_PLACEHOLDER, PLACEHOLDER_USE);
  assert.doesNotMatch(SEED_USE_PLACEHOLDER, /press Generate|Seeded link/i);
});

test('seed subject: two pages on one docs site are different subjects; a GitHub repo is owner/repo (Tommy, 2026-11-06)', () => {
  const a = guessSubject('https://docs.example.com/guide/hooks');
  const b = guessSubject('https://docs.example.com/guide/memory');
  assert.notEqual(a.subject, b.subject);
  assert.equal(a.subject, 'docs.example.com/guide/hooks');
  assert.equal(a.label, 'docs.example.com');
  assert.equal(guessSubject('https://github.com/owner/repo/tree/main').subject, 'owner/repo');
  assert.equal(guessSubject('https://example.com/').subject, 'example.com');
});
