// tests/lfd-builder-photos.test.ts — the Phase 1 photo slice (builder slides → AI Drama's harvest) and LFD on the
// central intake, end to end through runLastFewDays. Offline: every harvest dep, the writer, Jev and the intake are stubs.
import assert from 'node:assert/strict';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import type { IntakeItem, IntakeJev, ScoredStory } from '@/lib/intake/types';
import { BUILDER_HARVEST_CAP_USD, harvestBuilderPhoto, type BuilderHarvest, type HarvestBudget } from '@/lib/lfd/photos';
import { runLastFewDays, type LfdNewsChain, type LfdRunDeps } from '@/lib/lfd/run';
import type { Pick, StoryCopy } from '@/lib/lfd/types';
import type { HarvestInput, HarvestResult } from '@/lib/reel-ai-drama/harvest/harvest';
import type { HarvestDeps } from '@/lib/reel-ai-drama/harvest/types';
import type { Asset } from '@/lib/reel-ai-drama/types';
import type { InterpretedScore } from '@/lib/reels/scoring/interpret';
import type { JevAsk, JevResult } from '@/lib/social/jev/client';

import { openHubTestDb } from './fixtures/social-hub/pglite';
import { resetSeed, seedReelsIdea, seedScore } from './fixtures/lfd/seed';

const NOW = new Date('2026-11-10T19:00:00Z'); // Tuesday 2 PM NY: a manual run

function asset(o: Partial<Asset> & { id: string }): Asset {
  return {
    kind: 'person_photo', file: `media/${o.id}.jpg`, url: `https://img.example/${o.id}.jpg`, source_page: null, credit: 'Reuters', license: null, shows: 'a person',
    people: [], qids: [], place: null, date_taken: null, date_confidence: 'unknown', width: 1600, height: 1200, phash: null, character_image: false, made: false, upscaled: false, flags: [], ...o,
  };
}

/** A stub engine: records each call, returns the given assets and spend. */
function engine(assets: Asset[], usd = 0.04) {
  const calls: Array<{ deps: HarvestDeps; input: HarvestInput }> = [];
  const run = async (deps: HarvestDeps, input: HarvestInput): Promise<HarvestResult> => {
    calls.push({ deps, input });
    return { inventory: { assets, usable_count: assets.length, counts: {}, kill: null, usd }, rejected: [], notes: [], wants: [], cast: [] };
  };
  return { run, calls };
}

const noNet = (async () => { throw new Error('no network in tests'); }) as unknown as typeof fetch;
const harvestDeps: BuilderHarvest['deps'] = { http: noNet, create: null, loadPrompt: () => '', serperKey: null, photoBank: null, cutouts: [] };

const pick: Pick = {
  key: 'builder.com/blind-student', refs: ['s1'], origin: 'reels', headline: 'Blind Student Builds Her Own AI Reading App', sourceName: 'BBC', url: 'https://builder.com/blind-student',
  body: 'b'.repeat(2000), publishedAt: '2026-11-08T10:00:00.000Z', net: 0.4, blockbuster: 0, firstSeen: '2026-11-09', alsoFrom: [], major: 0.2, builder: 0.9, eventDate: '2026-11-08T00:00:00.000Z', lane: 'builder',
};
const copy: StoryCopy = {
  key: pick.key, setup: '', headline: 'A blind student built her own reading app', highlight: '', names: ['Maya Chen'], body: 'She trained it herself.',
  photo: { kind: 'person', query: 'Maya Chen blind student reading app', subjects: [{ name: 'Maya Chen', type: 'person' }, { name: 'BBC', type: 'organization' }], alts: [] },
};

