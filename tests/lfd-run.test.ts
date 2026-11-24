// tests/lfd-run.test.ts
/**
 * The Last Few Days run on the news chain (wiring contract 2026-11-24, Owner E), offline: the chain's steps
 * (shortlist, rerank, writer, photo finder) are stubbed through `deps.news`; vision and the caption answer through the
 * stubbed `create`. No model, Jev, Serper or web call is made.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { runLastFewDays, type LfdNewsChain, type LfdRunDeps } from '@/lib/lfd/run';
import type { PhotoResult } from '@/lib/news-photos';
import { heliosLines } from '@/lib/social/captions/helios-line';
import type { JevAsk } from '@/lib/social/jev/client';

import { openHubTestDb } from './fixtures/social-hub/pglite';
import { resetSeed, seedCarouselRun, seedReelsIdea, seedScore } from './fixtures/lfd/seed';

/**
 * What each rendered PNG shows: the stub fitCheck writes distinct bytes per slide and records the slide's story
 * headline and photo here, so the vision stub can check it was handed the slide of the story it is judging.
 */
const shown = new Map<string, { headline: string | null; photo: string | null }>();
const mismatches: string[] = [];
beforeEach(() => { resetSeed(); shown.clear(); mismatches.length = 0; });
afterEach(() => assert.deepEqual(mismatches, [], 'every vision call got its own story slide'));

const NOW = new Date('2026-10-13T07:00:00Z'); // Tuesday 3:00 AM NY

type VisionStory = { headline: string; body: string; names: string[]; outlet: string };

/** Vision (submit_verdict) and caption (json_schema) calls; the writer is the news stub, never this. */
function createStub(opts: { vision?: (s: VisionStory, photo: string | null) => string | null; caption?: () => unknown; captionNoUsage?: boolean } = {}) {
  const seen: VisionStory[] = [];
  const captionCalls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const create = async (p: Anthropic.MessageCreateParamsNonStreaming) => {
    if ((p as { output_config?: { format?: unknown } }).output_config?.format) {
      captionCalls.push(p);
      const reply = opts.caption ? opts.caption() : CAPTION_REPLY;
      if (reply instanceof Error) throw reply;
      return { id: 'c', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', stop_sequence: null, ...(opts.captionNoUsage ? {} : { usage: { input_tokens: 500, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 3000 } }), content: [{ type: 'text', text: JSON.stringify(reply) }] } as unknown as Anthropic.Message;
    }
    if ((p.tools?.[0] as { name?: string } | undefined)?.name === 'submit_verdict') {
      const blocks = p.messages[0]!.content as Array<{ type: string; text?: string; source?: { data: string } }>;
      const s = JSON.parse(blocks.find((b) => b.type === 'text')!.text!) as VisionStory;
      const slide = shown.get(blocks.find((b) => b.type === 'image')!.source!.data);
      if (slide?.headline !== s.headline) mismatches.push(`judging "${s.headline}" but the image is ${slide ? `"${slide.headline}"` : 'unknown'}`);
      seen.push(s);
      const rejected = opts.vision?.(s, slide?.photo ?? null) ?? null;
      const input = rejected ? { shows_story_subject: false, generic_stock: true, reason: rejected } : { shows_story_subject: true, generic_stock: false, reason: 'shows the subject' };
      return { id: 'v', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, content: [{ type: 'tool_use', id: 'v', name: 'submit_verdict', input }] } as unknown as Anthropic.Message;
    }
    throw new Error(`unexpected Claude call: ${JSON.stringify(p.tools?.map((t) => (t as { name: string }).name))}`);
  };
  return { create, vision: () => seen, captionCalls: () => captionCalls };
}

const CAPTION_REPLY = {
  opener: '⬅️ Swipe for a new Claude Haiku and a few niche things that happened.',
  body: ['Anthropic put out Claude Haiku 5.5 this week.', 'A niche thing happened.', 'Another niche thing happened.', 'A third niche thing happened.', 'A fourth niche thing happened.', 'A fifth niche thing happened.'].join('\n'),
  question: 'Which one caught your attention?',
};
/** The caption ends on one of the code-written Helios lines, then the credits. */
const endsOnHeliosLine = (caption: string, before: string) => heliosLines('lfd').some((l) => caption.includes(`${before}\n\n${l}\n\nSources:`));

/** Jev: only the last-post same-event check is left in the run (the shortlist is stubbed). */
const jev: JevAsk = async () => ({ answers: { same_event: { noul: 0.1 } }, usage: { input_tokens: 10, output_tokens: 0 }, model: 's' });

/** Shortlist score by headline: Haiku first, then Niche Thing 0, 1, 2, … */
const scoreOf = (h: string) => (h.includes('Haiku') ? 10 : Number(h.match(/Thing (\d+)/)?.[1] ?? 50) * -0.1 + 5);

type NewsOpts = {
  unsupported?: (headline: string) => boolean;
  writeFail?: (headlines: string[]) => boolean;
  /** The photo the finder picks for a story (null: none). Default: one search photo per story. */
  photo?: (s: { headline: string; url: string }, extra: string[], attempt: number) => string | null;
  rerank?: LfdNewsChain['rerank'];
};

/** The chain stubbed: the shortlist orders by scoreOf, the rerank keeps it, the writer echoes, the finder answers `photo`. */
function newsStub(o: NewsOpts = {}) {
  const calls = { writes: 0, written: [] as string[][], angles: [] as Array<Record<string, string>>, photos: [] as string[], photoExtras: [] as Array<{ url: string; extra: string[]; duplicates: string[] }> };
  const attempts = new Map<string, number>();
  const news: LfdNewsChain = {
    shortlist: async (stories) => ({ ranked: stories.map((s) => ({ ...s, cool: 0, value: 0, final: scoreOf(s.headline) })).sort((a, b) => b.final - a.final), costUsd: 0 }),
    rerank: o.rerank ?? (async (items) => ({ graded: items.map((s) => ({ ...s, grade: { cool: 5, value: 5, duplicate_of: null, top_tier: false, crowds: [], angle: `angle: ${s.headline}` } })), costUsd: 0 })),
    write: async (_f, stories, angles) => {
      calls.writes += 1;
      calls.written.push(stories.map((s) => s.headline));
      calls.angles.push(angles);
      if (o.writeFail?.(stories.map((s) => s.headline))) throw new Error('no write_stories call (stop: refusal)');
      const bad = stories.filter((s) => o.unsupported?.(s.headline));
      return {
        written: stories.filter((s) => !bad.includes(s)).map((s) => ({ key: s.key, chosen: 'editor' as const, angle: angles[s.key] ?? '', headline: `Story ${s.headline.slice(0, 40)}`, body: 'It happened this week. The company says more is coming.', highlight: '', names: [] })),
        dropped: bad.map((s) => ({ key: s.key, reason: 'a claim is still unsupported after the rewrite' })),
        over: [],
        costUsd: 0,
        log: [],
      };
    },
    findPhoto: async (s, x): Promise<PhotoResult> => {
      calls.photos.push(s.url);
      calls.photoExtras.push({ url: s.url, extra: x.extra.map((c) => c.src), duplicates: s.duplicateUrls });
      const n = (attempts.get(s.url) ?? 0) + 1;
      attempts.set(s.url, n);
      const extra = x.extra.map((c) => c.src);
      const wanted = o.photo ? o.photo({ headline: s.headline, url: s.url }, extra, n) : `https://p/${encodeURIComponent(s.headline)}.jpg`;
      const src = wanted && !(await x.usedReason(wanted)) ? wanted : null;
      if (!src) return { id: s.id, tier: 'none', pick: null, brief: null, costUsd: 0, log: ['no candidate cleared'] };
      const source = extra.includes(src) ? 'extra' as const : 'search' as const;
      return { id: s.id, tier: 'good', pick: { src, source, credit: source === 'extra' ? 'Reuters' : 'C', tier: 'good', clarity: 8, jpeg: Buffer.alloc(0), width: 1200, height: 800 }, brief: null, costUsd: 0, log: [`grade good ${src}`] };
    },
  };
  return { news, calls };
}

async function deps(over: Partial<LfdRunDeps> = {}): Promise<LfdRunDeps> {
  const query = over.query ?? (await openHubTestDb()).query;
  if (!over.query) {
    for (let i = 0; i < 8; i++) {
      const idea = await seedReelsIdea(query, { headline: `Niche Thing ${i} Happens`, url: `https://n.com/${i}` });
      await seedScore(query, idea, { nyDate: '2026-10-11', origin: 'timely', net: 0.9 - i / 20 });
    }
    await seedCarouselRun(query, '2026-10-12T07:00:00Z', [{ id: 'https://big.com/haiku', headline: 'Anthropic Releases Claude Haiku 5.5', source: 'The Verge' }]);
  }
  return {
    query,
    jev,
    create: createStub().create,
    photos: { usd: 0, find: async () => null },
    news: newsStub().news,
    fetchFeeds: async () => [],
    fetchBody: async () => null,
    readPage: async (url) => ({ ok: false, url, error: 'stub: no page' }),
    fitCheck: async (_p, opts) => {
      if (opts?.screenshotDir) {
        const fs = await import('node:fs/promises');
        const sharp = (await import('sharp')).default;
        for (let i = 1; i <= _p.slides.length; i++) {
          // Distinct bytes per slide: the slide index is the red channel.
          const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: i * 20, g: 0, b: 0 } } }).png().toBuffer();
          const slide = _p.slides[i - 1]!;
          shown.set(png.toString('base64'), { headline: slide.lfdStory?.headline ?? null, photo: slide.photoUrl ?? null });
          await fs.writeFile(`${opts.screenshotDir}/slide-slide-${String(i).padStart(2, '0')}.png`, png);
        }
      }
      return { ok: true, violations: [], problems: [], slideText: [] };
    },
    upload: async () => {},
    now: NOW,
    trigger: 'manual',
    capUsd: 1,
    spend: () => ({ claudeUsd: 0.1, jevUsd: 0.01 }),
    ...over,
  };
}

