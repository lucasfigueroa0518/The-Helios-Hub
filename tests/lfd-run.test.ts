// tests/lfd-run.test.ts
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { runLastFewDays, type LfdRunDeps } from '@/lib/lfd/run';
import type { JevAsk, JevResult } from '@/lib/social/jev/client';
import type { PhotoFinder } from '@/lib/stories/photos';

import { openHubTestDb } from './fixtures/social-hub/pglite';
import { resetSeed, seedCarouselRun, seedReelsIdea, seedScore } from './fixtures/lfd/seed';

beforeEach(() => resetSeed());

const NOW = new Date('2026-10-13T07:00:00Z'); // Tuesday 3:00 AM NY

/** Writer stub: echoes every story in the material with valid copy; `bad` keys get a headline the fact check rejects. */
function writerStub(opts: { setup?: string; failAfter?: number } = {}) {
  let calls = 0;
  const bad = new Set<string>();
  const create = async (p: Anthropic.MessageCreateParamsNonStreaming) => {
    calls += 1;
    if (opts.failAfter !== undefined && calls > opts.failAfter) {
      return { id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'refusal', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, content: [{ type: 'text', text: 'no' }] } as unknown as Anthropic.Message;
    }
    const user = String((p.messages.at(-1) as { content: unknown }).content);
    const material = JSON.parse(user.slice(user.indexOf('<material>') + 10, user.indexOf('</material>'))) as { stories: Array<{ key: string; headline: string }> };
    const stories = material.stories.map((s) => ({
      key: s.key, setup: opts.setup ?? '', headline: bad.has(s.key) ? `UNSUPPORTED ${s.key}` : `Story ${s.headline.slice(0, 40)}`, highlight: '', names: [],
      body: 'It happened this week. The company says more is coming', photo: { kind: 'company', query: s.headline, subjects: [], alts: [] },
    }));
    return { id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, content: [{ type: 'tool_use', id: `t${calls}`, name: 'submit_rundown', input: { stories } }] } as unknown as Anthropic.Message;
  };
  return { create, calls: () => calls };
}

const jev = (major: (headline: string) => number): JevAsk => async (req, meta): Promise<JevResult> => {
  const usage = { input_tokens: 10, output_tokens: 0 };
  if (meta.version.startsWith('major-news')) {
    const s = major((req.state as { headline: string }).headline);
    return { answers: { happened: { noul: s }, news_kind: { noul: s }, blockbuster_entity: { noul: s }, global_relevance: { noul: s }, political_relevance: { noul: s }, speculative: { noul: 0 } }, usage, model: 's' };
  }
  if (meta.version.startsWith('md-grounding')) {
    const h = (req.state as { headline: string }).headline;
    return { answers: { supported: { noul: h.includes('UNSUPPORTED') ? 0.1 : 0.9 } }, usage, model: 's' };
  }
  return { answers: { same_event: { noul: 0.1 } }, usage, model: 's' };
};

const photos = (noPhotoFor: (query: string) => boolean = () => false): PhotoFinder => ({
  usd: 0,
  find: async () => null,
  findSet: async (reqs) => reqs.map((r, i) => (noPhotoFor(r.query) ? null : { src: `https://p/${encodeURIComponent(r.query)}-${i}.jpg`, credit: 'C', kind: 'scene' })),
});

