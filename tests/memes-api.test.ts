/**
 * Meme lab M5 (planning/Memes/BUILD_PLAN.md): the lab's handlers on PGlite,
 * the route's session check, and a server render of the page. Stubbed runs;
 * no live call (CLAUDE.md Rule 1).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { ApiError, generate, getRun, labResults, listRuns, listStories, memeImage, pick, REASON_TAGS, REJECT_TAGS, WORKED_TAGS, type StorySource } from '@/lib/memes/api';
import { openLocalMemesDb, type MemesDb } from '@/lib/memes/db';
import type { MemeRenderer } from '@/lib/memes/render';
import { memesRoute } from '@/lib/memes/route';
import { MEME_PIPELINE, processNextRequest, type RunDeps } from '@/lib/memes/run';
import type { JevAsk } from '@/lib/social/jev/client';

import { answerAll, FIXTURE_STORY, twoStep } from './fixtures/memes';

const SECOND = { ...FIXTURE_STORY, postId: 'post-2', title: 'OpenAI ships an agent' };
const source: StorySource = {
  list: async () => [
    { postId: FIXTURE_STORY.postId, title: FIXTURE_STORY.title, status: 'review', createdAt: FIXTURE_STORY.createdAt },
    { postId: SECOND.postId, title: SECOND.title, status: 'review', createdAt: SECOND.createdAt },
  ],
  load: async (id) => (id === FIXTURE_STORY.postId ? FIXTURE_STORY : id === SECOND.postId ? SECOND : null),
  loadMany: async (ids) => ids.flatMap((id) => (id === FIXTURE_STORY.postId ? [FIXTURE_STORY] : id === SECOND.postId ? [SECOND] : [])),
};

const jev: JevAsk = answerAll();

const renderer: MemeRenderer = { render: async (specs) => specs.map(() => ({ png: Buffer.from('png'), problems: [] })), close: async () => {} };

async function withDb(fn: (db: MemesDb, deps: RunDeps) => Promise<void>) {
  const { db, pg } = await openLocalMemesDb();
  const renderDir = path.join(process.cwd(), '.memes-local', 'test-renders', String(process.pid));
  const deps: RunDeps = {
    db, jev, renderer, renderDir, loadStory: source.load,
    create: twoStep() as unknown as (p: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>,
  };
  try {
    await fn(db, deps);
  } finally {
    await pg.close();
    fs.rmSync(renderDir, { recursive: true, force: true });
  }
}

test('generate: needs a story with a brief, queues the click, and refuses a fourth waiting run', () =>
  withDb(async (db) => {
    await assert.rejects(generate(db, { kind: 'single' }, 'lucas', source), (e: unknown) => e instanceof ApiError && e.status === 400);
    await assert.rejects(generate(db, { kind: 'single', postId: 'nope' }, 'lucas', source), (e: unknown) => e instanceof ApiError && e.status === 404);
    const { requestId } = await generate(db, { kind: 'single', postId: FIXTURE_STORY.postId }, 'lucas', source);
    const row = (await db.query<{ status: string; requested_by: string }>(`SELECT status, requested_by FROM memes.requests WHERE id = $1`, [requestId])).rows[0]!;
    assert.deepEqual(row, { status: 'requested', requested_by: 'lucas' });
    await assert.rejects(generate(db, { kind: 'landscape' }, 'lucas', source), (e: unknown) => e instanceof ApiError && e.status === 400);
    await generate(db, { kind: 'landscape', storyIds: [FIXTURE_STORY.postId, SECOND.postId] }, 'lucas', source);
    await generate(db, { kind: 'landscape', storyIds: [FIXTURE_STORY.postId, SECOND.postId] }, 'lucas', source);
    await assert.rejects(generate(db, { kind: 'landscape', storyIds: [FIXTURE_STORY.postId, SECOND.postId] }, 'lucas', source), (e: unknown) => e instanceof ApiError && e.status === 429);
  }));

test('generate: one-story mode queues a run per selected story', () =>
  withDb(async (db) => {
    const { requestId, requestIds } = await generate(db, { kind: 'single', storyIds: [FIXTURE_STORY.postId, SECOND.postId] }, 'lucas', source);
    assert.equal(requestIds.length, 2);
    assert.equal(requestId, requestIds[0]);
    const rows = (await db.query<{ post_id: string }>(`SELECT post_id FROM memes.requests WHERE kind = 'single' ORDER BY requested_at`)).rows;
    assert.deepEqual(rows.map((r) => r.post_id), [FIXTURE_STORY.postId, SECOND.postId]);
    await assert.rejects(generate(db, { kind: 'single', storyIds: [FIXTURE_STORY.postId, 'nope'] }, 'lucas', source), (e: unknown) => e instanceof ApiError && e.status === 404);
  }));

test('runs: a finished run reads back with its slate, scores, lines and images', () =>
  withDb(async (db, deps) => {
    const { requestId } = await generate(db, { kind: 'single', postId: FIXTURE_STORY.postId }, 'lucas', source);
    await processNextRequest(deps);
    const runs = await listRuns(db);
    assert.equal(runs[0]!.title, FIXTURE_STORY.title);
    assert.deepEqual({ slate: runs[0]!.slate, graded: runs[0]!.graded }, { slate: 3, graded: 0 });
    const run = await getRun(db, requestId);
    assert.equal(run.status, 'ok');
    assert.deepEqual((run.shape?.turns as Array<{ id: string }>).map((x) => x.id), ['T1', 'T2', 'T3']);
    const slate = run.memes.filter((m) => m.inSlate);
    assert.equal(slate.length, 3);
    assert.ok(slate.every((m) => m.hasImage && m.lines.length > 0 && typeof m.judges.score === 'number' && m.turnId && m.turnType));
    const all = run.memes;
    assert.match(all.find((m) => m.templateId === 'hide-the-pain')!.lines.find((l) => l.slot === 'smiler')!.says, /label: perplexity/);
    assert.equal((await memeImage(db, slate[0]!.id)).toString(), 'png');
    await assert.rejects(getRun(db, '00000000-0000-0000-0000-000000000000'), (e: unknown) => e instanceof ApiError && e.status === 404);
  }));

test('picks: each meme keeps its rating; a reject without a rating still needs a tag (ME-64)', () =>
  withDb(async (db, deps) => {
    const { requestId } = await generate(db, { kind: 'single', postId: FIXTURE_STORY.postId }, 'lucas', source);
    await processNextRequest(deps);
    const [a, b, c] = (await getRun(db, requestId)).memes.filter((m) => m.inSlate);
    await pick(db, { memeId: a!.id, rating: 4 }, 'lucas');
    await pick(db, { memeId: b!.id, rating: 2 }, 'lucas');
    await assert.rejects(pick(db, { memeId: c!.id, verdict: 'rejected', tags: ['bogus'] }, 'lucas'), /at least one tag/);
    await pick(db, { memeId: c!.id, verdict: 'rejected', tags: ['not-funny', 'bogus'], note: '  too obvious  ' }, 'lucas');
    const memes = (await getRun(db, requestId)).memes;
    assert.deepEqual(memes.find((m) => m.id === a!.id)!.pick, { verdict: 'picked', tags: [], note: null, rating: 4 });
    assert.deepEqual(memes.find((m) => m.id === b!.id)!.pick, { verdict: 'rejected', tags: [], note: null, rating: 2 });
    assert.deepEqual(memes.find((m) => m.id === c!.id)!.pick, { verdict: 'rejected', tags: ['not-funny'], note: 'too obvious', rating: null });
    assert.deepEqual(Object.keys(REJECT_TAGS), ['not-funny', 'wrong-template', 'inaccurate', 'unclear', 'off-brand', 'too-political']);
    assert.equal((await getRun(db, requestId)).pipeline, MEME_PIPELINE);
    const listed = await listRuns(db);
    assert.equal(listed[0]!.graded, 3, 'every slate meme that was picked or rated counts as graded');
    const stories = await listStories(db, source);
    assert.equal(stories.find((s) => s.id === FIXTURE_STORY.postId)?.generated, 1);
    assert.equal(stories.find((s) => s.id === SECOND.postId)?.generated, 0);
  }));

test('pick: reason chips ride with the rating, survive a rating change, and only fit their rating', () =>
  withDb(async (db, deps) => {
    const { requestId } = await generate(db, { kind: 'single', postId: FIXTURE_STORY.postId }, 'lucas', source);
    await processNextRequest(deps);
    const m = (await getRun(db, requestId)).memes.find((x) => x.inSlate)!;
    await pick(db, { memeId: m.id, rating: 2, tags: ['no-turn', 'too-long', 'sharp-turn'], note: 'flat' }, 'lucas');
    let p = (await getRun(db, requestId)).memes.find((x) => x.id === m.id)!.pick!;
    assert.deepEqual(p, { verdict: 'rejected', tags: ['no-turn', 'too-long'], note: 'flat', rating: 2 }, 'a worked chip does not fit a 2');
    await pick(db, { memeId: m.id, rating: 1 }, 'lucas');
    p = (await getRun(db, requestId)).memes.find((x) => x.id === m.id)!.pick!;
    assert.deepEqual(p, { verdict: 'rejected', tags: ['no-turn', 'too-long'], note: 'flat', rating: 1 }, 'a rating alone keeps the chips and the note');
    await pick(db, { memeId: m.id, rating: 4 }, 'lucas');
    p = (await getRun(db, requestId)).memes.find((x) => x.id === m.id)!.pick!;
    assert.deepEqual(p, { verdict: 'picked', tags: [], note: 'flat', rating: 4 }, 'reason chips drop when the rating turns good');
    await pick(db, { memeId: m.id, rating: 4, tags: ['sharp-turn', 'short'] }, 'lucas');
    const r = await labResults(db);
    assert.deepEqual(r.totals.rated, 1);
    assert.deepEqual(r.byVersion.map((b) => [b.key, b.rated, b.good, b.awesome]), [[MEME_PIPELINE, 1, 1, 1]]);
    assert.deepEqual(r.byReason.map((b) => b.key).sort(), ['sharp-turn', 'short']);
    assert.ok(Object.keys(REASON_TAGS).includes('obscure-name') && Object.keys(WORKED_TAGS).includes('sharp-turn'));
  }));

test('listStories: a landscape run marks every selected story as generated', () =>
  withDb(async (db) => {
    const queued = await listStories(db, source);
    assert.equal(queued.find((s) => s.id === FIXTURE_STORY.postId)?.generated, 0);
    await generate(db, { kind: 'landscape', storyIds: [FIXTURE_STORY.postId, SECOND.postId] }, 'lucas', source);
    const waiting = await listStories(db, source);
    assert.equal(waiting.find((s) => s.id === FIXTURE_STORY.postId)?.generating, 1);
    assert.equal(waiting.find((s) => s.id === SECOND.postId)?.generating, 1);
    await db.query(`UPDATE memes.requests SET status = 'ok' WHERE kind = 'landscape'`);
    const done = await listStories(db, source);
    assert.equal(done.find((s) => s.id === FIXTURE_STORY.postId)?.generated, 1);
    assert.equal(done.find((s) => s.id === SECOND.postId)?.generated, 1);
    assert.equal(done.find((s) => s.id === FIXTURE_STORY.postId)?.generating, 0);
  }));

test('image: never serves a file outside the lab folder', () =>
  withDb(async (db, deps) => {
    const { requestId } = await generate(db, { kind: 'single', postId: FIXTURE_STORY.postId }, 'lucas', source);
    await processNextRequest(deps);
    const m = (await getRun(db, requestId)).memes[0]!;
    await db.query(`UPDATE memes.memes SET image_path = '.env.local' WHERE id = $1`, [m.id]);
    await assert.rejects(memeImage(db, m.id), (e: unknown) => e instanceof ApiError && e.status === 404);
  }));

test('route: no session, no access', async () => {
  const res = await memesRoute(async () => 'secret', { session: async () => null, db: async () => { throw new Error('never opened'); } });
  assert.equal(res.status, 401);
  const ok = await memesRoute(async ({ email }) => ({ email }), { session: async () => ({ email: 'lucas@example.com' }), db: async () => ({}) as MemesDb });
  assert.deepEqual(await ok.json(), { email: 'lucas@example.com' });
  const err = await memesRoute(async () => { throw new ApiError(409, 'busy'); }, { session: async () => ({ email: 'x' }), db: async () => ({}) as MemesDb });
  assert.deepEqual([err.status, await err.json()], [409, { error: 'busy' }]);
});

test('page: the lab renders on the server with its controls', async () => {
  const React = await import('react');
  (globalThis as { React?: unknown }).React = React; // tsx compiles JSX to React.createElement, as the Stories renderer does
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { MemeLab } = await import('@/app/memes/lab/meme-lab');
  const html = renderToStaticMarkup(React.createElement(MemeLab, { reasonTags: REASON_TAGS, workedTags: WORKED_TAGS, capUsd: 0.25 }));
  assert.match(html, /Meme lab/);
  assert.match(html, /Last Few Days/);
  assert.match(html, /Nothing publishes/);
  assert.match(html, /Generate/);
  assert.match(html, /queues a separate meme for each/);
  assert.match(html, /\$0\.250/);
  assert.match(html, /Blind grading/);
});