test('harvest: a named person gets a portrait; the pitch carries the person and the story URL; the cap is the post budget', async () => {
  const e = engine([asset({ id: 'V1', kind: 'event_photo', flags: ['key_moment'] }), asset({ id: 'V2', people: ['Maya Chen'], face: { x: 0.4, y: 0.2, w: 0.2, h: 0.2 } })]);
  const budget: HarvestBudget = { usd: 0, capUsd: BUILDER_HARVEST_CAP_USD };
  const got = await harvestBuilderPhoto({ deps: harvestDeps, run: e.run }, pick, copy, new Set(), budget, NOW);
  assert.equal(got.photo?.src, 'https://img.example/V2.jpg', 'a person ask takes the portrait before the key moment');
  assert.equal(got.photo?.kind, 'person');
  assert.equal(got.photo?.credit, 'Reuters');
  assert.deepEqual(got.photo?.focus, { x: 0.5, y: 0.30000000000000004 });
  assert.equal(e.calls.length, 1);
  const { deps, input } = e.calls[0]!;
  assert.equal(deps.capUsd, 0.15);
  assert.deepEqual(await deps.db.query('SELECT 1'), { rows: [] }, 'the harvest database is a sink');
  assert.deepEqual(input.pitch.cast.map((c) => [c.name, c.kind]), [['Maya Chen', 'person']], 'only the named people');
  assert.deepEqual(input.pitch.sources.map((s) => s.url), [pick.url]);
  assert.equal(input.settings.reuse_days, 0, 'LFD keeps its own 7-day rule');
  assert.ok(got.trace[0]!.includes('person:maya-chen') && got.trace[0]!.includes('moment'), got.trace[0]);
  assert.equal(budget.usd, 0.04);
});

test('harvest: a scene ask takes the key moment first; a photo used in the last 7 days is never taken', async () => {
  const e = engine([asset({ id: 'V1', kind: 'event_photo', flags: ['key_moment'] }), asset({ id: 'V2', people: ['Maya Chen'] })]);
  const scene = { ...copy, photo: { ...copy.photo, kind: 'scene' } };
  const got = await harvestBuilderPhoto({ deps: harvestDeps, run: e.run }, pick, scene, new Set(), { usd: 0, capUsd: 0.15 }, NOW);
  assert.equal(got.photo?.src, 'https://img.example/V1.jpg');
  const again = await harvestBuilderPhoto({ deps: harvestDeps, run: e.run }, pick, scene, new Set(['https://img.example/V1.jpg']), { usd: 0, capUsd: 0.15 }, NOW);
  assert.equal(again.photo?.src, 'https://img.example/V2.jpg');
});

test('harvest: the $0.15 post cap is shared across slides and respected; a spent cap never calls the engine', async () => {
  const e = engine([], 0.1);
  const budget: HarvestBudget = { usd: 0, capUsd: BUILDER_HARVEST_CAP_USD };
  await harvestBuilderPhoto({ deps: harvestDeps, run: e.run }, pick, copy, new Set(), budget, NOW);
  await harvestBuilderPhoto({ deps: harvestDeps, run: e.run }, pick, copy, new Set(), budget, NOW);
  assert.ok(Math.abs(e.calls[1]!.deps.capUsd! - 0.05) < 1e-9, 'the second slide gets only what is left');
  const third = await harvestBuilderPhoto({ deps: harvestDeps, run: e.run }, pick, copy, new Set(), budget, NOW);
  assert.equal(e.calls.length, 2, 'cap spent: the engine is not called');
  assert.equal(third.photo, null);
  assert.match(third.trace[0]!, /cap is spent/);
});

test('harvest: nothing usable, or an engine failure, returns null (the finder takes over)', async () => {
  const none = await harvestBuilderPhoto({ deps: harvestDeps, run: engine([asset({ id: 'V9', url: null })]).run }, pick, copy, new Set(), { usd: 0, capUsd: 0.15 }, NOW);
  assert.equal(none.photo, null);
  assert.match(none.trace.at(-1)!, /finder takes over/);
  const boom = await harvestBuilderPhoto({ deps: harvestDeps, run: async () => { throw new Error('serper down'); } }, pick, copy, new Set(), { usd: 0, capUsd: 0.15 }, NOW);
  assert.equal(boom.photo, null);
  assert.match(boom.trace.at(-1)!, /serper down/);
});