async function deps(over: Partial<LfdRunDeps> = {}): Promise<LfdRunDeps> {
  const query = over.query ?? (await openHubTestDb()).query;
  if (!over.query) {
    for (let i = 0; i < 8; i++) {
      const idea = await seedReelsIdea(query, { headline: `Niche Thing ${i} Happens`, url: `https://n.com/${i}` });
      await seedScore(query, idea, { nyDate: '2026-10-11', origin: 'timely', net: 0.9 - i / 20 });
    }
    await seedCarouselRun(query, '2026-10-12T07:00:00Z', [{ id: 'https://big.com/haiku', headline: 'Anthropic Releases Claude Haiku 5.5', source: 'The Verge' }]);
  }
  const uploads: string[] = [];
  return {
    query,
    jev: jev((h) => (h.includes('Haiku') ? 1 : 0)),
    create: writerStub().create,
    photos: photos(),
    fetchFeeds: async () => [],
    fetchBody: async () => null,
    fitCheck: async (_p, opts) => {
      if (opts?.screenshotDir) {
        const fs = await import('node:fs/promises');
        const sharp = (await import('sharp')).default;
        const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } }).png().toBuffer();
        for (let i = 1; i <= _p.slides.length; i++) await fs.writeFile(`${opts.screenshotDir}/slide-slide-${String(i).padStart(2, '0')}.png`, png);
      }
      return { ok: true, violations: [], problems: [], slideText: [] };
    },
    upload: async (p) => { uploads.push(p); },
    now: NOW,
    trigger: 'manual',
    capUsd: 1,
    spend: () => ({ claudeUsd: 0.1, jevUsd: 0.01 }),
    ...over,
  };
}

test('a run picks the major headline first, fills to 6, and saves a review post', async () => {
  const d = await deps();
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  const { rows } = await d.query<{ status: string; stories: Array<{ headline: string; lane: string }>; slide_objects: string[]; short: boolean; idea_ids: string[] }>(`SELECT status, stories, slide_objects, short, idea_ids FROM lfd.posts`);
  assert.equal(rows[0]!.status, 'review');
  assert.equal(rows[0]!.stories.length, 6);
  assert.equal(rows[0]!.stories[0]!.lane, 'major');
  assert.match(rows[0]!.stories[0]!.headline, /Haiku/);
  assert.equal(rows[0]!.slide_objects.length, 8);
  assert.ok(rows[0]!.slide_objects.every((p) => p.startsWith('lfd/lfd-2026-10-13/')));
  assert.ok(rows[0]!.idea_ids.includes('https://big.com/haiku'));
  assert.equal(rows[0]!.short, false);
});

test('a story that fails the fact check twice is replaced by the next in line', async () => {
  const w = writerStub();
  const d = await deps({
    create: w.create,
    jev: async (req, meta) => {
      if (meta.version.startsWith('md-grounding') && meta.subjectId.endsWith('n.com/0')) return { answers: { supported: { noul: 0.1 } }, usage: { input_tokens: 1, output_tokens: 0 }, model: 's' };
      return jev(() => 0)(req, meta);
    },
  });
  const res = await runLastFewDays(d);
  assert.ok(res.ok);
  const { rows } = await d.query<{ stories: Array<{ key: string }> }>(`SELECT stories FROM lfd.posts`);
  assert.ok(!rows[0]!.stories.some((s) => s.key.endsWith('n.com/0')));
  assert.equal(rows[0]!.stories.length, 6);
});

test('a thin body is fetched; still thin means the story is dropped and replaced', async () => {
  const d = await deps();
  await d.query(`UPDATE reels.sources SET body = 'teaser' WHERE canonical_url = 'https://n.com/1'`);
  const res = await runLastFewDays({ ...d, fetchBody: async () => 'still short' });
  assert.ok(res.ok);
  const { rows } = await d.query<{ stories: Array<{ key: string }> }>(`SELECT stories FROM lfd.posts`);
  assert.ok(!rows[0]!.stories.some((s) => s.key.endsWith('n.com/1')));
});

test('ideas used by an earlier post are not used again', async () => {
  const d = await deps();
  const first = await runLastFewDays(d);
  assert.ok(first.ok);
  const second = await runLastFewDays({ ...d, now: new Date('2026-10-16T07:00:00Z') });
  const { rows } = await d.query<{ idea_ids: string[] }>(`SELECT idea_ids FROM lfd.posts ORDER BY ny_date`);
  assert.ok(second.ok, JSON.stringify(second));
  const overlap = rows[1]!.idea_ids.filter((id) => rows[0]!.idea_ids.includes(id));
  assert.deepEqual(overlap, []);
});

