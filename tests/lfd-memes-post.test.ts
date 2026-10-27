// Memes in a real Last Few Days post (lib/memes/lfd-post.ts) and the worker's hook (lib/lfd/worker.ts). Offline:
// Jev, the meme run, the renderer and storage are stubs; the post lives in the hub's PGlite test database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import sharp from 'sharp';

import type { LfdRunDeps } from '@/lib/lfd/run';
import { claimRun, finishRun, insertPost, requestRun } from '@/lib/lfd/store';
import { carryOutLfdRun, type CarryOutDeps } from '@/lib/lfd/worker';
import type { MemesDb } from '@/lib/memes/db';
import { addMemesToPost, type GateEvidence, type PostMemesDeps } from '@/lib/memes/lfd-post';
import type { SavedStory } from '@/lib/memes/lfd-sim/post';
import { regimeId } from '@/lib/memes/regime';
import { TAGGER_VERSION, type StoryTags, type TagScores } from '@/lib/memes/story-tags';
import type { JevAsk, JevResult } from '@/lib/social/jev/client';
import type { HubQuery } from '@/lib/social-hub/db';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const NOW = new Date('2026-10-13T07:30:00Z');

const story = (i: number, headline: string): SavedStory => ({
  key: `s${i}`, lane: 'rundown', origin: 'reels', url: `https://x.com/${i}`, outlet: 'Outlet', major: null, net: 0.5, lead: null,
  setup: '', headline, highlight: '', names: [], body: 'Short body.', photo: { src: `https://p/${i}.jpg`, credit: 'C', kind: 'scene' },
});
const HEADLINES = ['Plain news one', 'Backfire at the lab', 'Plain news three', 'Backfire again', 'Plain news five'];

const tags = (o: Partial<StoryTags>): StoryTags => ({ version: TAGGER_VERSION, scores: {} as TagScores, irony: false, launch: false, numberStory: false, conflict: false, headlineChars: 30, shortHeadline: true, ...o });
const evidence = (regime = regimeId()): GateEvidence => ({
  regime, taggerVersion: TAGGER_VERSION, threshold: 0.9, createdAt: NOW.toISOString(),
  rows: [
    ...Array.from({ length: 12 }, (_, i) => ({ storyId: `g${i}`, tags: tags({ irony: true }), anyGood: true })),
    ...Array.from({ length: 12 }, (_, i) => ({ storyId: `p${i}`, tags: tags({}), anyGood: i % 2 === 0 })),
  ],
});

/** Jev: "Backfire" headlines are ironic. */
const jev: JevAsk = async (req, meta) => ({
  answers: (meta.version.startsWith('meme-story-tags') ? { backfire: { noul: /Backfire/.test((req.state as { headline: string }).headline) ? 0.9 : 0.1 } } : {}) as JevResult['answers'],
  usage: { input_tokens: 10, output_tokens: 0 },
  model: 'j',
});