test('harvest: an engine that throws keeps its allowance charged, so the post cap still holds (fix 10)', async () => {
  const budget: HarvestBudget = { usd: 0.05, capUsd: 0.15 };
  const calls: number[] = [];
  const boom = await harvestBuilderPhoto(
    { deps: harvestDeps, run: async (deps) => { calls.push(deps.capUsd ?? -1); throw new Error('looked, then crashed'); } },
    pick, copy, new Set(), budget, NOW,
  );
  assert.equal(boom.photo, null);
  assert.equal(calls.length, 1);
  assert.ok(Math.abs(calls[0]! - 0.1) < 1e-9, 'the engine was given what was left');
  assert.ok(Math.abs(budget.usd - 0.15) < 1e-9, 'the unknown partial spend counts as the whole allowance');
  assert.match(boom.trace.at(-1)!, /allowance counts as spent/);
  const next = await harvestBuilderPhoto({ deps: harvestDeps, run: async () => { throw new Error('must not run'); } }, pick, copy, new Set(), budget, NOW);
  assert.match(next.trace[0]!, /cap is spent/);

  // A harvest that returns charges only its real cost.
  const ok: HarvestBudget = { usd: 0, capUsd: 0.15 };
  await harvestBuilderPhoto({ deps: harvestDeps, run: engine([asset({ id: 'V1', people: ['Maya Chen'] })]).run }, pick, copy, new Set(), ok, NOW);
  assert.ok(ok.usd < 0.15 && ok.usd >= 0, `real cost only (${ok.usd})`);
});

test('harvest: the real engine with every outside dep stubbed finds nothing and spends nothing (no network)', async () => {
  let httpCalls = 0;
  const http = (async () => { httpCalls += 1; return new Response('', { status: 404 }); }) as unknown as typeof fetch;
  const budget: HarvestBudget = { usd: 0, capUsd: 0.15 };
  const got = await harvestBuilderPhoto(
    { deps: { ...harvestDeps, http, photoBank: { lookup: async () => [], fetchStored: async () => Buffer.alloc(0), offer: () => undefined } } },
    pick, copy, new Set(), budget, NOW,
  );
  assert.equal(got.photo, null);
  assert.ok(!got.trace.some((t) => t.includes('failed')), got.trace.join(' | '));
  assert.equal(budget.usd, 0);
  void httpCalls; // every outside GET went to the stub (zero or more, depending on the wants)
});

/* ── runLastFewDays: intake mode, builder lane, photo slice ───────────────────────────── */

let seq = 0;
function member(url: string, headline: string, seen: string): IntakeItem {
  return {
    key: url, family: 'reels', sourceId: 'hn', sourceName: 'Outlet', sourceType: 'news', headline, body: `${headline}. `.repeat(80), url,
    publishTime: new Date(seen), firstSeenAt: new Date(seen), lastSeenAt: new Date(seen), engagement: null, dropReason: null, storyId: null, role: 'primary',
  } as unknown as IntakeItem;
}
function scored(headline: string, o: { net: number; major?: number; builder?: number; eventDate?: string }): ScoredStory {
  seq += 1;
  const m = member(`https://n${seq}.com/story`, headline, '2026-11-09T06:00:00Z');
  return {
    id: `story-${seq}`, representativeKey: m.key, headline, firstSeenAt: m.firstSeenAt, lastJoinedAt: m.firstSeenAt, mergedInto: null, members: [{ ...m, storyId: `story-${seq}` }],
    scores: { 'reels-score': { net: o.net, blockbuster: 0 } as unknown as InterpretedScore, ...(o.major !== undefined ? { 'major-news': o.major } : {}), ...(o.builder !== undefined ? { 'story-builder': o.builder } : {}) },
    eventDate: o.eventDate ? new Date(o.eventDate) : null, yours: false,
  };
}

