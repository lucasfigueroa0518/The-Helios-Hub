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

type VisionStory = { headline: string; body: string; names: string[] };

/**
 * Writer stub: echoes every story in the material with valid copy; `bad` keys get a headline the fact check rejects.
 * Vision calls (submit_verdict) are answered by `vision` (default: the photo passes) and counted apart.
 */
function writerStub(opts: { setup?: string; failAfter?: number; fail?: (urls: string[]) => boolean; vision?: (s: VisionStory) => string | null } = {}) {
  let calls = 0;
  const seen: VisionStory[] = [];
  const bad = new Set<string>();
  const create = async (p: Anthropic.MessageCreateParamsNonStreaming) => {
    if ((p.tools?.[0] as { name?: string } | undefined)?.name === 'submit_verdict') {
      const blocks = p.messages[0]!.content as Array<{ type: string; text?: string }>;
      const s = JSON.parse(blocks.find((b) => b.type === 'text')!.text!) as VisionStory;
      seen.push(s);
      const rejected = opts.vision?.(s) ?? null;
      const input = rejected ? { shows_story_subject: false, generic_stock: true, reason: rejected } : { shows_story_subject: true, generic_stock: false, reason: 'shows the subject' };
      return { id: 'v', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, content: [{ type: 'tool_use', id: 'v', name: 'submit_verdict', input }] } as unknown as Anthropic.Message;
    }
    calls += 1;
    if (opts.failAfter !== undefined && calls > opts.failAfter) {
      return { id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'refusal', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, content: [{ type: 'text', text: 'no' }] } as unknown as Anthropic.Message;
    }
    const user = String((p.messages.at(-1) as { content: unknown }).content);
    const material = JSON.parse(user.slice(user.indexOf('<material>') + 10, user.indexOf('</material>'))) as { stories: Array<{ key: string; headline: string; url: string }> };
    if (opts.fail?.(material.stories.map((s) => s.url))) {
      return { id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'refusal', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, content: [{ type: 'text', text: 'no' }] } as unknown as Anthropic.Message;
    }
    const stories = material.stories.map((s) => ({
      key: s.key, setup: opts.setup ?? '', headline: bad.has(s.key) ? `UNSUPPORTED ${s.key}` : `Story ${s.headline.slice(0, 40)}`, highlight: '', names: [],
      body: 'It happened this week. The company says more is coming', photo: { kind: 'company', query: s.headline, subjects: [], alts: [] },
    }));
    return { id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 100, cache_creation_input_tokens: 5, cache_read_input_tokens: 50 }, content: [{ type: 'tool_use', id: `t${calls}`, name: 'submit_rundown', input: { stories } }] } as unknown as Anthropic.Message;
  };
  return { create, calls: () => calls, vision: () => seen };
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
    readPage: async (url) => ({ ok: false, url, error: 'stub: no page' }),
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