type Rec = {
  window: { after: string; through: string };
  pool: { reels: number; carousel: number; feed: number; judged: number };
  picks: Array<{ key: string; lane: string; headline: string; origin: string; major: number | null; net: number | null; rerank: unknown }>;
  queues: { major: unknown[]; builder: unknown[]; rundown: Array<{ key: string; headline: string; major: number | null; net: number | null }> };
  drops: Array<{ key: string; lane: string; headline: string; reason: string; detail?: string }>;
  rerank: { shortlisted: number; reranked: number; kept: Array<{ key: string }>; duplicates: Array<{ key: string; into: string }>; error?: string };
  writer: { usd: number; over: string[] };
  vision: { checked: number; rejected: number; usd: number };
  writeFailure?: string;
  feedError?: string;
};
const recordOf = async (d: LfdRunDeps, runId: string) => (await d.query<{ record: Rec }>(`SELECT record FROM lfd.runs WHERE id = $1`, [runId])).rows[0]!.record;
type Saved = { key: string; url: string; headline: string; setup: string; lane: string; photo: { src: string; credit: string }; photoAsk: { query: string }; photoSource: string; photoTrace: string[]; meme?: { templateId: string; object: string }; video?: { object: string; band: string; seconds: number } };
const storiesOf = async (d: LfdRunDeps) => (await d.query<{ stories: Saved[] }>(`SELECT stories FROM lfd.posts`)).rows[0]!.stories;

