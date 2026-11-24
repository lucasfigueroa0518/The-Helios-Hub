// tests/lfd-chain.test.ts
/**
 * Last Few Days on the news chain (wiring contract 2026-11-24, WC2), offline: the rerank order is the post's order,
 * the post keeps 5–6 stories, and a story without usable media is skipped and replaced from further down. The chain's
 * steps are stubbed through `deps.news`; no model, Jev, Serper or web call is made.
 */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { leadFor, LineupWalk, scoreUnscoredSeeds } from '@/lib/lfd/pick';
import { seedCandidate } from '@/lib/lfd/seeds';
import { runLastFewDays, windowLabel, type LfdNewsChain, type LfdRunDeps } from '@/lib/lfd/run';
import type { MediaVerdict } from '@/lib/news-ranker/posts';
import { MAJOR_NEWS, SAME_EVENT } from '@/lib/news-ranker/questions';
import type { Graded } from '@/lib/news-ranker/rerank';
import type { HubQuery } from '@/lib/social-hub/db';
import type { JevAsk } from '@/lib/social/jev/client';

import { openHubTestDb } from './fixtures/social-hub/pglite';
import { resetSeed, seedLfdPost, seedReelsIdea, seedScore } from './fixtures/lfd/seed';

beforeEach(() => resetSeed());

const g = (id: string): Graded => ({ id, headline: id, text: '', outlets: [], published: null, url: id, cool: 0, value: 0, final: 0, grade: { cool: 0, value: 0, duplicate_of: null, top_tier: false, crowds: [], angle: '' } });

test('the walk keeps rank order, stops at the max, and fills a skipped slot from further down', async () => {
  const resolved: string[] = [];
  const verdict: Record<string, MediaVerdict> = { a: 'good', b: 'none', c: 'usable', d: 'good', e: 'good', f: 'good', g: 'good', h: 'good' };
  const walk = new LineupWalk('abcdefgh'.split('').map(g), async (x) => { resolved.push(x.id); return verdict[x.id]!; }, 3);
  assert.deepEqual(await walk.take(6), ['a', 'c', 'd', 'e', 'f', 'g']);
  assert.ok(!resolved.includes('h'), 'nothing past the slot it needed is resolved');
  assert.deepEqual(walk.upcoming(5).map((x) => x.id), ['h']);
  assert.deepEqual(await walk.take(6), ['h']);
  assert.deepEqual(await walk.take(6), [], 'a spent list gives nothing');
});

test('a claimed story is never walked', async () => {
  const walk = new LineupWalk(['a', 'b', 'c'].map(g), async () => 'good', 1);
  walk.claim('b');
  assert.deepEqual(await walk.take(3), ['a', 'c']);
});

test('the rerank user turn names the window the post covers', () => {
  assert.equal(windowLabel({ after: '2026-10-09', through: '2026-10-12' }), '2026-10-10 to 2026-10-12');
  assert.equal(windowLabel({ after: '2026-10-11', through: '2026-10-12' }), '2026-10-12');
});