/** The meme run: one slate of two memes per queued request, a real PNG for each; records the 90-day ledger it saw. */
function fakeRun(seen: string[][]) {
  return async (db: MemesDb, _r: unknown, renderDir: string) => {
    const { rows: ledger } = await db.query<{ template_id: string }>(`SELECT template_id FROM memes.template_uses`);
    seen.push(ledger.map((r) => r.template_id));
    const { rows } = await db.query<{ id: string; post_id: string }>(`UPDATE memes.requests SET status = 'ok', cost_usd = 0.12 WHERE status = 'requested' RETURNING id::text, post_id`);
    for (const r of rows) {
      const slate = (await db.query<{ id: string }>(`INSERT INTO memes.slates (request_id, kind, stories) VALUES ($1, 'single', '[]'::jsonb) RETURNING id::text`, [r.id])).rows[0]!.id;
      for (const rank of [1, 2]) {
        const file = path.join(renderDir, `${r.id}-${rank}.png`);
        fs.writeFileSync(file, await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#ffffff' } }).composite([{ input: await sharp({ create: { width: 400, height: 300, channels: 3, background: '#336699' } }).png().toBuffer(), top: 500, left: 340 }]).png().toBuffer());
        await db.query(
          `INSERT INTO memes.memes (slate_id, template_id, in_slate, rank, mapping, image_path) VALUES ($1, 'drake', true, $2, $3::jsonb, $4)`,
          [slate, rank, JSON.stringify({ fill: { templateId: 'drake', fills: [{ slot: 'rejected', kind: 'text', text: `Old ${r.post_id}`, factIds: [] }, { slot: 'preferred', kind: 'text', text: 'New', factIds: [] }] } }), file],
        );
      }
    }
  };
}

async function setup() {
  const { query } = await openHubTestDb();
  const stories = HEADLINES.map((h, i) => story(i, h));
  const postId = await insertPost(query, { runId: null, slug: 'lfd-2026-10-13', nyDate: '2026-10-13', ideaIds: [], stories, render: {}, caption: 'c', slideObjects: ['lfd/lfd-2026-10-13/slide-01.jpg'], fitProblems: [], short: false });
  const uploads: string[] = [];
  const seen: string[][] = [];
  const logs: string[] = [];
  const deps: PostMemesDeps = {
    query, create: (async () => { throw new Error('no Claude in tests'); }) as never, jev,
    openRenderer: async () => ({ render: async () => [], close: async () => undefined }),
    fitCheck: async () => ({ ok: true, violations: [], problems: [], slideText: [] }),
    upload: async (p) => { uploads.push(p); },
    fetchBody: async () => null,
    storeSlides: async (slug, render) => (render as { slides: unknown[] }).slides.map((_, i) => `lfd/${slug}/slide-${String(i + 1).padStart(2, '0')}.jpg`),
    now: () => NOW, log: (m) => { logs.push(m); }, capUsd: 1,
    evidence: evidence(), runRequest: fakeRun(seen),
  };
  return { query, postId, deps, uploads, seen, logs };
}

test('a post gets memes on its gated stories: the cover meme, the story moved first, the post row updated', async () => {
  const { query, postId, deps, uploads } = await setup();
  const res = await addMemesToPost(deps, postId);
  assert.equal(res.placed, 2);
  assert.equal(res.gated, 2);
  const { rows } = await query<{ stories: Array<SavedStory & { meme?: { rank: number; role: string; object: string; templateId: string } }>; render: { slides: Array<{ lfdCover?: { meme?: { url: string } }; photoUrl?: string; photoKind?: string }> }; slide_objects: string[] }>(
    `SELECT stories, render, slide_objects FROM lfd.posts WHERE id = $1`, [postId],
  );
  const post = rows[0]!;
  // "Backfire at the lab" (story 2, in the top 3) becomes the cover and leads; "Backfire again" (story 4) keeps its place.
  assert.deepEqual(post.stories.map((s) => s.headline), ['Backfire at the lab', 'Plain news one', 'Plain news three', 'Backfire again', 'Plain news five']);
  assert.deepEqual(post.stories[0]!.meme && { rank: post.stories[0]!.meme.rank, role: post.stories[0]!.meme.role }, { rank: 1, role: 'cover' });
  assert.equal(post.stories[3]!.meme?.role, 'slide');
  assert.deepEqual(uploads.sort(), ['lfd/lfd-2026-10-13/meme-1.png', 'lfd/lfd-2026-10-13/meme-2.png']);
  // The saved render keeps storage paths, never the image data.
  assert.equal(post.render.slides[0]!.lfdCover?.meme?.url, 'storage:lfd/lfd-2026-10-13/meme-1.png');
  assert.ok(!JSON.stringify(post.render).includes('data:image'));
  assert.equal(post.slide_objects.length, 7);
});

test('templates used in posts of the last 90 days are blocked; rejected posts block nothing', async () => {
  const { query, postId, deps, seen } = await setup();
  const old = (status: string, slug: string) => insertPost(query, { runId: null, slug, nyDate: '2026-10-09', ideaIds: [], stories: [{ ...story(9, 'x'), meme: { templateId: status === 'rejected' ? 'tuxedo-pooh' : 'anakin-padme' } }], render: {}, caption: '', slideObjects: [], fitProblems: [], short: false });
  await old('review', 'lfd-2026-10-09');
  const rejected = await old('rejected', 'lfd-2026-10-09-r');
  await query(`UPDATE lfd.posts SET status = 'rejected' WHERE id = $1`, [rejected]);
  await addMemesToPost(deps, postId);
  assert.deepEqual(seen[0], ['anakin-padme']);
});

test('no memes when the evidence is for other code, or when no story passes', async () => {
  const a = await setup();
  const res = await addMemesToPost({ ...a.deps, evidence: evidence('somethingelse') }, a.postId);
  assert.match(res.skipped ?? '', /evidence is for regime/);
  const b = await setup();
  const none = await addMemesToPost({ ...b.deps, evidence: { ...evidence(), threshold: 0.999 } }, b.postId);
  assert.equal(none.placed, 0);
  const { rows } = await b.query<{ stories: SavedStory[] }>(`SELECT stories FROM lfd.posts WHERE id = $1`, [b.postId]);
  assert.equal(rows[0]!.stories[0]!.headline, 'Plain news one', 'the post is untouched');
});

async function claimedRun(query: HubQuery) {
  await requestRun(query, 'manual', 1);
  return (await claimRun(query, NOW))!;
}

function worker(query: HubQuery, memes: CarryOutDeps['memes'], order: string[]): CarryOutDeps {
  return {
    query, now: () => NOW, log: (m) => { order.push(m); },
    engine: async () => ({ query } as unknown as LfdRunDeps),
    run: async (d) => {
      const postId = await insertPost(query, { runId: d.runId!, slug: 'lfd-2026-10-13', nyDate: '2026-10-13', ideaIds: [], stories: [story(1, 'a')], render: {}, caption: '', slideObjects: [], fitProblems: [], short: false });
      await finishRun(query, d.runId!, { status: 'ok', claudeUsd: 0.2, jevUsd: 0.05, record: {} });
      return { ok: true as const, runId: d.runId!, postId, stories: 6, short: false };
    },
    memes,
  };
}

test('addMemesToPost does not generate again for stories that already have a meme', async () => {
  const { query, postId, deps, seen } = await setup();
  await query(`UPDATE lfd.posts SET stories = $2::jsonb WHERE id = $1`, [
    postId,
    JSON.stringify(HEADLINES.map((h, i) => ({ ...story(i, h), ...(i === 1 ? { meme: { templateId: 'drake', memeId: 'e', rank: 1, role: 'slide', position: 2, object: 'x', text: [] } } : {}) }))),
  ]);
  await addMemesToPost(deps, postId);
  assert.equal(seen.length, 1, 'only the Backfire story that did not already have a meme is generated');

  const all = await setup();
  const allId = await insertPost(all.query, {
    runId: null, slug: 'lfd-2026-10-13-all', nyDate: '2026-10-13', ideaIds: [],
    stories: HEADLINES.map((h, i) => ({ ...story(i, h), photoSource: 'meme' as const })),
    render: {}, caption: 'c', slideObjects: [], fitProblems: [], short: false,
  });
  const none = await addMemesToPost(all.deps, allId);
  assert.equal(none.skipped, 'already had memes');
  assert.equal(all.seen.length, 0);
});

test('the worker adds memes after the run and records their spend; a meme failure never fails the run', async () => {
  const { query } = await openHubTestDb();
  const order: string[] = [];
  const run = await claimedRun(query);
  const out = await carryOutLfdRun(worker(query, async () => { order.push('memes'); return { placed: 2, gated: 2, costUsd: 0.4 }; }, order), run);
  assert.equal(out.status, 'ok');
  assert.ok(order.indexOf('memes') < order.indexOf('lfd_run_complete'), 'memes go in before the post is placed');
  const { rows } = await query<{ total: number; memes: { placed: number } }>(`SELECT total_usd AS total, record->'memes' AS memes FROM lfd.runs WHERE id = $1`, [run.id]);
  assert.ok(Math.abs(rows[0]!.total - 0.65) < 1e-9);
  assert.equal(rows[0]!.memes.placed, 2);

  const db2 = await openHubTestDb();
  const run2 = await claimedRun(db2.query);
  const failed = await carryOutLfdRun(worker(db2.query, async () => { throw new Error('boom'); }, []), run2);
  assert.equal(failed.status, 'ok');

  const db3 = await openHubTestDb();
  await db3.query(`INSERT INTO lfd.settings (key, value) VALUES ('memes', 'false'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  let called = false;
  await carryOutLfdRun(worker(db3.query, async () => { called = true; return { placed: 0, gated: 0, costUsd: 0 }; }, []), await claimedRun(db3.query));
  assert.equal(called, false, 'lfd.settings memes = false switches them off');
});