test('a run walks the rerank order, fills to 6, and saves a review post', async () => {
  const d = await deps();
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  const { rows } = await d.query<{ status: string; stories: Saved[]; slide_objects: string[]; short: boolean; idea_ids: string[] }>(`SELECT status, stories, slide_objects, short, idea_ids FROM lfd.posts`);
  assert.equal(rows[0]!.status, 'review');
  assert.deepEqual(rows[0]!.stories.map((s) => s.url), ['https://big.com/haiku', ...[0, 1, 2, 3, 4].map((i) => `https://n.com/${i}`)]);
  assert.ok(rows[0]!.stories.every((s) => s.setup === ''), 'no setups (WC10)');
  assert.equal(rows[0]!.slide_objects.length, 8);
  assert.ok(rows[0]!.slide_objects.every((p) => p.startsWith('lfd/lfd-2026-10-13/')));
  assert.ok(rows[0]!.idea_ids.includes('https://big.com/haiku'));
  assert.equal(rows[0]!.short, false);
});

test('the rerank editor angles reach the writer under short keys; one writer call for the round', async () => {
  const s = newsStub();
  const d = await deps({ news: s.news });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(s.calls.writes, 1);
  assert.deepEqual(Object.keys(s.calls.angles[0]!), ['s1', 's2', 's3', 's4', 's5', 's6']);
  assert.equal(s.calls.angles[0]!.s1, 'angle: Anthropic Releases Claude Haiku 5.5');
});

test('a story the writer drops for an unsupported claim is replaced from further down the rerank order', async () => {
  const s = newsStub({ unsupported: (h) => h.includes('Niche Thing 0') });
  const d = await deps({ news: s.news });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  const urls = (await storiesOf(d)).map((x) => x.url);
  assert.ok(!urls.includes('https://n.com/0'));
  assert.equal(urls.length, 6);
  assert.equal(urls.at(-1), 'https://n.com/5', 'the next story down fills the slot');
  assert.equal(s.calls.writes, 2, 'one writer call per round');
  const rec = await recordOf(d, res.runId);
  assert.ok(rec.drops.some((x) => x.reason === 'not-grounded' && x.key.endsWith('n.com/0')));
});

test('a thin body is fetched; still thin means the story is dropped and replaced', async () => {
  const d = await deps();
  await d.query(`UPDATE reels.sources SET body = 'teaser' WHERE canonical_url = 'https://n.com/1'`);
  const res = await runLastFewDays({ ...d, fetchBody: async () => 'still short' });
  assert.ok(res.ok);
  const urls = (await storiesOf(d)).map((x) => x.url);
  assert.ok(!urls.includes('https://n.com/1'));
  assert.equal(urls.length, 6);
  assert.ok((await recordOf(d, res.runId)).drops.some((x) => x.reason === 'thin-text' && x.key.endsWith('n.com/1')));
});

test('ideas used by an earlier post are not used again', async () => {
  const d = await deps();
  const first = await runLastFewDays(d);
  assert.ok(first.ok);
  const second = await runLastFewDays({ ...d, now: new Date('2026-10-16T07:00:00Z') });
  const { rows } = await d.query<{ idea_ids: string[] }>(`SELECT idea_ids FROM lfd.posts ORDER BY ny_date`);
  assert.ok(second.ok, JSON.stringify(second));
  assert.deepEqual(rows[1]!.idea_ids.filter((id) => rows[0]!.idea_ids.includes(id)), []);
});

test('fewer than 5 stories still posts, marked short', async () => {
  const { query } = await openHubTestDb();
  for (let i = 0; i < 3; i++) {
    const idea = await seedReelsIdea(query, { headline: `Only ${i}`, url: `https://o.com/${i}` });
    await seedScore(query, idea, { nyDate: '2026-10-12', origin: 'timely', net: 0.5 });
  }
  const res = await runLastFewDays(await deps({ query }));
  assert.ok(res.ok);
  assert.equal(res.short, true);
});