/** Vision passes; the caption call fails (template caption). */
const create = (async (p: Anthropic.MessageCreateParamsNonStreaming) => {
  if ((p as { output_config?: { format?: unknown } }).output_config?.format) throw new Error('no caption in this test');
  return { id: 'v', type: 'message', role: 'assistant', model: 'h', stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', id: 'v', name: 'submit_verdict', input: { shows_story_subject: true, generic_stock: false, reason: 'ok' } }] } as unknown as Anthropic.Message;
}) as LfdRunDeps['create'];

/**
 * The shortlist ranks Story 0, 1, 2, … (net order); the rerank reverses it, so the post must follow the reverse.
 * `noMedia` stories get no photo.
 */
function chain(noMedia: Set<string>) {
  const seen = { shortlisted: [] as string[], reranked: [] as string[], written: [] as string[][] };
  const n = (h: string) => Number(h.match(/Story (\d+)/)![1]);
  const news: LfdNewsChain = {
    shortlist: async (stories) => {
      const ranked = stories.map((s) => ({ ...s, cool: 0, value: 0, final: 100 - n(s.headline) })).sort((a, b) => b.final - a.final);
      seen.shortlisted = ranked.map((s) => s.headline);
      return { ranked, costUsd: 0 };
    },
    rerank: async (items, deps) => {
      assert.match(deps.windowLabel, /^2026-10-\d\d/);
      const graded = [...items].reverse().map((s) => ({ ...s, grade: { cool: 5, value: 5, duplicate_of: null, top_tier: false, crowds: [], angle: `angle ${s.headline}` } }));
      seen.reranked = graded.map((s) => s.headline);
      return { graded, costUsd: 0 };
    },
    write: async (_f, stories, angles) => {
      seen.written.push(stories.map((s) => s.headline));
      return { written: stories.map((s) => ({ key: s.key, chosen: 'editor' as const, angle: angles[s.key] ?? '', headline: s.headline, body: 'It happened this week.', highlight: '', names: [] })), dropped: [], over: [], costUsd: 0, log: [] };
    },
    findPhoto: async (s) => (noMedia.has(s.headline)
      ? { id: s.id, tier: 'none', pick: null, brief: null, costUsd: 0, log: ['no candidate cleared'] }
      : { id: s.id, tier: 'good', pick: { src: `https://p/${encodeURIComponent(s.url)}.jpg`, source: 'search', credit: 'C', tier: 'good', clarity: 8, jpeg: Buffer.alloc(0), width: 1200, height: 800 }, brief: null, costUsd: 0, log: [] }),
  };
  return { news, seen };
}

async function run(stories: number, noMedia: string[] = [], o: { headline?: (i: number) => string; before?: (q: HubQuery) => Promise<void>; jev?: LfdRunDeps['jev'] } = {}) {
  const { query } = await openHubTestDb();
  await o.before?.(query);
  for (let i = 0; i < stories; i++) {
    const idea = await seedReelsIdea(query, { headline: o.headline?.(i) ?? `Story ${i}`, url: `https://s.com/${i}` });
    await seedScore(query, idea, { nyDate: '2026-10-11', origin: 'timely', net: 0.9 - i / 100 });
  }
  const c = chain(new Set(noMedia));
  const d: LfdRunDeps = {
    query,
    jev: o.jev ?? (async () => ({ answers: { same_event: { noul: 0.1 } }, usage: { input_tokens: 1, output_tokens: 0 }, model: 's' })),
    create,
    news: c.news,
    fetchFeeds: async () => [],
    fetchBody: async () => null,
    readPage: async (url) => ({ ok: false, url, error: 'stub' }),
    fitCheck: async (post, opts) => {
      if (opts?.screenshotDir) {
        const fs = await import('node:fs/promises');
        const sharp = (await import('sharp')).default;
        for (let i = 1; i <= post.slides.length; i++) {
          const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: i * 20, g: 0, b: 0 } } }).png().toBuffer();
          await fs.writeFile(`${opts.screenshotDir}/slide-slide-${String(i).padStart(2, '0')}.png`, png);
        }
      }
      return { ok: true, violations: [], problems: [], slideText: [] };
    },
    upload: async () => undefined,
    now: new Date('2026-10-13T07:00:00Z'),
    trigger: 'manual',
    capUsd: 1,
    spend: () => ({ claudeUsd: 0, jevUsd: 0 }),
  };
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  const post = (await query<{ stories: Array<{ headline: string; photoSource: string }>; short: boolean }>(`SELECT stories, short FROM lfd.posts WHERE run_id = $1`, [res.runId])).rows[0]!;
  const record = (await query<{ record: { drops: Array<{ headline: string; reason: string }>; rerank: { repeats?: Array<{ key: string; headline: string; covered: string }> } } }>(`SELECT record FROM lfd.runs WHERE id = $1`, [res.runId])).rows[0]!.record;
  return { post, record, seen: c.seen };
}

test('the post follows the rerank order (not the shortlist order) and keeps 6 of 10', async () => {
  const { post, seen } = await run(10);
  assert.deepEqual(seen.shortlisted.slice(0, 3), ['Story 0', 'Story 1', 'Story 2']);
  assert.deepEqual(post.stories.map((s) => s.headline), ['Story 9', 'Story 8', 'Story 7', 'Story 6', 'Story 5', 'Story 4']);
  assert.equal(post.short, false);
});