test('fewer than 5 stories still posts, marked short', async () => {
  const { query } = await openHubTestDb();
  for (let i = 0; i < 3; i++) {
    const idea = await seedReelsIdea(query, { headline: `Only ${i}`, url: `https://o.com/${i}` });
    await seedScore(query, idea, { nyDate: '2026-10-12', origin: 'timely', net: 0.5 });
  }
  const d = await deps({ query });
  const res = await runLastFewDays(d);
  assert.ok(res.ok);
  assert.equal(res.short, true);
});

const failFirst = (substr: string): JevAsk => async (req, meta) => {
  if (meta.version.startsWith('md-grounding') && meta.subjectId.includes(substr)) return { answers: { supported: { noul: 0.1 } }, usage: { input_tokens: 1, output_tokens: 0 }, model: 's' };
  return jev((h) => (h.includes('Haiku') ? 1 : 0))(req, meta);
};

test('a post carries at most 2 setups across rounds, on the two earliest slides', async () => {
  // n.com/4 is not among the first two picks (so it holds no setup) and fails the fact check twice,
  // so round 2 writes a replacement that also comes back with a setup: 3 raw setups, 2 allowed.
  const w = writerStub({ setup: 'Setup:' });
  const d = await deps({ create: w.create, jev: failFirst('n.com/4') });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  assert.ok(w.calls() >= 3, `expected a replacement round, got ${w.calls()} writer calls`);
  const { rows } = await d.query<{ stories: Array<{ key: string; setup: string }> }>(`SELECT stories FROM lfd.posts`);
  const stories = rows[0]!.stories;
  assert.ok(!stories.some((s) => s.key.endsWith('n.com/4')));
  assert.deepEqual(stories.map((s) => s.setup !== ''), stories.map((_, i) => i < 2));
  assert.equal(stories.at(-1)!.setup, '');
});

test('a write failure in a replacement round still posts what is ready', async () => {
  const w = writerStub({ failAfter: 1 });
  const d = await deps({ create: w.create, jev: failFirst('n.com/0') });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  const { rows } = await d.query<{ record: { writeFailure?: string } }>(`SELECT record FROM lfd.runs WHERE id = $1`, [res.runId]);
  assert.ok(rows[0]!.record.writeFailure);
  const posts = await d.query<{ n: number }>(`SELECT count(*)::int AS n FROM lfd.posts`);
  assert.equal(posts.rows[0]!.n, 1);
});

test('the safety net counts only eligible stories', async () => {
  const { query } = await openHubTestDb();
  for (let i = 0; i < 3; i++) {
    const idea = await seedReelsIdea(query, { headline: `In Window ${i}`, url: `https://w.com/${i}` });
    await seedScore(query, idea, { nyDate: '2026-10-11', origin: 'timely', net: 0.5 });
  }
  for (let i = 0; i < 3; i++) {
    const idea = await seedReelsIdea(query, { headline: `Earlier ${i}`, url: `https://e.com/${i}` });
    await seedScore(query, idea, { nyDate: `2026-10-0${9 - i}`, origin: 'timely', net: 0.5 });
  }
  await seedCarouselRun(query, '2026-10-12T07:00:00Z', [
    { id: 'https://c.com/1', headline: 'Minor Carousel One', source: 'The Verge' },
    { id: 'https://c.com/2', headline: 'Minor Carousel Two', source: 'The Verge' },
  ]);
  const d = await deps({ query });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  const { rows } = await d.query<{ record: { safetyNet?: boolean } }>(`SELECT record FROM lfd.runs WHERE id = $1`, [res.runId]);
  assert.equal(rows[0]!.record.safetyNet, true);
  assert.ok(res.stories >= 5, String(res.stories));
});

test('a failure while recording a failed run does not throw', async () => {
  const d = await deps();
  const q = d.query;
  const broken = (async (sql: string, params?: unknown[]) => {
    if (/UPDATE lfd\.runs SET status = \$2/.test(sql)) throw new Error('db down');
    if (/FROM lfd\.posts/.test(sql)) throw new Error('boom');
    return q(sql, params);
  }) as typeof q;
  const res = await runLastFewDays({ ...d, query: broken });
  assert.equal(res.ok, false);
  assert.match((res as { error: string }).error, /boom/);
  assert.match((res as { error: string }).error, /db down/);
});