test('the safety net widens the window when it holds fewer than 5 stories', async () => {
  const { query } = await openHubTestDb();
  for (let i = 0; i < 3; i++) {
    const idea = await seedReelsIdea(query, { headline: `In Window ${i}`, url: `https://w.com/${i}` });
    await seedScore(query, idea, { nyDate: '2026-10-11', origin: 'timely', net: 0.5 });
  }
  for (let i = 0; i < 3; i++) {
    const idea = await seedReelsIdea(query, { headline: `Earlier ${i}`, url: `https://e.com/${i}` });
    await seedScore(query, idea, { nyDate: `2026-10-0${9 - i}`, origin: 'timely', net: 0.5 });
  }
  const d = await deps({ query });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(((await d.query<{ record: { safetyNet?: boolean } }>(`SELECT record FROM lfd.runs WHERE id = $1`, [res.runId])).rows[0]!.record).safetyNet, true);
  assert.equal(res.stories, 6);
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

test('a writer call that fails falls back to one call per story and still saves 6', async () => {
  const s = newsStub({ writeFail: (hs) => hs.length > 1 });
  const d = await deps({ news: s.news });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(res.stories, 6);
  assert.ok((await recordOf(d, res.runId)).writeFailure);
});

test('a story whose own write keeps failing is replaced; the post is saved', async () => {
  const d = await deps({ news: newsStub({ writeFail: (hs) => hs.some((h) => h.includes('Niche Thing 2')) }).news });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(res.stories, 6);
  assert.ok(!(await storiesOf(d)).some((x) => x.url === 'https://n.com/2'));
  assert.ok((await recordOf(d, res.runId)).drops.some((x) => x.reason === 'write-failed' && x.key.endsWith('n.com/2')));
});

test('nothing written at all in the first round fails the run', async () => {
  const d = await deps({ news: newsStub({ writeFail: () => true }).news });
  const res = await runLastFewDays(d);
  assert.equal(res.ok, false);
  assert.match((res as { error: string }).error, /writing failed/);
});

test('a failed rerank keeps the shortlist order and the run record says so', async () => {
  const d = await deps({ news: newsStub({ rerank: async () => { throw new Error('opus down'); } }).news });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal((await storiesOf(d))[0]!.url, 'https://big.com/haiku');
  assert.match((await recordOf(d, res.runId)).rerank.error ?? '', /opus down/);
});

test('a reranked duplicate never posts; its id rides on the story it duplicates and its page feeds the photo finder', async () => {
  const s = newsStub({
    rerank: async (items) => ({
      graded: items.map((x) => ({ ...x, grade: { cool: 5, value: 5, duplicate_of: x.id.endsWith('n.com/1') ? items.find((y) => y.id.endsWith('n.com/0'))!.id : null, top_tier: false, crowds: [], angle: '' } })),
      costUsd: 0,
    }),
  });
  const d = await deps({ news: s.news });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  const { rows } = await d.query<{ stories: Saved[]; idea_ids: string[] }>(`SELECT stories, idea_ids FROM lfd.posts`);
  assert.ok(!rows[0]!.stories.some((x) => x.url === 'https://n.com/1'));
  assert.ok(rows[0]!.idea_ids.some((id) => id.includes('n.com/1')), 'the duplicate is spent with its story');
  assert.deepEqual(s.calls.photoExtras.find((x) => x.url === 'https://n.com/0')?.duplicates, ['https://n.com/1']);
  assert.equal((await recordOf(d, res.runId)).rerank.duplicates.length, 1);
});

test('the run record carries what the Ideas view needs', async () => {
  const d = await deps();
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  const rec = await recordOf(d, res.runId);
  assert.ok(rec.window.after && rec.window.through);
  assert.deepEqual(Object.keys(rec.pool).sort(), ['carousel', 'feed', 'judged', 'reels']);
  assert.equal(rec.picks.length, 6);
  assert.deepEqual(Object.keys(rec.picks[0]!).sort(), ['headline', 'key', 'lane', 'major', 'net', 'origin', 'rerank']);
  assert.ok(rec.queues.rundown.length >= 1 && rec.queues.rundown.length <= 10);
  assert.deepEqual(Object.keys(rec.queues.rundown[0]!).sort(), ['headline', 'key', 'major', 'net']);
  assert.deepEqual(rec.drops, []);
  assert.equal(rec.rerank.shortlisted, 9);
  assert.equal(rec.rerank.kept.length, 9);
  assert.equal(rec.feedError, undefined);
});

test('a feed fetch failure is recorded, not swallowed', async () => {
  const d = await deps({ fetchFeeds: async () => { throw new Error('feeds down'); } });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  assert.match((await recordOf(d, res.runId)).feedError ?? '', /feeds down/);
});

test('no survivors fails the run and saves no post', async () => {
  const d = await deps({ news: newsStub({ unsupported: () => true }).news });
  const res = await runLastFewDays(d);
  assert.equal(res.ok, false);
  assert.match((res as { error: string }).error, /no stories survived/);
  assert.ok((await recordOf(d, res.runId)).drops.some((x) => x.reason === 'not-grounded'));
  assert.equal((await d.query<{ n: number }>(`SELECT count(*)::int AS n FROM lfd.posts`)).rows[0]!.n, 0);
});

test('an image that still fails at the final render drops its story; a post never ships a broken image', async () => {
  const base = await deps();
  let checks = 0;
  const d: LfdRunDeps = {
    ...base,
    fitCheck: async (post, opts) => {
      checks += 1;
      const r = await base.fitCheck(post, opts);
      return checks <= 2 ? { ...r, ok: false, problems: ['slide 3 image failed to load'] } : r;
    },
  };
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(checks, 3, 'the final render is redrawn without the broken story');
  const rec = await recordOf(d, res.runId);
  const broken = rec.drops.filter((x) => x.reason === 'image-failed');
  assert.equal(broken.length, 2, 'the first story found no other photo; its replacement failed at the final render');
  assert.ok(broken.some((x) => /final render/.test(x.detail ?? '')));
  const { rows } = await d.query<{ stories: Saved[]; render_problems: string[] }>(`SELECT stories, render_problems FROM lfd.posts`);
  assert.ok(!rows[0]!.stories.some((s) => broken.some((b) => b.key === s.key)));
  assert.ok(!rows[0]!.render_problems.some((p) => /image failed to load/.test(p)));
});

test('a story slide whose image failed to load gets another photo; every render problem is kept', async () => {
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
        problems: [...(checks === 1 ? ['slide 3 image failed to load'] : []), 'Roboto font did not load', 'slide 2 text fit: p.lfd-body "x" (overflow, min 31px)'],
        violations: [{ slide: 4, element: 'h2.lfd-headline', text: 'Wide', over: { left: 0, top: 0, right: 12, bottom: 0 } }],
      };
    },
    news: newsStub({ photo: (s, _e, n) => `https://p/${encodeURIComponent(s.headline)}-${n}.jpg` }).news,
  };
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(checks, 2, 'one re-render after the new photo');
  assert.equal(res.stories, 6);
  const { rows } = await d.query<{ stories: Saved[]; fit_problems: string[]; render_problems: string[] }>(`SELECT stories, fit_problems, render_problems FROM lfd.posts`);
  const again = rows[0]!.stories.find((s) => s.url === 'https://n.com/0')!;
  assert.match(again.photo.src, /-2\.jpg$/, 'slide 3 (n.com/0) took a second photo');
  assert.match(again.photoTrace[0]!, /photo failed to load/);
  assert.deepEqual(rows[0]!.fit_problems, ['slide 2 text fit: p.lfd-body "x" (overflow, min 31px)']);
  assert.ok(!rows[0]!.render_problems.some((p) => /image failed to load/.test(p)), rows[0]!.render_problems.join('\n'));
  assert.ok(rows[0]!.render_problems.includes('Roboto font did not load'));
  assert.ok(rows[0]!.render_problems.some((p) => /^slide 4 bounds: h2\.lfd-headline/.test(p)));
});