test('the safety net re-gather never judges the same story twice', async () => {
  const { query } = await openHubTestDb();
  for (let i = 0; i < 3; i++) {
    const idea = await seedReelsIdea(query, { headline: `In Window ${i}`, url: `https://w.com/${i}` });
    await seedScore(query, idea, { nyDate: '2026-10-11', origin: 'timely', net: 0.5 });
  }
  for (let i = 0; i < 3; i++) {
    const idea = await seedReelsIdea(query, { headline: `Earlier ${i}`, url: `https://e.com/${i}` });
    await seedScore(query, idea, { nyDate: `2026-10-0${9 - i}`, origin: 'timely', net: 0.5 });
  }
  const judged: string[] = [];
  const base = jev(() => 0);
  const d = await deps({ query, jev: async (req, meta) => { if (meta.version.startsWith('major-news')) judged.push(meta.subjectId); return base(req, meta); } });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  const { rows } = await d.query<{ record: { safetyNet?: boolean } }>(`SELECT record FROM lfd.runs WHERE id = $1`, [res.runId]);
  assert.equal(rows[0]!.record.safetyNet, true);
  assert.equal(judged.length, new Set(judged).size, `repeat judgments: ${judged.join(', ')}`);
  assert.ok(judged.some((k) => k.includes('e.com')), 'the widened window judges its new stories');
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

type Rec = {
  window: { after: string; through: string };
  pool: { reels: number; carousel: number; feed: number; judged: number };
  jevCalls: number;
  picks: Array<{ key: string; lane: string; headline: string; origin: string; major: number | null; net: number | null }>;
  queues: { major: Array<{ key: string; headline: string; major: number | null; net: number | null }>; rundown: Array<{ key: string; headline: string; major: number | null; net: number | null }> };
  drops: Array<{ key: string; lane: string; headline: string; reason: string }>;
  claudeCache: { readTokens: number; creationTokens: number };
  writeFailure?: string;
  feedError?: string;
};
const recordOf = async (d: LfdRunDeps, runId: string) => (await d.query<{ record: Rec }>(`SELECT record FROM lfd.runs WHERE id = $1`, [runId])).rows[0]!.record;

test('a failed batch write falls back to one call per story and still saves 6', async () => {
  const d = await deps({ create: writerStub({ fail: (urls) => urls.length > 1 }).create });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(res.stories, 6);
  assert.ok((await recordOf(d, res.runId)).writeFailure);
});

test('a story whose own write keeps failing is replaced; the post is saved', async () => {
  const d = await deps({ create: writerStub({ fail: (urls) => urls.includes('https://n.com/2') }).create });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(res.stories, 6);
  const { rows } = await d.query<{ stories: Array<{ url: string }> }>(`SELECT stories FROM lfd.posts`);
  assert.ok(!rows[0]!.stories.some((s) => s.url === 'https://n.com/2'));
  const rec = await recordOf(d, res.runId);
  assert.ok(rec.drops.some((x) => x.reason === 'write-failed' && x.key.endsWith('n.com/2')));
});

test('nothing written at all in the first round fails the run', async () => {
  const d = await deps({ create: writerStub({ fail: () => true }).create });
  const res = await runLastFewDays(d);
  assert.equal(res.ok, false);
  assert.match((res as { error: string }).error, /writing failed/);
});

test('the run record carries what the Ideas view needs', async () => {
  const d = await deps();
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  const rec = await recordOf(d, res.runId);
  assert.ok(rec.window.after && rec.window.through);
  assert.deepEqual(Object.keys(rec.pool).sort(), ['carousel', 'feed', 'judged', 'reels']);
  assert.ok(rec.jevCalls > 0);
  assert.equal(rec.picks.length, 6);
  assert.deepEqual(Object.keys(rec.picks[0]!).sort(), ['headline', 'key', 'lane', 'major', 'net', 'origin']);
  assert.equal(rec.picks[0]!.lane, 'major');
  assert.ok(rec.queues.major.length >= 1 && rec.queues.major.length <= 10);
  assert.ok(rec.queues.rundown.length >= 1 && rec.queues.rundown.length <= 10);
  assert.deepEqual(Object.keys(rec.queues.rundown[0]!).sort(), ['headline', 'key', 'major', 'net']);
  assert.deepEqual(rec.drops, []);
  assert.ok(rec.claudeCache.readTokens > 0 && rec.claudeCache.creationTokens > 0);
  assert.equal(rec.feedError, undefined);
});

test('a feed fetch failure is recorded, not swallowed', async () => {
  const d = await deps({ fetchFeeds: async () => { throw new Error('feeds down'); } });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  assert.match((await recordOf(d, res.runId)).feedError ?? '', /feeds down/);
});

test('stories still pending after the last round are recorded as unfinished; no survivors fails the run', async () => {
  const { query } = await openHubTestDb();
  for (let i = 0; i < 30; i++) {
    const idea = await seedReelsIdea(query, { headline: `Story Number ${i}`, url: `https://m.com/${i}` });
    await seedScore(query, idea, { nyDate: '2026-10-11', origin: 'timely', net: 0.9 - i / 100 });
  }
  const d = await deps({ query, jev: failFirst('m.com/') });
  const res = await runLastFewDays(d);
  assert.equal(res.ok, false);
  assert.match((res as { error: string }).error, /no stories survived/);
  const rec = await recordOf(d, res.runId);
  const unfinished = rec.drops.filter((x) => x.reason === 'unfinished');
  assert.ok(unfinished.length > 0);
  assert.ok(unfinished.every((x) => x.headline.startsWith('Story Number')));
  assert.ok(rec.drops.some((x) => x.reason === 'not-grounded' && x.headline));
  assert.equal((await d.query<{ n: number }>(`SELECT count(*)::int AS n FROM lfd.posts`)).rows[0]!.n, 0);
});

test('a story slide whose image failed to load is replaced; every render problem is kept', async () => {
  const base = await deps();
  let checks = 0;
  const d: LfdRunDeps = {
    ...base,
    fitCheck: async (post, opts) => {
      checks += 1;
      const r = await base.fitCheck(post, opts);
      return {
        ...r,
        ok: false,
        problems: ['slide 3 image failed to load', 'Roboto font did not load', 'slide 2 text fit: p.lfd-body "x" (overflow, min 31px)'],
        violations: [{ slide: 4, element: 'h2.lfd-headline', text: 'Wide', over: { left: 0, top: 0, right: 12, bottom: 0 } }],
      };
    },
  };
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(checks, 2, 'one re-render after the replacement');
  assert.equal(res.stories, 6);
  const rec = await recordOf(d, res.runId);
  const broken = rec.drops.filter((x) => x.reason === 'image-failed');
  assert.equal(broken.length, 1);
  const { rows } = await d.query<{ stories: Array<{ key: string }>; fit_problems: string[]; render_problems: string[] }>(`SELECT stories, fit_problems, render_problems FROM lfd.posts`);
  assert.ok(!rows[0]!.stories.some((s) => s.key === broken[0]!.key));
  assert.deepEqual(rows[0]!.fit_problems, ['slide 2 text fit: p.lfd-body "x" (overflow, min 31px)']);
  assert.ok(rows[0]!.render_problems.includes('slide 3 image failed to load'), rows[0]!.render_problems.join('\n'));
  assert.ok(rows[0]!.render_problems.includes('Roboto font did not load'));
  assert.ok(rows[0]!.render_problems.some((p) => /^slide 4 bounds: h2\.lfd-headline/.test(p)));
});

test('a saved story keeps the writer photo ask apart from the photo, with where the photo came from and its trail', async () => {
  const d = await deps({
    photos: {
      usd: 0,
      find: async () => null,
      findSet: async (reqs, trace) => {
        trace?.push(...reqs.map((r) => [`company: "${r.query}"`, 'article photo → winner']));
        return reqs.map((r, i) => ({ src: `https://p/${i}-${encodeURIComponent(r.query)}.jpg`, credit: 'C', kind: 'scene' }));
      },
    },
  });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  type Saved = { headline: string; photoAsk: { kind: string; query: string }; photo: { src: string }; photoSource: string; photoTrace: string[] };
  const { rows } = await d.query<{ stories: Saved[] }>(`SELECT stories FROM lfd.posts`);
  for (const s of rows[0]!.stories) {
    assert.equal(s.photoAsk.kind, 'company');
    assert.ok(s.photoAsk.query, 'the ask keeps its query');
    assert.ok(s.photo.src.startsWith('https://p/'), 'photo is the result, not the ask');
    assert.equal(s.photoSource, 'finder');
    assert.equal(s.photoTrace[0], `company: "${s.photoAsk.query}"`);
  }
});

test('a story whose only photo is the icon-scene fallback is replaced as no-photo', async () => {
  const d = await deps({
    photos: {
      usd: 0,
      find: async () => null,
      findSet: async (reqs, trace) => {
        trace?.push(...reqs.map((r) => (r.sourceUrls[0] === 'https://n.com/0' ? ['icon scene (newspaper) → "stack of newspapers"'] : ['article photo → winner'])));
        return reqs.map((r, i) => ({ src: `https://p/${i}-${encodeURIComponent(r.query)}.jpg`, credit: 'C', kind: 'scene' }));
      },
    },
  });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(res.stories, 6);
  const rec = await recordOf(d, res.runId);
  const drop = rec.drops.find((x) => x.reason === 'no-photo');
  assert.ok(drop && drop.key.endsWith('n.com/0'), JSON.stringify(rec.drops));
  const { rows } = await d.query<{ stories: Array<{ url: string }> }>(`SELECT stories FROM lfd.posts`);
  assert.ok(!rows[0]!.stories.some((s) => s.url === 'https://n.com/0'));
});

test('a story whose article has a usable lead image uses it; the finder only sees the others', async () => {
  const asked: string[] = [];
  const d = await deps({
    readPage: async (url) => (url === 'https://n.com/2'
      ? { ok: true, url, resolvedUrl: url, title: 'T', byline: null, publishedTime: null, text: 'x', truncated: false, photos: [{ src: 'https://n.com/2/lead.jpg', caption: null, credit: 'Reuters', alt: null, from: 'figure', width: 1400 }] }
      : { ok: false, url, error: 'stub' }),
    photos: {
      usd: 0,
      find: async () => null,
      findSet: async (reqs) => {
        asked.push(...reqs.map((r) => r.sourceUrls[0]!));
        return reqs.map((r, i) => ({ src: `https://p/${i}-${encodeURIComponent(r.query)}.jpg`, credit: 'C', kind: 'scene' }));
      },
    },
  });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  assert.ok(!asked.includes('https://n.com/2'), 'the finder is not asked for the story with a lead image');
  const { rows } = await d.query<{ stories: Array<{ url: string; photo: { src: string; credit: string }; photoSource: string; photoTrace: string[] }> }>(`SELECT stories FROM lfd.posts`);
  const lead = rows[0]!.stories.find((s) => s.url === 'https://n.com/2')!;
  assert.deepEqual(lead.photo, { src: 'https://n.com/2/lead.jpg', credit: 'Reuters', kind: 'scene' });
  assert.equal(lead.photoSource, 'lead');
  assert.match(lead.photoTrace[0]!, /^lead image: article figure/);
  assert.ok(rows[0]!.stories.filter((s) => s.url !== 'https://n.com/2').every((s) => s.photoSource === 'finder'));
});

test('the same lead image is never used twice in one post', async () => {
  const shared = { src: 'https://cdn.com/same.jpg', caption: null, credit: 'AP', alt: null, from: 'figure' as const, width: 1400 };
  const d = await deps({ readPage: async (url) => ({ ok: true, url, resolvedUrl: url, title: 'T', byline: null, publishedTime: null, text: 'x', truncated: false, photos: [shared] }) });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  const { rows } = await d.query<{ stories: Array<{ photo: { src: string }; photoSource: string }> }>(`SELECT stories FROM lfd.posts`);
  assert.equal(rows[0]!.stories.filter((s) => s.photo.src === shared.src).length, 1);
  assert.equal(rows[0]!.stories.filter((s) => s.photoSource === 'lead').length, 1);
});

type VisionRec = { vision: { checked: number; rejected: number; usd: number } };

test('a story slide the vision check rejects is replaced and re-rendered; the drop says why', async () => {
  const w = writerStub({ vision: (s) => (s.headline.includes('Niche Thing 0') ? 'a stack of newspapers' : null) });
  const base = await deps({ create: w.create });
  let renders = 0;
  const res = await runLastFewDays({ ...base, fitCheck: async (post, opts) => { renders += 1; return base.fitCheck(post, opts); } });
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(renders, 2, 'one re-render after the replacement');
  assert.equal(res.stories, 6);
  const rec = await recordOf(base, res.runId) as unknown as Rec & VisionRec;
  const drop = rec.drops.find((x) => x.reason === 'vision-rejected') as { key: string; detail?: string } | undefined;
  assert.ok(drop && drop.key.endsWith('n.com/0'), JSON.stringify(rec.drops));
  assert.equal(drop.detail, 'a stack of newspapers');
  const { rows } = await base.query<{ stories: Array<{ url: string }>; render_problems: string[] }>(`SELECT stories, render_problems FROM lfd.posts`);
  assert.ok(!rows[0]!.stories.some((s) => s.url === 'https://n.com/0'));
  assert.deepEqual(rows[0]!.render_problems, []);
  assert.equal(rec.vision.rejected, 1);
  // 6 checked on the first render; the second render checks only the replacement (unchanged slides keep their verdict).
  assert.equal(rec.vision.checked, 7);
  assert.equal(w.vision().length, 7);
  assert.ok(rec.vision.usd > 0);
});

test('a vision failure on the re-render is recorded in render_problems, not replaced again', async () => {
  const w = writerStub({ vision: (s) => (s.headline.includes('Niche Thing 0') || s.headline.includes('Niche Thing 5') ? 'generic office scene' : null) });
  const base = await deps({ create: w.create });
  let renders = 0;
  const res = await runLastFewDays({ ...base, fitCheck: async (post, opts) => { renders += 1; return base.fitCheck(post, opts); } });
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(renders, 2);
  const rec = await recordOf(base, res.runId) as unknown as Rec & VisionRec;
  assert.equal(rec.drops.filter((x) => x.reason === 'vision-rejected').length, 1);
  const { rows } = await base.query<{ stories: Array<{ url: string; headline: string }>; render_problems: string[] }>(`SELECT stories, render_problems FROM lfd.posts`);
  const kept = rows[0]!.stories.find((s) => s.url === 'https://n.com/5');
  assert.ok(kept, 'the replacement stays in the post');
  assert.deepEqual(rows[0]!.render_problems, [`vision: ${kept.headline}: generic office scene`]);
  assert.equal(rec.vision.rejected, 2);
});

test('every run records its vision check', async () => {
  const w = writerStub();
  const d = await deps({ create: w.create });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  const rec = await recordOf(d, res.runId) as unknown as Rec & VisionRec;
  assert.deepEqual({ checked: rec.vision.checked, rejected: rec.vision.rejected }, { checked: 6, rejected: 0 });
  assert.ok(rec.vision.usd > 0);
  assert.deepEqual(w.vision().map((s) => Object.keys(s).sort()), Array.from({ length: 6 }, () => ['body', 'headline', 'names']));
});
