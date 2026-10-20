/**
 * Last Few Days meme lab: story source, copy briefs, spread cover rules,
 * attachments, and results. Stubbed models; no live call.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { attach, generate, labResults, previewPost, requestBriefs } from '@/lib/memes/api';
import { coerceBodyBrief, generateBriefs, structureFromBody } from '@/lib/memes/brief-from-body';
import { CostMeter } from '@/lib/memes/cost';
import { openLocalMemesDb, type MemesDb } from '@/lib/memes/db';
import {
  briefFromCopy,
  candidateItem,
  isMissingLfd,
  listFinishedPosts,
  storyFromPost,
  upsertLabStories,
} from '@/lib/memes/lfd-source';
import type { MemeRenderer } from '@/lib/memes/render';
import { processNextRequest, type RunDeps } from '@/lib/memes/run';
import { coversAll } from '@/lib/memes/spread';
import type { HubQuery } from '@/lib/social-hub/db';
import type { Mapping } from '@/lib/memes/writer';

import { answerAll, cannedMessage, FIXTURE_BRIEF, FIXTURE_STORY, twoStep } from './fixtures/memes';

const BODY = [
  'Perplexity added a daily limit to its free plan.',
  'Free users get five deep searches a day after the change took effect.',
  'The limit starts Monday and paid plans are unchanged for now.',
  'The company said the cap is meant to keep the free tier sustainable as usage grew.',
  'Users who want more searches are pointed at the paid Pro plan.',
  'That is the first time the free product has had a hard daily ceiling.',
  'Analysts said the move follows a year of rising usage on the free tier.',
  'The company has not said whether the daily number will change later.',
].join(' ');

const longCandidate = {
  key: 'example.com/p',
  refs: ['https://example.com/p'],
  origin: 'carousel' as const,
  headline: 'Perplexity limits its free plan',
  sourceName: 'The Verge',
  url: 'https://example.com/p',
  body: BODY,
  publishedAt: '2026-10-13T12:00:00Z',
  net: null,
  blockbuster: 0,
  firstSeen: null,
  alsoFrom: [],
  major: null,
};

function fakeQuery(handlers: Array<{ match: RegExp; rows: unknown[] }>): HubQuery {
  return async (text) => {
    const h = handlers.find((x) => x.match.test(text));
    if (!h) throw Object.assign(new Error(`unexpected SQL: ${text}`), { code: '42P01' });
    return { rows: h.rows as never[] };
  };
}

async function withDb(fn: (db: MemesDb, deps: RunDeps) => Promise<void>) {
  const { db, pg } = await openLocalMemesDb();
  const renderDir = path.join(process.cwd(), '.memes-local', 'test-renders', `lfd-${process.pid}`);
  const deps: RunDeps = {
    db,
    jev: answerAll(),
    renderer: { render: async (specs) => specs.map(() => ({ png: Buffer.from('png'), problems: [] })), close: async () => {} } satisfies MemeRenderer,
    renderDir,
    loadStory: async (id) => {
      const { loadLabStory } = await import('@/lib/memes/lfd-source');
      return (await loadLabStory(db, id)) ?? (id === FIXTURE_STORY.postId ? FIXTURE_STORY : null);
    },
    loadStories: async (ids) => {
      const { loadLabStories } = await import('@/lib/memes/lfd-source');
      return loadLabStories(db, ids);
    },
    create: (async () => cannedMessage({ story_shape: 'A cap on a free plan.', memes: [] })) as unknown as RunDeps['create'],
  };
  try {
    await fn(db, deps);
  } finally {
    await pg.close();
    fs.rmSync(renderDir, { recursive: true, force: true });
  }
}

test('missing lfd schema is empty, not a crash', async () => {
  assert.equal(isMissingLfd({ code: '42P01' }), true);
  const rows = await listFinishedPosts(fakeQuery([]));
  assert.deepEqual(rows, []);
});

test('finished LFD post stories get a brief from copy and keep the original photo', () => {
  const item = storyFromPost('post-1', '2026-10-14', '2026-10-14T12:00:00Z', 'review', {
    key: 'example.com/p',
    headline: 'Perplexity limits its free plan',
    setup: 'The free tier just changed.',
    body: BODY,
    names: ['Perplexity'],
    url: 'https://example.com/p',
    outlet: 'The Verge',
    origin: 'carousel',
    photo: { src: 'https://cdn.example.com/photo.jpg', credit: 'The Verge', kind: 'scene' },
  });
  assert.equal(item.group, 'post');
  assert.equal(item.hasBrief, true);
  assert.equal(item.originalPhoto?.url, 'https://cdn.example.com/photo.jpg');
  const brief = briefFromCopy({ headline: item.title, body: item.body, outlet: item.outlet, url: item.url, names: ['Perplexity'] });
  assert.ok(brief.facts.length >= 1);
  assert.equal(brief.the_news.text, item.title);
  assert.equal(brief.subjects[0]?.name, 'Perplexity');
});

test('candidates have no brief until one is generated', () => {
  const item = candidateItem(longCandidate);
  assert.equal(item.group, 'candidate');
  assert.equal(item.hasBrief, false);
  assert.equal(item.thin, false);
});

test('upsert + load: thin post copy is a loadable story; a long post waits for its body brief (ME-107); a candidate stays brief-less', () =>
  withDb(async (db) => {
    const post = (key: string, body: string) => storyFromPost(`post-${key}`, '2026-10-14', '2026-10-14T12:00:00Z', 'review', {
      key: `example.com/${key}`, headline: 'Perplexity limits its free plan', body, url: `https://example.com/${key}`,
      photo: { src: 'https://cdn.example.com/photo.jpg', credit: 'The Verge', kind: 'scene' },
    });
    const thin = post('thin', 'Perplexity added a daily limit to its free plan. Free users get 5 deep searches a day.');
    const long = post('long', BODY.padEnd(600, ' More of the article.'));
    const cand = candidateItem({ ...longCandidate, key: 'example.com/q', url: 'https://example.com/q', headline: 'OpenAI ships an agent' });
    await upsertLabStories(db, [thin, long, cand]);
    const { loadLabStory, listedFromDb } = await import('@/lib/memes/lfd-source');
    assert.ok(await loadLabStory(db, thin.id));
    assert.equal(await loadLabStory(db, long.id), null, 'a copy brief with a readable body is not used for memes');
    assert.equal((await listedFromDb(db)).find((x) => x.id === long.id)!.hasBrief, false, 'so the lab offers Generate briefs');
    assert.equal(await loadLabStory(db, cand.id), null);
  }));

test('structure-from-body: a canned submit_brief is validated and saved, in parallel', () =>
  withDb(async (db) => {
    await upsertLabStories(db, [candidateItem(longCandidate), candidateItem({ ...longCandidate, key: 'example.com/r', url: 'https://example.com/r', headline: 'Second story' })]);
    const create = (async () => cannedMessage({
      ...FIXTURE_BRIEF,
    }, {}, 'submit_brief')) as unknown as RunDeps['create'];
    const { jobs, spent } = await generateBriefs(db, ['example.com/p', 'example.com/r'], 'from-body', create);
    assert.deepEqual(jobs.map((j) => j.error ?? 'ok'), ['ok', 'ok']);
    assert.equal(jobs.filter((j) => j.ok).length, 2);
    assert.ok(spent >= 0);
    const { loadLabStory } = await import('@/lib/memes/lfd-source');
    assert.ok(await loadLabStory(db, 'example.com/p'));
  }));

test('thin bodies get a copy brief without a model call', () =>
  withDb(async (db) => {
    await upsertLabStories(db, [candidateItem({ ...longCandidate, key: 'thin', body: 'Too short.', headline: 'Tiny' })]);
    const create = (async () => { throw new Error('should not call'); }) as unknown as RunDeps['create'];
    const { jobs } = await generateBriefs(db, ['thin'], 'from-body', create);
    assert.equal(jobs[0]!.ok, true);
    assert.equal(jobs[0]!.thin, true);
    const { loadLabStory } = await import('@/lib/memes/lfd-source');
    assert.ok(await loadLabStory(db, 'thin'));
  }));

test('coerceBodyBrief fills omitted sources/plot and drops extra fields', () => {
  const brief = coerceBodyBrief({
    facts: [{ id: 'F1', text: 'Perplexity added a daily limit.', extra: 'drop me' }],
    the_news: { text: 'Perplexity limited the free plan.', ids: ['F9'] },
    plot: [{ beat: 'CONFLICT', text: 'Users vs the cap.', ids: ['F1'] }, { beat: 'SETUP', text: 'Free plan.', ids: ['F1'] }],
  }, { headline: 'Perplexity limits its free plan', outlet: 'The Verge', url: 'https://example.com/p' });
  assert.equal(brief.facts[0]!.sources[0], 'The Verge');
  assert.equal(brief.sources[0]!.outlet, 'The Verge');
  assert.equal(brief.plot?.[0]?.beat, 'SETUP');
  assert.deepEqual(brief.the_news.ids, []);
  assert.ok(!('extra' in brief.facts[0]!));
});

test('a failed structure-from-body call still saves a copy brief', () =>
  withDb(async (db) => {
    await upsertLabStories(db, [candidateItem(longCandidate)]);
    const create = (async () => { throw new Error('malformed-output'); }) as unknown as RunDeps['create'];
    const { jobs } = await generateBriefs(db, ['example.com/p'], 'from-body', create);
    assert.equal(jobs[0]!.ok, true);
    const { loadLabStory } = await import('@/lib/memes/lfd-source');
    assert.ok(await loadLabStory(db, 'example.com/p'));
  }));

test('requestBriefs: empty selection is 400; reporter is one story', () =>
  withDb(async (db) => {
    await assert.rejects(requestBriefs(db, {}, (async () => cannedMessage(FIXTURE_BRIEF, {}, 'submit_brief')) as never), /at least one story/);
    await assert.rejects(requestBriefs(db, { storyIds: ['a', 'b'], mode: 'reporter' }, (async () => cannedMessage(FIXTURE_BRIEF, {}, 'submit_brief')) as never), /one story/);
  }));

async function insertMeme(db: MemesDb, kind: 'single' | 'spread', templateId = 'drake'): Promise<string> {
  const req = (await db.query<{ id: string }>(`INSERT INTO memes.requests (kind, requested_by, status) VALUES ($1, 'lucas', 'ok') RETURNING id`, [kind])).rows[0]!;
  const slate = (await db.query<{ id: string }>(`INSERT INTO memes.slates (request_id, kind, stories, shape) VALUES ($1, $2, '[]'::jsonb, '{}'::jsonb) RETURNING id`, [req.id, kind])).rows[0]!;
  const meme = (await db.query<{ id: string }>(
    `INSERT INTO memes.memes (slate_id, template_id, in_slate, rank, situation_id, mapping, judges, image_path)
     VALUES ($1, $2, true, 1, 'AS-04', '{}'::jsonb, '{}'::jsonb, NULL) RETURNING id`,
    [slate.id, templateId],
  )).rows[0]!;
  return meme.id;
}

test('spread generate needs two briefed stories; cover attach only accepts a spread meme', () =>
  withDb(async (db) => {
    const source = {
      list: async () => [FIXTURE_STORY],
      load: async (id: string) => (id === FIXTURE_STORY.postId ? FIXTURE_STORY : null),
      loadMany: async (ids: string[]) => ids.flatMap((id) => (id === FIXTURE_STORY.postId ? [FIXTURE_STORY] : [])),
    };
    await assert.rejects(generate(db, { kind: 'spread', storyIds: [FIXTURE_STORY.postId] }, 'lucas', source), /at least two/);
    const a = { ...FIXTURE_STORY, postId: 's-a', title: 'OpenAI ships an agent', postRef: 'lfd-1' };
    const b = { ...FIXTURE_STORY, postId: 's-b', title: 'Anthropic ships an agent', postRef: 'lfd-1' };
    const two = {
      list: async () => [a, b],
      load: async (id: string) => (id === 's-a' ? a : id === 's-b' ? b : null),
      loadMany: async (ids: string[]) => ids.flatMap((id) => (id === 's-a' ? [a] : id === 's-b' ? [b] : [])),
    };
    const { requestId } = await generate(db, { kind: 'spread', storyIds: ['s-a', 's-b'] }, 'lucas', two);
    const row = (await db.query<{ kind: string; detail: { storyIds: string[] } }>(`SELECT kind, detail FROM memes.requests WHERE id = $1`, [requestId])).rows[0]!;
    assert.equal(row.kind, 'spread');
    assert.deepEqual(row.detail.storyIds, ['s-a', 's-b']);

    await upsertLabStories(db, [
      storyFromPost('lfd-1', '2026-10-14', '2026-10-14T00:00:00Z', 'review', { key: 's-a', headline: a.title, body: BODY, photo: { src: 'https://cdn.example.com/a.jpg', credit: 'A', kind: 'scene' } }),
      storyFromPost('lfd-1', '2026-10-14', '2026-10-14T00:00:00Z', 'review', { key: 's-b', headline: b.title, body: BODY, photo: { src: 'https://cdn.example.com/b.jpg', credit: 'B', kind: 'scene' } }),
    ]);

    const spreadId = await insertMeme(db, 'spread');
    const singleId = await insertMeme(db, 'single');
    await attach(db, { postRef: 'lfd-1', memeId: spreadId, role: 'cover' });
    const preview = await previewPost(db, 'lfd-1');
    assert.equal(preview.coverIsMeme, true);
    assert.equal(preview.slides[0]!.image.kind, 'meme');
    assert.equal(preview.mosaic.length, 0);

    await assert.rejects(attach(db, { postRef: 'lfd-1', memeId: singleId, role: 'cover' }), /spread meme/);
    await attach(db, { postRef: 'lfd-1', memeId: singleId, role: 'slide', storyKey: 's-a' });
    const after = await previewPost(db, 'lfd-1');
    assert.equal(after.slides.find((s) => s.storyKey === 's-a')?.image.kind, 'meme');
    const other = after.slides.find((s) => s.storyKey === 's-b');
    assert.equal(other?.image.kind, 'photo');
    assert.equal(other?.image.url, 'https://cdn.example.com/b.jpg');
  }));

test('cover mosaic uses original photos when the cover is not a meme', () =>
  withDb(async (db) => {
    await upsertLabStories(db, [
      storyFromPost('lfd-2', '2026-10-14', '2026-10-14T00:00:00Z', 'review', { key: 'x', headline: 'One', body: BODY, photo: { src: 'https://cdn.example.com/x.jpg', credit: 'X', kind: 'scene' } }),
      storyFromPost('lfd-2', '2026-10-14', '2026-10-14T00:00:00Z', 'review', { key: 'y', headline: 'Two', body: BODY, photo: { src: 'https://cdn.example.com/y.jpg', credit: 'Y', kind: 'scene' } }),
    ]);
    const preview = await previewPost(db, 'lfd-2');
    assert.equal(preview.coverIsMeme, false);
    assert.deepEqual(preview.mosaic.map((p) => p.url), ['https://cdn.example.com/x.jpg', 'https://cdn.example.com/y.jpg']);
  }));

test('coversAll: a mapping must cite every story letter', () => {
  const stories = [
    { ...FIXTURE_STORY, postId: 'a' },
    { ...FIXTURE_STORY, postId: 'b' },
  ];
  const one: Mapping = { templateId: 'drake', situationId: 'AS-04', relation: 'x', fill: { templateId: 'drake', fills: [{ slot: 'rejected', kind: 'text', text: 'A', factIds: ['A.F1'] }, { slot: 'preferred', kind: 'text', text: 'A2', factIds: ['A.F2'] }] }, why: {} };
  const both: Mapping = { templateId: 'drake', situationId: 'AS-04', relation: 'x', fill: { templateId: 'drake', fills: [{ slot: 'rejected', kind: 'text', text: 'A', factIds: ['A.F1'] }, { slot: 'preferred', kind: 'text', text: 'B', factIds: ['B.F1'] }] }, why: {} };
  assert.equal(coversAll(one, stories), false);
  assert.equal(coversAll(both, stories), true);
});

test('results: pass rate by template and kind', () =>
  withDb(async (db, deps) => {
    const source = { list: async () => [FIXTURE_STORY], load: async () => FIXTURE_STORY };
    const { requestId } = await generate(db, { kind: 'single', postId: FIXTURE_STORY.postId }, 'lucas', source);
    deps.create = twoStep() as unknown as RunDeps['create'];
    await processNextRequest(deps);
    const results = await labResults(db);
    assert.ok(results.totals.memes >= 2);
    assert.ok(results.byKind.some((k) => k.key === 'single'));
    assert.ok(results.byTemplate.some((k) => k.key === 'buff-doge-cheems'));
    assert.deepEqual(results.byTurnType.map((k) => k.key).sort(), ['fine-print', 'the-fall', 'viewers-day']);
  }));

test('structureFromBody reads submit_brief and charges the meter', async () => {
  const meter = new CostMeter(0.5);
  const { brief } = await structureFromBody(
    (async () => cannedMessage({ ...FIXTURE_BRIEF }, { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 800 }, 'submit_brief')) as unknown as (p: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>,
    { headline: 'Perplexity limits its free plan', body: BODY, outlet: 'The Verge', url: 'https://example.com/p' },
    meter,
  );
  assert.equal(brief.the_news.text, FIXTURE_BRIEF.the_news.text);
  assert.ok(meter.spent > 0);
});