test('a saved story keeps its photo, where it came from and its trail; no writer photo ask', async () => {
  const d = await deps();
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  for (const s of await storiesOf(d)) {
    assert.equal(s.photoAsk.query, '');
    assert.ok(s.photo.src.startsWith('https://p/'));
    assert.equal(s.photoSource, 'finder');
    assert.ok(s.photoTrace.some((l) => l.startsWith('photo: grade good')));
  }
});

test('a story with no usable media is skipped and its slot filled from further down', async () => {
  const s = newsStub({ photo: (x) => (x.url === 'https://n.com/0' ? null : `https://p/${encodeURIComponent(x.headline)}.jpg`) });
  const d = await deps({ news: s.news });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  const urls = (await storiesOf(d)).map((x) => x.url);
  assert.deepEqual(urls, ['https://big.com/haiku', ...[1, 2, 3, 4, 5].map((i) => `https://n.com/${i}`)]);
  assert.equal(s.calls.writes, 1, 'a skipped story is never written');
  assert.ok((await recordOf(d, res.runId)).drops.some((x) => x.reason === 'no-photo' && x.key.endsWith('n.com/0')));
});

/** n.com/2's article has a credited lead image; everything else has no page. */
const leadFor2 = async (url: string) => (url === 'https://n.com/2'
  ? { ok: true as const, url, resolvedUrl: url, title: 'T', byline: null, publishedTime: null, text: 'x', truncated: false, photos: [{ src: 'https://n.com/2/lead.jpg', caption: null, credit: 'Reuters', alt: null, from: 'figure' as const, width: 1400 }] }
  : { ok: false as const, url, error: 'stub' });

test('the article lead image goes to the photo finder as an extra candidate; a picked lead is saved as the lead', async () => {
  const s = newsStub({ photo: (x, extra) => extra[0] ?? `https://p/${encodeURIComponent(x.headline)}.jpg` });
  const d = await deps({ readPage: leadFor2, news: s.news });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  assert.deepEqual(s.calls.photoExtras.find((x) => x.url === 'https://n.com/2')?.extra, ['https://n.com/2/lead.jpg']);
  const lead = (await storiesOf(d)).find((x) => x.url === 'https://n.com/2')!;
  assert.deepEqual(lead.photo, { src: 'https://n.com/2/lead.jpg', credit: 'Reuters', kind: 'scene' });
  assert.equal(lead.photoSource, 'lead');
  assert.match(lead.photoTrace[0]!, /^lead image: article figure/);
});

test('the same photo is never used twice in one post', async () => {
  const reads: string[] = [];
  const s = newsStub({ photo: (_x, _e, n) => (n === 1 ? 'https://cdn.com/same.jpg' : null) });
  const d = await deps({ news: s.news, readPage: async (url) => { reads.push(url); return { ok: false, url, error: 'stub' }; } });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(reads.length, new Set(reads).size, 'each article page is read once per run');
  const stories = await storiesOf(d);
  assert.equal(stories.filter((x) => x.photo.src === 'https://cdn.com/same.jpg').length, 1);
});

test('a slide the vision check rejects gets one more photo search; with none it is replaced, the drop says why', async () => {
  const w = createStub({ vision: (s) => (s.headline.includes('Niche Thing 0') ? 'a stack of newspapers' : null) });
  const base = await deps({ create: w.create, news: newsStub({ photo: (x, _e, n) => (x.url === 'https://n.com/0' && n > 1 ? null : `https://p/${encodeURIComponent(x.headline)}.jpg`) }).news });
  let renders = 0;
  const res = await runLastFewDays({ ...base, fitCheck: async (post, opts) => { renders += 1; return base.fitCheck(post, opts); } });
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(renders, 2, 'one re-render after the replacement');
  assert.equal(res.stories, 6);
  const rec = await recordOf(base, res.runId);
  const drop = rec.drops.find((x) => x.reason === 'vision-rejected');
  assert.ok(drop && drop.key.endsWith('n.com/0'), JSON.stringify(rec.drops));
  assert.match(drop.detail ?? '', /a stack of newspapers; no other photo was found/);
  const { rows } = await base.query<{ stories: Saved[]; render_problems: string[]; render: { slides: Array<{ lfdCover?: { photos: Array<{ url: string }> } }> } }>(`SELECT stories, render_problems, render FROM lfd.posts`);
  assert.ok(!rows[0]!.stories.some((s) => s.url === 'https://n.com/0'));
  assert.ok(rows[0]!.stories.some((s) => s.url === 'https://n.com/5'), 'the next story down took the slot');
  assert.deepEqual(rows[0]!.render_problems, []);
  // The cover mosaic is rebuilt from the final stories.
  assert.deepEqual(rows[0]!.render.slides[0]!.lfdCover!.photos.map((p) => p.url), rows[0]!.stories.map((s) => s.photo.src));
  assert.equal(rec.vision.rejected, 1);
  // 6 checked on the first render; the second render checks only the replacement (unchanged slides keep their verdict).
  assert.equal(rec.vision.checked, 7);
  assert.equal(w.vision().length, 7);
});