/** Claude stub: vision passes every slide; the caption call fails (template caption). The writer is the news stub. */
function writer(): (p: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message> {
  return async (p) => {
    if ((p as { output_config?: { format?: unknown } }).output_config?.format) throw new Error('no caption in this test');
    return { id: 'v', type: 'message', role: 'assistant', model: 'h', stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', id: 'v', name: 'submit_verdict', input: { shows_story_subject: true, generic_stock: false, reason: 'ok' } }] } as unknown as Anthropic.Message;
  };
}

function counting() {
  const versions: string[] = [];
  const jev: JevAsk = async (req, meta): Promise<JevResult> => {
    versions.push(meta.version);
    const usage = { input_tokens: 1, output_tokens: 0 };
    if (meta.version.startsWith('md-grounding')) return { answers: { supported: { noul: 0.9 } }, usage, model: 's' };
    if (meta.version.startsWith('major-news')) return { answers: {}, usage, model: 's' };
    return { answers: { same_event: { noul: 0.1 }, lead: { noul: 0.5 } }, usage, model: 's' };
  };
  return { jev, versions };
}

/** The news chain stubbed: the builder story ranks first, then input order, the writer echoes, the photo finder takes the first extra candidate (lead image, then harvest), else a search photo. */
function finder() {
  const asked: Array<{ url: string; extra: string[] }> = [];
  const news: LfdNewsChain = {
    shortlist: async (stories) => ({ ranked: stories.map((s, i) => ({ ...s, cool: 0, value: 0, final: (s.headline.includes('Builds') ? 200 : 100) - i })).sort((a, b) => b.final - a.final), costUsd: 0 }),
    rerank: async (items) => ({ graded: items.map((s) => ({ ...s, grade: { cool: 5, value: 5, duplicate_of: null, top_tier: false, crowds: [], angle: '' } })), costUsd: 0 }),
    write: async (_f, stories) => ({ written: stories.map((s) => ({ key: s.key, chosen: 'mine' as const, angle: '', headline: `Story ${s.headline.slice(0, 40)}`, body: 'It happened this week. More is coming.', highlight: '', names: [] })), dropped: [], over: [], costUsd: 0, log: [] }),
    findPhoto: async (s, o) => {
      asked.push({ url: s.url, extra: o.extra.map((c) => c.src) });
      const first = o.extra[0];
      const src = first?.src ?? `https://finder/${encodeURIComponent(s.url)}.jpg`;
      return { id: s.id, tier: 'good', pick: { src, source: first ? 'extra' : 'search', credit: first?.credit ?? 'F', tier: 'good', clarity: 8, jpeg: Buffer.alloc(0), width: 1200, height: 800 }, brief: null, costUsd: 0, log: [] };
    },
  };
  return { news, asked };
}

async function intakeDeps(stories: ScoredStory[], over: Partial<LfdRunDeps> = {}) {
  resetSeed();
  const { query } = await openHubTestDb();
  const j = counting();
  const f = finder();
  const fresh: string[] = [];
  const d: LfdRunDeps = {
    query,
    jev: j.jev,
    create: writer() as LfdRunDeps['create'],
    photos: { usd: 0, find: async () => null },
    news: f.news,
    fetchFeeds: async () => { throw new Error('intake mode never fetches feeds'); },
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
    now: NOW,
    trigger: 'manual',
    capUsd: 1,
    spend: () => ({ claudeUsd: 0, jevUsd: 0 }),
    intake: {
      jev: {} as IntakeJev,
      mode: async () => 'intake',
      ensureFresh: async () => { fresh.push('topup'); return { ran: false, reason: 'fresh' }; },
      lanes: { listStories: async () => stories, readCarouselPosted: async () => [], postedCheck: async () => new Set() },
    },
    ...over,
  };
  return { d, j, f, fresh };
}

const lineup = () => [
  scored('Maya Chen Builds Her Own Reading App', { net: 0.1, major: 0.2, builder: 0.9, eventDate: '2026-11-08T00:00:00Z' }),
  ...Array.from({ length: 6 }, (_, i) => scored(`Niche Thing ${i} Happens`, { net: 0.9 - i / 20, major: 0.1 })),
];

test('intake mode: lanes come from the intake, no major-news Jev, a manual run tops the intake up, the builder leads', async () => {
  const e = engine([asset({ id: 'V1', people: ['Maya Chen'] })]);
  const { d, j, fresh } = await intakeDeps(lineup(), { harvest: { deps: harvestDeps, run: e.run } });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  assert.deepEqual(fresh, ['topup']);
  assert.ok(!j.versions.some((v) => v.startsWith('major-news')), 'stored scores: no major-news call');
  const { rows } = await d.query<{ record: { intake: string; queues: { builder: Array<{ headline: string; builder: number }> }; photoHarvest: { usd: number } } }>(`SELECT record FROM lfd.runs`);
  const rec = rows[0]!.record;
  assert.equal(rec.intake, 'intake');
  assert.deepEqual(rec.queues.builder.map((q) => [q.headline, q.builder]), [['Maya Chen Builds Her Own Reading App', 0.9]]);
  assert.equal(rec.photoHarvest.usd, 0.04);
});

test('photo slice: a builder slide offers the lead image and the harvest to the photo finder; non-builder slides never call the harvest', async () => {
  const e = engine([asset({ id: 'V1', people: ['Maya Chen'] })]);
  const { d, f } = await intakeDeps(lineup(), { harvest: { deps: harvestDeps, run: e.run } });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(e.calls.length, 1, 'only the builder slide asks the harvest');
  // The harvest runs before any copy is written: the pitch is the article's (no writer photo request, so no cast).
  assert.equal(e.calls[0]!.input.pitch.title, 'Maya Chen Builds Her Own Reading App');
  const { rows } = await d.query<{ stories: Array<{ lane: string; url: string; photo: { src: string }; photoSource: string; builder?: number }> }>(`SELECT stories FROM lfd.posts`);
  const b = rows[0]!.stories.find((s) => s.lane === 'builder')!;
  assert.equal(b.photoSource, 'harvest');
  assert.equal(b.photo.src, 'https://img.example/V1.jpg');
  assert.equal(b.builder, 0.9);
  assert.deepEqual(f.asked.find((x) => x.url === b.url)?.extra, ['https://img.example/V1.jpg'], 'the harvest pick is an extra candidate for the photo finder');
  assert.ok(f.asked.filter((x) => x.url !== b.url).every((x) => x.extra.length === 0), 'non-builder slides get no harvest');
  assert.ok(rows[0]!.stories.filter((s) => s.lane !== 'builder').every((s) => s.photoSource === 'finder'));

  // With an article lead image, both the lead image and the harvest go to the photo finder; it picks the lead here.
  const e2 = engine([asset({ id: 'V1', people: ['Maya Chen'] })]);
  const stories = lineup();
  const builderUrl = stories[0]!.members[0]!.url;
  const { d: d2 } = await intakeDeps(stories, {
    harvest: { deps: harvestDeps, run: e2.run },
    readPage: async (url) => (url === builderUrl
      ? { ok: true, url, resolvedUrl: url, title: 'T', byline: null, publishedTime: null, text: 'x', truncated: false, photos: [{ src: `${builderUrl}/lead.jpg`, caption: null, credit: 'BBC', alt: null, from: 'figure', width: 1400 }] }
      : { ok: false, url, error: 'stub' }),
  });
  assert.ok((await runLastFewDays(d2)).ok);
  assert.equal(e2.calls.length, 1);
  const { rows: rows2 } = await d2.query<{ stories: Array<{ url: string; photoSource: string; photo: { src: string } }> }>(`SELECT stories FROM lfd.posts`);
  const b2 = rows2[0]!.stories.find((s) => s.url === builderUrl)!;
  assert.deepEqual([b2.photoSource, b2.photo.src], ['lead', `${builderUrl}/lead.jpg`]);
});

test('photo slice: nothing from the harvest → the photo finder alone, with the harvest trail kept', async () => {
  const e = engine([]);
  const { d, f } = await intakeDeps(lineup(), { harvest: { deps: harvestDeps, run: e.run } });
  assert.ok((await runLastFewDays(d)).ok);
  const { rows } = await d.query<{ stories: Array<{ lane: string; url: string; photoSource: string; photoTrace: string[] }> }>(`SELECT stories FROM lfd.posts`);
  const b = rows[0]!.stories.find((s) => s.lane === 'builder')!;
  assert.equal(b.photoSource, 'finder');
  assert.ok(f.asked.some((x) => x.url === b.url));
  assert.ok(b.photoTrace.some((t) => t.includes('finder takes over')));
});

test('legacy and stale-fallback: today\'s lanes, recorded; no builder, so the harvest is never called', async () => {
  resetSeed();
  const { query } = await openHubTestDb();
  for (let i = 0; i < 6; i++) {
    const idea = await seedReelsIdea(query, { headline: `Niche Thing ${i} Happens`, url: `https://n.com/${i}` });
    await seedScore(query, idea, { nyDate: '2026-11-09', origin: 'timely', net: 0.9 - i / 20 });
  }
  const e = engine([asset({ id: 'V1' })]);
  const fresh: string[] = [];
  const { d } = await intakeDeps([], {
    query,
    fetchFeeds: async () => [],
    harvest: { deps: harvestDeps, run: e.run },
    intake: { jev: {} as IntakeJev, mode: async () => 'stale-fallback', ensureFresh: async () => fresh.push('x') },
  });
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  const { rows } = await query<{ record: { intake: string; queues: { builder: unknown[] } } }>(`SELECT record FROM lfd.runs`);
  assert.equal(rows[0]!.record.intake, 'stale-fallback');
  assert.deepEqual(rows[0]!.record.queues.builder, []);
  assert.equal(e.calls.length, 0);
  assert.deepEqual(fresh, [], 'no top-up outside intake mode');
});

test('intake mode: an intake read error falls back to today\'s lanes for the run, recorded error-fallback (fix 2)', async () => {
  resetSeed();
  const { query } = await openHubTestDb();
  for (let i = 0; i < 6; i++) {
    const idea = await seedReelsIdea(query, { headline: `Niche Thing ${i} Happens`, url: `https://n.com/${i}` });
    await seedScore(query, idea, { nyDate: '2026-11-09', origin: 'timely', net: 0.9 - i / 20 });
  }
  const { d } = await intakeDeps([], {
    query,
    fetchFeeds: async () => [],
    harvest: { deps: harvestDeps, run: engine([]).run },
  });
  d.intake = { ...d.intake!, lanes: { ...d.intake!.lanes!, listStories: async () => { throw new Error('intake.items is missing'); } } };
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  const { rows } = await query<{ record: { intake: string; intakeError: string; pool: { reels: number } } }>(`SELECT record FROM lfd.runs`);
  assert.equal(rows[0]!.record.intake, 'error-fallback');
  assert.match(rows[0]!.record.intakeError, /intake\.items is missing/);
  assert.ok(rows[0]!.record.pool.reels >= 6, 'the legacy reels lane filled the pool');
});

test('intake mode: a seed is scored through addIntakeSeed, carries its stored scores and takes its lead lane; no major-news Jev', async () => {
  const stories = lineup();
  const seedStory = scored('Seeded Builder Story Ships', { net: 0.2, builder: 0.95, major: 0.1, eventDate: '2026-11-09T00:00:00Z' });
  const added: string[] = [];
  const { d, j } = await intakeDeps(stories, { harvest: { deps: harvestDeps, run: engine([]).run } });
  const seedUrl = 'https://seeded.com/builder';
  await d.query(`INSERT INTO lfd.settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())`, [
    'seed:seeded.com/builder',
    JSON.stringify({ url: seedUrl, headline: 'Seeded Builder Story Ships', outlet: 'seeded.com', body: 'x'.repeat(2000), addedAt: '2026-11-10T12:00:00.000Z', expiresAt: '2026-11-17T12:00:00.000Z', status: 'open' }),
  ]);
  d.intake = {
    ...d.intake!,
    addSeed: async (_q, _jev, input) => { added.push(`${input.order}:${input.url}`); return { storyId: seedStory.id, created: true }; },
    listStories: async () => [seedStory],
  };
  const res = await runLastFewDays(d);
  assert.ok(res.ok, JSON.stringify(res));
  assert.deepEqual(added, [`lfd:${seedUrl}`]);
  assert.ok(!j.versions.some((v) => v.startsWith('major-news')), 'the seed\'s stored scores are used');
  const { rows } = await d.query<{ stories: Array<{ url: string; lane: string; origin: string }> }>(`SELECT stories FROM lfd.posts`);
  const seed = rows[0]!.stories.find((s) => s.url === seedUrl)!;
  assert.deepEqual([seed.lane, seed.origin], ['builder', 'seed']);
});