test('5 stories make a full post of 5', async () => {
  const { post } = await run(5);
  assert.deepEqual(post.stories.map((s) => s.headline), ['Story 4', 'Story 3', 'Story 2', 'Story 1', 'Story 0']);
  assert.equal(post.short, false);
});

test('a story without media is skipped and replaced from further down the rerank order; it is never written', async () => {
  const { post, record, seen } = await run(10, ['Story 8']);
  assert.deepEqual(post.stories.map((s) => s.headline), ['Story 9', 'Story 7', 'Story 6', 'Story 5', 'Story 4', 'Story 3']);
  assert.ok(post.stories.every((s) => s.photoSource === 'finder'));
  assert.ok(!seen.written.flat().includes('Story 8'));
  assert.ok(record.drops.some((x) => x.headline === 'Story 8' && x.reason === 'no-photo'));
});

test('a different article about an event the last post covered is out before the rerank (own-repeat exclusion)', async () => {
  const pairs: Array<[string, string]> = [];
  const jev: JevAsk = async (req, meta) => {
    assert.equal(meta.version, SAME_EVENT.version);
    const st = req.state as { story_a: { headline: string }; story_b: { headline: string } };
    pairs.push([st.story_a.headline, st.story_b.headline]);
    return { answers: { same_event: { noul: st.story_a.headline.includes('Haiku') && st.story_b.headline.includes('Haiku') ? 0.95 : 0.1 } }, usage: { input_tokens: 1, output_tokens: 0 }, model: 's' };
  };
  // The last post led with "Anthropic Releases Claude Haiku 5.5"; Story 9 is another outlet's article on it.
  const { post, record, seen } = await run(10, [], { before: (q) => seedLfdPost(q, { nyDate: '2026-10-11' }).then(() => undefined), headline: (i) => (i === 9 ? 'Story 9 Anthropic Haiku recap' : `Story ${i}`), jev });
  assert.ok(seen.shortlisted.includes('Story 9 Anthropic Haiku recap'));
  assert.ok(!seen.reranked.includes('Story 9 Anthropic Haiku recap'), 'never reaches the rerank');
  assert.deepEqual(post.stories.map((s) => s.headline), ['Story 8', 'Story 7', 'Story 6', 'Story 5', 'Story 4', 'Story 3']);
  assert.deepEqual(record.rerank.repeats?.map((x) => [x.headline, x.covered]), [['Story 9 Anthropic Haiku recap', 'Anthropic Releases Claude Haiku 5.5']]);
  assert.deepEqual(pairs, [['Anthropic Releases Claude Haiku 5.5', 'Story 9 Anthropic Haiku recap']], 'only the pair sharing a name is asked, once');
});

test('a seed with no stored score gets one major-news call and its lane from the bar; a scored seed makes no call', async () => {
  const asked: string[] = [];
  const jev: JevAsk = async (_req, meta) => {
    asked.push(`${meta.version}|${meta.subjectId}`);
    return { answers: { happened: { noul: 1 }, news_kind: { noul: 1 }, blockbuster_entity: { noul: 1 }, global_relevance: { noul: 1 }, political_relevance: { noul: 1 }, speculative: { noul: 0 } }, usage: { input_tokens: 1, output_tokens: 0 }, model: 's' };
  };
  const now = new Date('2026-10-13T07:00:00Z');
  const seed = (key: string) => seedCandidate({ key, url: `https://${key}`, headline: `Seed ${key}`, outlet: 'O', body: 'Body.', addedAt: '2026-10-12T00:00:00Z', expiresAt: '2026-10-20T00:00:00Z', status: 'open' });
  assert.equal(leadFor(seed('a'), now), null, 'unscored: rundown');
  const [a, b] = await scoreUnscoredSeeds(jev, [seed('a'), { ...seed('b'), major: 0.2 }]);
  assert.deepEqual(asked, [`${MAJOR_NEWS.version}|a`], 'one call, for the unscored seed only');
  assert.equal(leadFor(a!, now)?.lane, 'major');
  assert.equal(b!.major, 0.2);
  assert.equal(leadFor(b!, now), null);
});