test('a vision failure on the re-render is recorded in render_problems, not replaced again', async () => {
  const w = createStub({ vision: (s) => (s.headline.includes('Niche Thing 0') || s.headline.includes('Niche Thing 5') ? 'generic office scene' : null) });
  const base = await deps({ create: w.create, news: newsStub({ photo: (x, _e, n) => (x.url === 'https://n.com/0' && n > 1 ? null : `https://p/${encodeURIComponent(x.headline)}.jpg`) }).news });
  let renders = 0;
  const res = await runLastFewDays({ ...base, fitCheck: async (post, opts) => { renders += 1; return base.fitCheck(post, opts); } });
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(renders, 2);
  const rec = await recordOf(base, res.runId);
  assert.equal(rec.drops.filter((x) => x.reason === 'vision-rejected').length, 1);
  const { rows } = await base.query<{ stories: Saved[]; render_problems: string[] }>(`SELECT stories, render_problems FROM lfd.posts`);
  const kept = rows[0]!.stories.find((s) => s.url === 'https://n.com/5');
  assert.ok(kept, 'the replacement stays in the post');
  assert.deepEqual(rows[0]!.render_problems, [`vision: ${kept.headline}: generic office scene`]);
  assert.equal(rec.vision.rejected, 2);
});

test('every run records its vision check', async () => {
  const w = createStub();
  const d = await deps({ create: w.create });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  const rec = await recordOf(d, res.runId);
  assert.deepEqual({ checked: rec.vision.checked, rejected: rec.vision.rejected }, { checked: 6, rejected: 0 });
  assert.ok(rec.vision.usd > 0);
  assert.deepEqual(w.vision().map((s) => Object.keys(s).sort()), Array.from({ length: 6 }, () => ['body', 'headline', 'names', 'outlet']));
});

test('a run the worker claimed is adopted, never inserted twice', async () => {
  const d = await deps();
  const { claimRun, requestRun } = await import('@/lib/lfd/store');
  await requestRun(d.query, 'manual', 1);
  const claimed = (await claimRun(d.query))!;
  const res = await runLastFewDays({ ...d, runId: claimed.id });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.runId, claimed.id);
  const runs = (await d.query<{ n: number; status: string }>(`SELECT count(*)::int AS n, max(status) AS status FROM lfd.runs`)).rows[0]!;
  assert.deepEqual([runs.n, runs.status], [1, 'ok']);
});

test('the caption is written once by the model, ends on the code Helios line, and its question is recorded', async () => {
  const w = createStub();
  const recorded: Array<[string, string, boolean]> = [];
  const closings = { recent: async () => [{ closing: 'Last week Helios said real estate.', buildLine: false, createdAt: NOW }], record: async (id: string, c: string, b: boolean) => { recorded.push([id, c, b]); } };
  const d = await deps({ create: w.create, closings });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(w.captionCalls().length, 1);
  assert.match(String(w.captionCalls()[0]!.messages[0]!.content), /Last week Helios said real estate/);
  const { rows } = await d.query<{ caption: string; render: { caption: string } }>(`SELECT caption, render FROM lfd.posts`);
  assert.match(rows[0]!.caption, /^⬅️ Swipe for a new Claude Haiku/);
  assert.ok(endsOnHeliosLine(rows[0]!.caption, CAPTION_REPLY.question), rows[0]!.caption);
  assert.equal(rows[0]!.render.caption, rows[0]!.caption);
  assert.deepEqual(recorded, [[res.runId, CAPTION_REPLY.question, false]]);
  const rec = (await recordOf(d, res.runId)) as unknown as { caption: { by: string; version: string; usd: number } };
  assert.equal(rec.caption.by, 'model');
  assert.equal(rec.caption.version, 'lfd-caption-v3');
  assert.ok(rec.caption.usd > 0);
});

test('a failed caption call or a rejected reply ships the template caption and records no closing', async () => {
  for (const reply of [new Error('run cap'), { ...CAPTION_REPLY, question: 'Would Helios pick this one?' }]) {
    resetSeed();
    const recorded: string[] = [];
    const closings = { recent: async () => { throw new Error('table missing'); }, record: async (_id: string, c: string) => { recorded.push(c); } };
    const d = await deps({ create: createStub({ caption: () => reply }).create, closings });
    const res = await runLastFewDays(d);
    assert.ok(res.ok, JSON.stringify(res));
    const { rows } = await d.query<{ caption: string }>(`SELECT caption FROM lfd.posts`);
    assert.match(rows[0]!.caption, /^Do you realize what just happened in AI in the last few days\?/);
    assert.ok(heliosLines('lfd').some((l) => rows[0]!.caption.includes(l)), 'the template carries the code Helios line');
    assert.deepEqual(recorded, []);
    const rec = (await recordOf(d, res.runId)) as unknown as { caption: { by: string; reason: string } };
    assert.equal(rec.caption.by, 'template');
    assert.ok(rec.caption.reason);
  }
});

test('model lines that cannot fit ship the template: telemetry says template and no closing is recorded', async () => {
  const recorded: string[] = [];
  const closings = { recent: async () => [], record: async (_id: string, c: string) => { recorded.push(c); } };
  const d = await deps({ create: createStub({ caption: () => ({ ...CAPTION_REPLY, body: Array.from({ length: 6 }, () => 'x'.repeat(2200)).join('\n') }) }).create, closings });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  const { rows } = await d.query<{ caption: string }>(`SELECT caption FROM lfd.posts`);
  assert.match(rows[0]!.caption, /^Do you realize what just happened/);
  assert.deepEqual(recorded, []);
  const rec = (await recordOf(d, res.runId)) as unknown as { caption: { by: string; reason: string } };
  assert.equal(rec.caption.by, 'template');
  assert.match(rec.caption.reason, /did not fit/);
});

test('a caption reply with no usage does not fail the run', async () => {
  const d = await deps({ create: createStub({ captionNoUsage: true }).create });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  const { rows } = await d.query<{ caption: string }>(`SELECT caption FROM lfd.posts`);
  assert.match(rows[0]!.caption, /^⬅️ Swipe for a new Claude Haiku/);
});

// ── Memes: the ladder's second rung (D16/D19) and the one-meme-story scan. ──

async function stubMemePng(): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp({ create: { width: 16, height: 16, channels: 3, background: '#224466' } }).png().toBuffer();
}

function memesHook(o: { clears: (headline: string, assumeShort?: boolean) => boolean; made?: string[] }): NonNullable<LfdRunDeps['memes']> {
  const made = o.made ?? [];
  return {
    capUsd: 1,
    clears: async (s, opts) => o.clears(s.headline, opts?.assumeShort),
    make: async (s) => {
      made.push(s.key);
      return { png: await stubMemePng(), templateId: 'drake', text: ['top', 'bottom'], costUsd: 0.1 };
    },
  };
}

type MemeRec = Rec & { memes: { rescued: Array<{ key: string; headline: string }>; scanned: Array<{ headline: string }>; added: { headline: string } | null } };

test('a story that clears the meme gate posts its meme before any photo is looked for; vision never judges it', async () => {
  const made: string[] = [];
  const s = newsStub();
  const w = createStub();
  const d = await deps({ create: w.create, news: s.news, memes: memesHook({ clears: (h) => h.includes('Niche Thing 0'), made }) });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  assert.ok(!s.calls.photos.includes('https://n.com/0'), 'no photo search for the meme story');
  const rec = await recordOf(d, res.runId) as MemeRec;
  assert.ok(rec.memes.rescued.some((x) => x.key.endsWith('n.com/0')), JSON.stringify(rec.memes));
  const { rows } = await d.query<{ stories: Saved[]; render: { slides: Array<{ photoUrl?: string }> } }>(`SELECT stories, render FROM lfd.posts`);
  const kept = rows[0]!.stories.find((x) => x.url === 'https://n.com/0')!;
  assert.equal(kept.photoSource, 'meme');
  assert.equal(kept.meme?.templateId, 'drake');
  assert.match(kept.photo.src, /^storage:lfd\/.+\/meme-engine-/);
  assert.equal(kept.meme?.object, kept.photo.src.slice('storage:'.length));
  assert.ok(!JSON.stringify(rows[0]!.render).includes('data:image'), 'the saved render does not keep the PNG');
  assert.ok(!w.vision().some((v) => v.headline.includes('Niche Thing 0')));
  assert.deepEqual(made.filter((k) => k.endsWith('n.com/0')).length, 1);
});

test('written copy that fails the gate takes the photo rung', async () => {
  const s = newsStub();
  const d = await deps({ news: s.news, memes: memesHook({ clears: (h, short) => Boolean(short) && h.includes('Niche Thing 0') }) });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  const kept = (await storiesOf(d)).find((x) => x.url === 'https://n.com/0')!;
  assert.equal(kept.photoSource, 'finder');
  assert.ok(kept.photoTrace.some((l) => /did not clear the gate/.test(l)));
});

test('when no slide is a meme, the scan gates the next stories down; the first that clears takes the lowest photo slide', async () => {
  const made: string[] = [];
  const d = await deps({ memes: memesHook({ clears: (h) => h.includes('Niche Thing 6'), made }) });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(res.stories, 6);
  const rec = await recordOf(d, res.runId) as MemeRec;
  assert.ok(rec.memes.added?.headline.includes('Niche Thing 6'), JSON.stringify(rec.memes));
  assert.deepEqual(rec.memes.scanned.map((x) => x.headline), ['Niche Thing 5 Happens', 'Niche Thing 6 Happens']);
  const urls = (await storiesOf(d)).map((x) => x.url);
  assert.ok(urls.includes('https://n.com/6'));
  assert.ok(!urls.includes('https://n.com/4'), 'the lowest-ranked photo slide gave up its place');
  assert.ok(rec.drops.some((x) => x.reason === 'meme-story' && x.key.endsWith('n.com/4')));
  assert.equal(made.length, 1);
});

test('when the lineup already has a meme, the scan does not run', async () => {
  const made: string[] = [];
  const d = await deps({ memes: memesHook({ clears: (h) => h.includes('Haiku'), made }) });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  const rec = await recordOf(d, res.runId) as MemeRec;
  assert.deepEqual(rec.memes.scanned, []);
  assert.equal(rec.memes.added, null);
  assert.equal(made.length, 1);
});

// ── Real footage (MD-LFD D16–D19): the video dep stubbed; no finder, ffmpeg or Instagram call is made. ──

type VideoRec = Rec & {
  video?: { checked: Array<{ key: string; tier: string; where: string }>; slides: Array<{ key: string; ok: boolean; fallback?: string }>; costUsd: number };
  memes?: { added: { headline: string } | null };
};

/** A video dep whose finder answers by headline (`tier`) and whose slide maker fails for `failFor` URLs. */
async function videoHook(o: { tier: (headline: string) => 'golden' | 'good' | 'none'; failFor?: (url: string) => boolean; asked?: string[] }): Promise<NonNullable<LfdRunDeps['video']>> {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const sharp = (await import('sharp')).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lfd-video-test-'));
  const poster = path.join(dir, 'poster.jpg');
  fs.writeFileSync(poster, await sharp({ create: { width: 8, height: 8, channels: 3, background: '#335577' } }).jpeg().toBuffer());
  let usd = 0;
  return {
    capUsd: 0.5,
    find: async (s) => {
      o.asked?.push(s.url);
      usd += 0.02;
      const tier = o.tier(s.headline);
      const clip = tier === 'none' ? null : { file: path.join(dir, 'clip.mp4'), poster, sourceUrl: `https://youtube.com/watch?v=${encodeURIComponent(s.url)}`, title: 't', channel: 'Reuters', site: 'youtube', start: 0, len: 8, muted: false, lowRes: false };
      return { tier, clip, brief: null, candidates: 3, trace: [], costUsd: 0.02 };
    },
    slide: async ({ clip }) => {
      if (o.failFor?.(clip.sourceUrl)) throw new Error('ffmpeg exploded');
      return { mp4: Buffer.from('mp4'), band: Buffer.from('band'), still: Buffer.from('still'), seconds: 8, fit: 'crop', usd: 0.001 };
    },
    spent: () => ({ usd, jevUsd: usd / 2 }),
  };
}

test('video: a golden clip takes the slide before any photo; the MP4, band and poster are stored and the run counts the spend', async () => {
  const uploads: Array<{ path: string; type?: string; body: string }> = [];
  const asked: string[] = [];
  const s = newsStub();
  const d = await deps({
    news: s.news,
    video: await videoHook({ tier: (h) => (h.includes('Niche Thing 0') ? 'golden' : 'none'), asked }),
    upload: async (p, b, t) => { uploads.push({ path: p, type: t, body: b.toString() }); },
  });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  const { rows } = await d.query<{ stories: Saved[]; slide_objects: string[]; render: unknown }>(`SELECT stories, slide_objects, render FROM lfd.posts`);
  const stories = rows[0]!.stories;
  const v = stories.find((x) => x.url === 'https://n.com/0')!;
  assert.equal(v.photoSource, 'video');
  assert.equal(v.photo.credit, 'Video: Reuters');
  assert.match(v.photo.src, /^storage:lfd\/.+\/video-[0-9a-f]{12}\.jpg$/);
  assert.match(v.video!.object, /^lfd\/.+\/video-[0-9a-f]{12}\.mp4$/);
  assert.equal(v.video!.band, v.video!.object.replace(/\.mp4$/, '-band.mp4'));
  assert.ok(!JSON.stringify(rows[0]!.render).includes('data:image'), 'the saved render keeps the poster address, not its bytes');
  assert.ok(!s.calls.photos.includes('https://n.com/0'), 'no photo is looked for once the clip won');
  assert.ok(uploads.some((u) => u.path === v.video!.object && u.type === 'video/mp4'));
  const i = stories.indexOf(v);
  assert.equal(uploads.filter((u) => u.path === rows[0]!.slide_objects[i + 1]).at(-1)?.body, 'still', 'the slide JPEG is a frame of the MP4');
  assert.ok(stories.filter((x) => x !== v).every((x) => x.photoSource !== 'video' && !x.video));
  const rec = await recordOf(d, res.runId) as VideoRec;
  assert.ok(rec.video!.checked.some((c) => c.key.endsWith('n.com/0') && c.tier === 'golden' && c.where === 'lineup'));
  assert.deepEqual(rec.video!.slides.filter((x) => x.ok).map((x) => x.key.endsWith('n.com/0')), [true]);
  const run = (await d.query<{ claude_usd: string; jev_usd: string }>(`SELECT claude_usd::text, jev_usd::text FROM lfd.runs WHERE id = $1`, [res.runId])).rows[0]!;
  const finds = asked.length * 0.02;
  assert.ok(Math.abs(Number(run.claude_usd) - (0.1 + finds / 2)) < 1e-6, `claude ${run.claude_usd}`);
  assert.ok(Math.abs(Number(run.jev_usd) - (0.01 + finds / 2)) < 1e-6, `jev ${run.jev_usd}`);
});

test('video: golden beats a meme that clears the gate; the meme guarantee fills another slot', async () => {
  const made: string[] = [];
  const d = await deps({
    memes: memesHook({ clears: (h) => h.includes('Niche Thing 0') || h.includes('Niche Thing 6'), made }),
    video: await videoHook({ tier: (h) => (h.includes('Niche Thing 0') ? 'golden' : 'none') }),
  });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  const stories = await storiesOf(d);
  assert.equal(stories.find((x) => x.url === 'https://n.com/0')?.photoSource, 'video');
  assert.ok(!made.some((k) => k.endsWith('n.com/0')), 'no meme is made for the video story');
  const rec = await recordOf(d, res.runId) as VideoRec;
  assert.ok(rec.memes!.added?.headline.includes('Niche Thing 6'), JSON.stringify(rec.memes));
  assert.equal(stories.find((x) => x.url === 'https://n.com/6')?.photoSource, 'meme');
});

for (const withMeme of [false, true]) {
  test(`video: a slide whose MP4 fails takes the next rung (${withMeme ? 'a meme that clears' : 'a photo'}); the post never fails`, async () => {
    let renders = 0;
    const base = await deps({
      // The written copy clears (not the article preview), so the lineup's ladder still picks the video first.
      ...(withMeme ? { memes: memesHook({ clears: (h, short) => !short && h.includes('Niche Thing 0') }) } : {}),
      video: await videoHook({ tier: (h) => (h.includes('Niche Thing 0') ? 'golden' : 'none'), failFor: (u) => u.includes('n.com%2F0') }),
    });
    const res = await runLastFewDays({ ...base, fitCheck: async (p, o) => { renders += 1; return base.fitCheck(p, o); } });
    assert.ok(res.ok, JSON.stringify(res));
    assert.equal(renders, 2, 'rendered again with the fallback');
    const x = (await storiesOf(base)).find((y) => y.url === 'https://n.com/0')!;
    assert.equal(x.photoSource, withMeme ? 'meme' : 'finder');
    assert.equal(x.video, undefined);
    const rec = await recordOf(base, res.runId) as VideoRec;
    assert.deepEqual(rec.video!.slides.map((y) => [y.ok, y.fallback]), [[false, withMeme ? 'meme' : 'photo']]);
  });
}

test('video: a good clip never moves a story; the rerank order fills the post', async () => {
  const d = await deps({ video: await videoHook({ tier: (h) => (h.includes('Niche Thing 6') ? 'golden' : h.includes('Niche Thing 5') ? 'good' : 'none') }) });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  const urls = (await storiesOf(d)).map((x) => x.url);
  assert.deepEqual(urls, ['https://big.com/haiku', ...[0, 1, 2, 3, 4].map((i) => `https://n.com/${i}`)], 'no boost past the rerank order (WC2)');
});

test('video: no video dep leaves the run record without a video section', async () => {
  const d = await deps();
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal((await recordOf(d, res.runId) as VideoRec).video, undefined);
});
