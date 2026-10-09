/**
 * Stories M3, M6, M7, M8: the three series' builds, the set build, the
 * schedule and the worker loop, offline (PGlite, stubbed Jev, Sonnet, photo
 * finder, renderer, storage, Meta). No live call of any kind.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { BuildDeps } from '@/lib/stories/build/common';
import { buildSet } from '@/lib/stories/build';
import { buildFreeVsPaid, pairKey, struckPrice } from '@/lib/stories/build/free-vs-paid';
import { buildGuessTheNumber, difficultyFrom } from '@/lib/stories/build/guess-the-number';
import { MAJOR_NEWS_BAR, buildMorningDownload, chooseStories, namesIn } from '@/lib/stories/build/morning-download';
import { createStoriesJev } from '@/lib/stories/jev';
import type { StoriesMetaClient } from '@/lib/stories/publish/meta';
import type { ReviewCall } from '@/lib/stories/render/review';
import { claimNextRequested, getSet, recentKeys, recordCost, recordHistory, requestSet } from '@/lib/stories/repository';
import { isDueOn, pickPublishAt, requestAutoSets, windowBounds } from '@/lib/stories/schedule';
import { DEFAULT_SETTINGS, loadSettings, saveSeriesSetting } from '@/lib/stories/settings';
import { carouselNumbers, morningDownloadCarousel, recentUsedPhotoUrls, recordPublishedPhoto } from '@/lib/stories/sources/carousel';
import { freeToolLeads, morningDownloadReels, storyKey, theNumberIdeas } from '@/lib/stories/sources/reels';
import type { StoriesStorage } from '@/lib/stories/storage';
import { tick } from '@/lib/stories/worker';
import { writeStructured } from '@/lib/stories/writer';

import { addIdea, addSlate, harnessDb, stubJev, stubPhotos, stubRenderer, stubWriter } from './stories-harness';

const NOW = new Date('2026-10-08T05:00:00Z'); // 1:00 AM New York, Thursday Oct 8
const DATE = '2026-10-08';

const materialOf = (params: Record<string, unknown>) => {
  const m = /<material>\n([\s\S]*)\n<\/material>/.exec(String((params.messages as Array<{ content: string }>)[0]!.content));
  return JSON.parse(m![1]!) as unknown;
};

async function buildDeps(db: Awaited<ReturnType<typeof harnessDb>>['db'], series: 'morning_download' | 'guess_the_number' | 'free_vs_paid', o: { jev?: ReturnType<typeof stubJev>; write?: ReturnType<typeof stubWriter>; photos?: ReturnType<typeof stubPhotos> } = {}): Promise<BuildDeps & { jevStub: ReturnType<typeof stubJev> }> {
  const { set } = await requestSet(db, { series, nyDate: DATE, trigger: 'click', style: DEFAULT_SETTINGS.series[series].style });
  await claimNextRequested(db);
  const jevStub = o.jev ?? stubJev();
  return { db, sourceDb: db, jev: createStoriesJev(jevStub, db), write: o.write ?? stubWriter({}), photos: o.photos ?? stubPhotos(), settings: DEFAULT_SETTINGS, now: NOW, setId: set.id, nyDate: DATE, jevStub };
}

/* ── Sources ─────────────────────────────────────────────────────── */

test('reels pool: the latest slate, top 10 news ideas by net plus every blockbuster, no Warning or Callout, read only', async () => {
  const { db } = await harnessDb();
  const old = await addSlate(db, '2026-10-01');
  await addIdea(db, old, { headline: 'Old news', url: 'https://x.test/old', net: 99 });
  const slate = await addSlate(db, DATE);
  await addIdea(db, slate, { headline: 'Your chatbot is leaking your secrets', url: 'https://x.test/w', net: 200, bucket: 'the_warning' });
  await addIdea(db, slate, { headline: 'Stop paying for AI note-takers', url: 'https://x.test/c', net: 150, blockbuster: 0.2, bucket: 'the_callout' });
  for (let i = 0; i < 12; i++) await addIdea(db, slate, { headline: `Story ${i}`, url: `https://x.test/${i}`, net: 100 - i, blockbuster: i === 11 ? 0.2 : 0 });
  const pool = await morningDownloadReels(db, DATE);
  assert.equal(pool.length, 11);
  assert.equal(pool[0]!.headline, 'Story 0');
  assert.equal(pool[10]!.headline, 'Story 11');
  assert.ok(!pool.some((c) => c.headline === 'Old news'));
  assert.ok(!pool.some((c) => /secrets|note-takers/.test(c.headline)), 'Warning and Callout ideas stay with Text on Screen');
  assert.equal(storyKey('https://www.X.test/a/?utm_source=ig#top'), 'x.test/a');
});

test('reels: The Number ideas (7 days) and free-tool leads (Ball Knowledge, GitHub Trending, catalog)', async () => {
  const { db } = await harnessDb();
  const slate = await addSlate(db, '2026-10-06');
  await addIdea(db, slate, { headline: 'ChatGPT hits 800M weekly users', url: 'https://x.test/n', net: 5, bucket: 'the_number' });
  await addIdea(db, slate, { headline: 'This free app replaces Photoshop', url: 'https://x.test/b', net: 5, bucket: 'ball_knowledge' });
  await db.query(`INSERT INTO reels.sources (canonical_url, headline, source_name, adapter_id) VALUES ('https://github.com/a/b', 'a/b: a local Whisper app', 'GitHub', 'github-trending')`);
  await db.query(`INSERT INTO reels.list_catalog (list_id, entry_name, entry_url, description) VALUES ('awesome', 'GIMP', 'https://gimp.org', 'Image editor')`);
  assert.deepEqual((await theNumberIdeas(db, DATE)).map((c) => c.headline), ['ChatGPT hits 800M weekly users']);
  const leads = await freeToolLeads(db, DATE);
  assert.deepEqual(leads.map((l) => l.origin).sort(), ['catalog', 'github', 'reels']);
});

test('carousel: qualified stories from the last 30 hours with their post photo; brief numbers; used photos', async () => {
  const { db } = await harnessDb();
  const group = (id: string, title: string, status = 'qualified') => ({ id, status, passes: 3, outlets: ['Bloomberg', 'Reuters'], members: [{ title, outlet: 'Bloomberg' }], representative: { title, url: id }, body: `${title}. Text.`, publishedAt: '2026-10-07T20:00:00Z' });
  await db.query(`INSERT INTO social.runs (finished_at, record) VALUES ($1, $2)`, ['2026-10-07T22:00:00Z', JSON.stringify({ selection: { scored: [group('https://b.test/1', 'Newsom signs AI order'), group('https://b.test/2', 'Skipped', 'not-qualified'), group('https://b.test/3', 'Crusoe raises $3.9B')], shortlist: [group('https://b.test/3', 'Crusoe raises $3.9B')] } })]);
  await db.query(`INSERT INTO social.posts (slug, story_id, status, brief, render, created_at) VALUES ('crusoe', 'https://b.test/3', 'review', $1, $2, '2026-10-07T23:00:00Z')`, [
    JSON.stringify({ the_news: { text: 'Crusoe raised $3.9B.' }, facts: [{ text: 'Crusoe is now valued at $30.9B.', ids: ['N1'] }], numbers: [{ id: 'N1', value: '$30.9B', counts: 'valuation' }], sources: [{ outlet: 'TechCrunch', url: 'https://tc.test/crusoe' }] }),
    JSON.stringify({ slides: [{ photoUrl: 'https://img.test/dc.jpg', photoCredit: 'Photo: X', photoKind: 'scene' }] }),
  ]);
  const md = await morningDownloadCarousel(db, NOW);
  assert.deepEqual(md.map((c) => c.headline), ['Crusoe raises $3.9B', 'Newsom signs AI order']);
  assert.deepEqual(md[0]!.photo, { url: 'https://img.test/dc.jpg', credit: 'Photo: X' });
  const nums = await carouselNumbers(db, NOW);
  assert.deepEqual(nums.map((n) => [n.value, n.fact, n.sourceName]), [['$30.9B', 'Crusoe is now valued at $30.9B.', 'TechCrunch']]);
  await recordPublishedPhoto(db, { url: 'https://img.test/dc.jpg', usedAt: NOW, storyId: 'stories:x', slide: 2 });
  await recordPublishedPhoto(db, { url: 'https://img.test/dc.jpg', usedAt: NOW, storyId: 'stories:x', slide: 2 });
  assert.deepEqual([...(await recentUsedPhotoUrls(db, NOW))], ['https://img.test/dc.jpg']);
});

/* ── Morning Download (M3) ───────────────────────────────────────── */

test('chooseStories (S-04): everything over the bar up to 5, else the top 2', () => {
  const s = (score: number) => ({ score });
  assert.equal(chooseStories([0.9, 0.8, 0.7, 0.7, 0.6, 0.6, 0.2].map(s)).length, 5);
  assert.deepEqual(chooseStories([0.9, 0.1, 0.3].map(s)).map((x) => x.score), [0.9, 0.3]);
  assert.ok(MAJOR_NEWS_BAR > 0 && MAJOR_NEWS_BAR < 1);
  assert.ok(namesIn('OpenAI and Sam Altman launch GPT-6').has('OpenAI'));
});

test('Morning Download: merge across systems, rank, write, ground with one rewrite, photos (S-29, S-14)', async () => {
  const { db } = await harnessDb();
  const slate = await addSlate(db, DATE);
  await addIdea(db, slate, { headline: 'OpenAI ships GPT-6', url: 'https://r.test/openai', net: 9, body: 'OpenAI released GPT-6 on Wednesday.' });
  await addIdea(db, slate, { headline: 'Nvidia posts record revenue', url: 'https://r.test/nvidia', net: 8 });
  await addIdea(db, slate, { headline: 'A small startup raises seed money', url: 'https://r.test/seed', net: 7 });
  await db.query(`INSERT INTO social.runs (finished_at, record) VALUES ($1, $2)`, ['2026-10-08T02:00:00Z', JSON.stringify({ selection: { scored: [{ id: 'https://c.test/openai', status: 'qualified', outlets: ['Bloomberg'], members: [{ title: 'OpenAI releases GPT-6 to everyone' }], representative: { title: 'OpenAI releases GPT-6 to everyone' }, body: 'OpenAI released GPT-6.' }], shortlist: [] } })]);
  await db.query(`INSERT INTO social.posts (slug, story_id, status, render) VALUES ('gpt6', 'https://c.test/openai', 'review', $1)`, [JSON.stringify({ slides: [{ photoUrl: 'https://img.test/openai.jpg', photoCredit: 'Photo: OpenAI', photoKind: 'scene' }] })]);
  await recordHistory(db, 'morning_download', [], null);

  const jev = stubJev((k, state) => {
    if (k === 'same_event') return JSON.stringify(state).includes('GPT-6') ? 0.95 : 0.1;
    if (k === 'supported') return String((state as { headline?: string }).headline).includes('BAD') ? 0.1 : 0.9;
    if (k === 'headline_news' || k === 'blockbuster_entity') return /seed/i.test(JSON.stringify(state)) ? 0.1 : 0.9;
    return /seed/i.test(JSON.stringify(state)) ? 0.1 : 0.7;
  });
  const write = stubWriter({
    submit_headlines: (params, n) => {
      const stories = materialOf(params) as Array<{ key: string; headline: string }>;
      return {
        stories: stories.map((s) => ({ key: s.key, headline: n === 1 && s.headline.includes('Nvidia') ? 'BAD Nvidia made a trillion dollars yesterday.' : `${s.headline} on Wednesday. It matters.`, source_verb: 'via', source_name: 'Bloomberg', subjects: [{ name: 'OpenAI', type: 'organization' }], visual: { kind: 'company', query: s.headline.split(' ')[0] }, alt_visuals: [{ kind: 'thematic', query: 'banknotes' }, { kind: 'setting', query: 'courtroom' }] })),
        opener_visual: { kind: 'setting', query: 'OpenAI office' },
      };
    },
  });
  const photos = stubPhotos();
  const deps = await buildDeps(db, 'morning_download', { jev, write, photos });
  const r = await buildMorningDownload(deps);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  // The carousel and reels GPT-6 stories merged into one; the seed story fell below the cut.
  const stories = r.frames.filter((f) => f.role === 'story');
  assert.equal(stories.length, 2);
  assert.deepEqual(r.frames.map((f) => f.role), ['opener', 'story', 'story', 'closer']);
  // Nvidia's first headline failed grounding and was rewritten.
  assert.ok(stories.every((f) => !(f.copy as { headline: string }).headline.includes('BAD')));
  assert.equal(write.calls.length, 2);
  // S-29: the GPT-6 frame uses the carousel's own photo; the other comes from the finder.
  const photosUsed = stories.map((f) => (f.copy as { photo?: { src: string } }).photo?.src);
  assert.ok(photosUsed.includes('https://img.test/openai.jpg'));
  // Photo pivot (2026-10-09): each story's request carries the model's alt visuals and the frame's own headline; the opener has none.
  const storyReqs = photos.requests.filter((q) => q.alts !== undefined);
  assert.equal(storyReqs.length, 1, 'only the story without a carousel photo is asked for');
  assert.deepEqual(storyReqs[0]!.alts, [{ kind: 'thematic', query: 'banknotes' }, { kind: 'setting', query: 'courtroom' }]);
  assert.ok(storyReqs[0]!.copy && storyReqs[0]!.copy.includes('Nvidia'));
  // S-14: the opener's photo is none of the story frames' photos.
  const opener = (r.frames[0]!.copy as { photo?: { src: string }; storyCount: number });
  assert.ok(opener.photo && !photosUsed.includes(opener.photo.src));
  assert.equal(opener.storyCount, 2);
  assert.equal(r.candidates.filter((c) => c.chosen).length, 2);
  // Every Jev call and the writer calls were costed against the set.
  const { rows } = await db.query<{ vendor: string; n: number }>(`SELECT vendor, count(*)::int AS n FROM stories.cost_events WHERE set_id = $1 GROUP BY vendor ORDER BY vendor`, [deps.setId]);
  assert.deepEqual(rows, [{ vendor: 'anthropic', n: 2 }, { vendor: 'jev', n: jev.calls.length }]);
  // The writer's request: cached instructions, a strict tool, auto tool choice.
  const req = write.calls[0]! as { system: Array<{ cache_control?: unknown }>; tools: Array<{ strict?: boolean; cache_control?: unknown }>; tool_choice: unknown; model: string };
  assert.ok(req.system[0]!.cache_control);
  assert.equal(req.tools.at(-1)!.strict, true);
  assert.ok(req.tools.at(-1)!.cache_control);
  assert.deepEqual(req.tool_choice, { type: 'auto' });
  assert.equal(req.model, 'claude-sonnet-5-5');
});

test('Morning Download: stories shown in the last 3 days are dropped; fewer than 2 left skips the day', async () => {
  const { db } = await harnessDb();
  const slate = await addSlate(db, DATE);
  await addIdea(db, slate, { headline: 'A', url: 'https://r.test/a', net: 9 });
  await addIdea(db, slate, { headline: 'B', url: 'https://r.test/b', net: 8 });
  await recordHistory(db, 'morning_download', [storyKey('https://r.test/b')], null);
  const deps = await buildDeps(db, 'morning_download');
  const r = await buildMorningDownload(deps);
  assert.deepEqual(r, { ok: false, skip: 'only 1 new stories in the pool', candidates: [] });
});

/* ── Guess the Number (M6) ───────────────────────────────────────── */

test('Guess the Number: pre-score, write the top 4, re-score, intro with difficulty, photo reuse (S-12)', async () => {
  const { db } = await harnessDb();
  await db.query(`INSERT INTO social.posts (slug, story_id, status, brief, render, created_at) VALUES ('chatgpt', 's1', 'published', $1, $2, '2026-10-06T12:00:00Z')`, [
    JSON.stringify({ the_news: { text: 'OpenAI shared ChatGPT usage.' }, facts: [{ text: 'ChatGPT has 800 million weekly users.', ids: ['N1'] }, { text: 'It launched in 2022.', ids: ['N2'] }], numbers: [{ id: 'N1', value: '800 million', counts: 'weekly users' }, { id: 'N2', value: '2022', counts: 'launch year' }], sources: [{ outlet: 'OpenAI', url: 'https://openai.test/devday' }] }),
    JSON.stringify({ slides: [{ photoUrl: 'https://img.test/altman.jpg', photoCredit: 'Photo: TechCrunch', photoKind: 'subject' }] }),
  ]);
  const jev = stubJev((k, state) => (JSON.stringify(state).includes('2022') ? 0.2 : k === 'guessable' ? 0.3 : k === 'surprise' ? 0.9 : 0.85));
  const write = stubWriter({
    submit_questions: (params) => ({
      questions: (materialOf(params) as Array<{ candidate_key: string; number: string }>).map((c) => ({ candidate_key: c.candidate_key, question: 'How many people use ChatGPT every week?', answer: '800M', label: 'people use ChatGPT every week', meaning: 'About one in ten people on Earth.', topic: 'How many people use ChatGPT', source_verb: 'from', source_name: 'OpenAI', subjects: [{ name: 'Sam Altman', type: 'person' }], visual: { kind: 'person', query: 'Sam Altman' }, answer_visual: { kind: 'setting', query: 'OpenAI office' } })),
    }),
  });
  const deps = await buildDeps(db, 'guess_the_number', { jev, write, photos: stubPhotos() });
  const r = await buildGuessTheNumber(deps, { numbers: () => carouselNumbers(db, NOW), unbriefed: async () => [] });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.frames.map((f) => f.role), ['intro', 'question', 'answer']);
  const intro = r.frames[0]!.copy as { difficulty: string; topic: string };
  assert.equal(intro.topic, 'How many people use ChatGPT');
  assert.equal(intro.difficulty, 'high');
  const q = r.frames[1]!.copy as { family: string; photo?: { src: string }; question: string };
  assert.equal(q.family, 'photo');
  assert.equal(q.photo?.src, 'https://img.test/altman.jpg');
  // No hint on the question frame (S-51).
  assert.equal('hint' in q, false);
  assert.equal(r.frames[1]!.template, 'photo');
  assert.deepEqual(r.historyKeys, [storyKey('https://openai.test/devday')]);
  assert.equal(r.candidates.find((c) => c.chosen)!.payload!.value, '800 million');
});

test('Guess the Number: nothing clears the bar → skipped; difficulty bands (O-10, provisional)', async () => {
  const { db } = await harnessDb();
  const deps = await buildDeps(db, 'guess_the_number', { jev: stubJev(() => 0.3), write: stubWriter({ submit_questions: (p) => ({ questions: (materialOf(p) as Array<{ candidate_key: string }>).map((c) => ({ candidate_key: c.candidate_key, question: 'Q?', answer: '1', label: 'l', meaning: 'm', topic: 't', source_verb: 'via', source_name: 's', subjects: [], visual: { kind: 'thematic', query: 'x' }, answer_visual: { kind: 'thematic', query: 'y' } })) }) }) });
  const r = await buildGuessTheNumber(deps, { numbers: async () => [{ key: 'k', origin: 'carousel', ref: 'p', value: '42', fact: 'f', counts: 'c', storyHeadline: 'h', sourceName: 's', url: 'https://x.test', storyKey: 'x.test' }], unbriefed: async () => [] });
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.skip : '', /no written question cleared the bar/);
  assert.equal(difficultyFrom({ guessable: { noul: 0.9 }, surprise: { noul: 0.1 } }), 'low');
  assert.equal(difficultyFrom({ guessable: { noul: 0.5 }, surprise: { noul: 0.6 } }), 'medium');
});

/* ── Free vs. Paid (M7) ──────────────────────────────────────────── */

const PAIRS = [
  { paid_tool: 'Adobe Photoshop', paid_price: '$22.99', price_period: 'a month', paid_price_url: 'https://adobe.test/pricing', free_tool: 'GIMP', free_url: 'https://gimp.test', what_it_does: 'A full photo editor.', how_to_get: 'Free download at gimp.org', platforms: 'Mac, Windows and Linux', dev_tool: false },
  { paid_tool: 'Otter', paid_price: '$16.99', price_period: 'a month', paid_price_url: 'https://otter.test/pricing', free_tool: 'Whisper app', free_url: 'https://whisper.test', what_it_does: 'Transcribes audio offline.', how_to_get: 'Free on the App Store', platforms: 'Mac and iPhone', dev_tool: false },
];

test('Free vs. Paid: a pair shown in 90 days is dropped; a pair that fails verification is skipped for the next', async () => {
  const { db } = await harnessDb();
  await recordHistory(db, 'free_vs_paid', [pairKey(PAIRS[0]!)], null);
  let verifies = 0;
  const write = stubWriter({
    submit_pairs: () => ({ pairs: [...PAIRS, { ...PAIRS[1]!, paid_tool: 'Notion', free_tool: 'AppFlowy', paid_price: '$10' }] }),
    submit_check: () => ({ price_confirmed: ++verifies > 1, price_seen: '$12', free_confirmed: true, note: verifies === 1 ? 'price changed' : '' }),
    submit_tease: () => ({ tease: 'There is a free one that does most of this.' }),
  });
  const photos = stubPhotos();
  const deps = await buildDeps(db, 'free_vs_paid', { write, photos });
  const r = await buildFreeVsPaid(deps, async () => [{ origin: 'catalog', ref: '1', name: 'Whisper app', url: 'https://whisper.test', description: 'offline transcription' }]);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(verifies, 2);
  const paid = r.frames[1]!.copy as { tool: string; price: string; tease: string; logo?: { kind: string } };
  assert.ok(['Otter', 'Notion'].includes(paid.tool));
  assert.equal(paid.logo?.kind, 'logo');
  assert.ok(!r.candidates.some((c) => c.chosen && c.ref === pairKey(PAIRS[0]!)));
  assert.equal(r.candidates.filter((c) => /verification failed/.test(c.reason ?? '')).length, 1);
  // Web search spend is costed at $10 per 1,000 searches.
  const { rows } = await db.query<{ usd: number }>(`SELECT usd::float8 AS usd FROM stories.cost_events WHERE vendor = 'web_search'`);
  assert.deepEqual(rows, [{ usd: 0.04 }]);
  assert.deepEqual(r.frames.map((f) => f.role), ['intro', 'paid', 'free']);
  // Web search is offered to the pairing call only; web fetch to verification.
  const toolTypes = write.calls.map((c) => (c.tools as Array<{ type?: string }>).map((t) => t.type).filter(Boolean));
  assert.deepEqual(toolTypes, [['web_search_20260209'], ['web_fetch_20260209'], ['web_fetch_20260209'], []]);
});

test('Free vs. Paid: struck prices read naturally', () => {
  assert.equal(struckPrice('$22.99', 'a month'), '$22.99/mo');
  assert.equal(struckPrice('$99', 'per year'), '$99/yr');
  assert.equal(struckPrice('$5', 'per seat'), '$5 per seat');
});

/* ── The set build (M3 + M2) ─────────────────────────────────────── */

const storage = (): StoriesStorage & { uploads: string[] } => {
  const uploads: string[] = [];
  return { uploads, upload: async (p) => { uploads.push(p); }, sign: async (p) => `https://signed.test/${p}`, download: async () => Buffer.alloc(0), remove: async () => {} };
};
const cleanReview: ReviewCall = async () => ({ flags: [], usage: { model: 'claude-haiku-5-5', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0.0001 } });

test('buildSet: the monthly watch skips; a builder error fails the set; a good build is ready and rendered', async () => {
  const { db } = await harnessDb();
  const renderer = await stubRenderer();
  const base = { db, sourceDb: db, jevTransport: stubJev(), write: stubWriter({}), photos: stubPhotos(), renderer, review: cleanReview, storage: storage(), now: () => NOW };

  const { set: a } = await requestSet(db, { series: 'morning_download', nyDate: DATE, trigger: 'click', style: 'polished' });
  await claimNextRequested(db);
  const ok = await buildSet({ ...base, builders: { morning_download: async () => ({ ok: true, payload: { x: 1 }, frames: [{ seq: 1, role: 'opener', backdrop: 'black', copy: { role: 'opener', date: 'Thursday, October 8', storyCount: 2 } }, { seq: 2, role: 'closer', backdrop: 'black', copy: { role: 'closer' } }], candidates: [], historyKeys: ['k1'] }) } }, a.id);
  assert.equal(ok.status, 'ready');
  const got = await getSet(db, a.id);
  assert.equal(got!.set.status, 'ready');
  assert.deepEqual(got!.set.payload.historyKeys, ['k1']);
  assert.equal(got!.frames.every((f) => f.storage_path), true);

  const { set: b } = await requestSet(db, { series: 'free_vs_paid', nyDate: DATE, trigger: 'click', style: 'homemade' });
  await claimNextRequested(db);
  const bad = await buildSet({ ...base, builders: { free_vs_paid: async () => { throw new Error('web search refused'); } } }, b.id);
  assert.deepEqual(bad, { status: 'failed', detail: 'web search refused' });
  assert.equal((await getSet(db, b.id))!.set.status, 'failed');

  await recordCost(db, { vendor: 'anthropic', component: 'x', usd: 30 });
  const { set: c } = await requestSet(db, { series: 'guess_the_number', nyDate: DATE, trigger: 'click', style: 'homemade' });
  await claimNextRequested(db);
  const watch = await buildSet(base, c.id);
  assert.equal(watch.status, 'skipped');
  assert.match((await getSet(db, c.id))!.set.error!, /monthly watch reached/);
});

/* ── Schedule (M8) ───────────────────────────────────────────────── */

test('schedule: windows in New York time, a uniform minute, never late', () => {
  // Every series posts 8:30–10:00 AM (Tommy, 2026-10-08).
  for (const s of Object.values(DEFAULT_SETTINGS.series)) assert.deepEqual([s.window.start, s.window.end], ['08:30', '10:00']);
  const md = DEFAULT_SETTINGS.series.morning_download.window;
  const { start, end } = windowBounds(md, DATE);
  assert.equal(start.toISOString(), '2026-10-08T12:30:00.000Z');
  assert.equal(end.toISOString(), '2026-10-08T14:00:00.000Z');
  assert.equal(pickPublishAt(md, DATE, NOW, () => 0)!.toISOString(), '2026-10-08T12:30:00.000Z');
  assert.equal(pickPublishAt(md, DATE, NOW, (n) => n - 1)!.toISOString(), '2026-10-08T14:00:00.000Z');
  assert.equal(pickPublishAt(md, DATE, new Date('2026-10-08T13:30:20Z'), () => 0)!.toISOString(), '2026-10-08T13:31:00.000Z');
  assert.equal(pickPublishAt(md, DATE, new Date('2026-10-08T14:01:00Z')), null);
  // Thursday: Guess the Number yes, Free vs. Paid no (S-01).
  assert.equal(isDueOn(DEFAULT_SETTINGS.series.guess_the_number.window, DATE), true);
  assert.equal(isDueOn(DEFAULT_SETTINGS.series.free_vs_paid.window, DATE), false);
});

test('auto sets: only for series switched to auto, due today, still before the window closes', async () => {
  const { db } = await harnessDb();
  assert.deepEqual(await requestAutoSets(db, await loadSettings(db), NOW), []);
  await saveSeriesSetting(db, 'guess_the_number', { auto: true });
  await saveSeriesSetting(db, 'free_vs_paid', { auto: true });
  const s = await loadSettings(db);
  assert.deepEqual(await requestAutoSets(db, s, NOW), ['guess_the_number']);
  assert.deepEqual(await requestAutoSets(db, s, NOW), []);
});

/* ── The worker loop (M8) ────────────────────────────────────────── */

/** The two switches every content type has (docs/social-overnight.md); both ship in the safe position. */
async function setSwitches(db: Awaited<ReturnType<typeof harnessDb>>['db'], s: { requireApproval: boolean; publishingLive: boolean }) {
  for (const [key, value] of [['require_approval', s.requireApproval], ['publishing_live', s.publishingLive]] as const) {
    await db.query(`INSERT INTO stories.settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, JSON.stringify(value)]);
  }
}

test('worker (approval off, publishing live): auto request at 4 AM → build → self-approve → schedule → publish in order → history, used photos, insights', async () => {
  const { db } = await harnessDb();
  await saveSeriesSetting(db, 'guess_the_number', { auto: true });
  await setSwitches(db, { requireApproval: false, publishingLive: true });
  const renderer = await stubRenderer();
  const published: string[] = [];
  const meta: StoriesMetaClient = {
    createStoryContainer: async (url) => `c:${url.split('/').pop()}`,
    containerStatus: async () => ({ state: 'FINISHED', status: null }),
    publishContainer: async (id) => (published.push(id), `m:${id}`),
    publishingQuota: async () => ({ used: 0, total: 100 }),
    publishingLimit: async () => ({ quotaUsage: 0, quotaTotal: 100 }),
  };
  const st = storage();
  let clock = new Date('2026-10-08T08:00:00Z'); // 4:00 AM New York
  const frames = [
    { seq: 1, role: 'intro' as const, backdrop: 'black' as const, copy: { role: 'intro' as const, difficulty: 'medium' as const, topic: 'ChatGPT users' } },
    { seq: 2, role: 'question' as const, backdrop: 'black' as const, copy: { role: 'question' as const, family: 'photo' as const, question: 'How many?', photo: { src: 'https://img.test/q.jpg', credit: 'c', kind: 'person' as const } } },
    { seq: 3, role: 'answer' as const, backdrop: 'black' as const, copy: { role: 'answer' as const, family: 'photo' as const, number: '800M', label: 'users', meaning: 'm', source: { verb: 'from' as const, name: 'OpenAI' } } },
  ];
  const deps = {
    db, sourceDb: db, now: () => clock, sleep: async () => {},
    builder: async () => ({ db, sourceDb: db, jevTransport: stubJev(), write: stubWriter({}), photos: stubPhotos(), renderer, review: cleanReview, storage: st, now: () => clock, builders: { guess_the_number: async () => ({ ok: true as const, payload: {}, frames, candidates: [], historyKeys: ['openai.test/devday'] }) } }),
    meta: () => meta,
    storage: () => st,
    insights: () => ({ storyInsights: async () => ({ metrics: { reach: 50, taps_forward: 40 }, raw: [], notEnoughViewers: false }) }),
  };
  const first = await tick(deps);
  assert.deepEqual(first, { built: 1, scheduled: 1, published: 0, insights: 0 });
  const [set] = await (await import('@/lib/stories/repository')).listSets(db, { series: 'guess_the_number' });
  assert.equal(set!.status, 'scheduled');
  const at = new Date(set!.publish_at!);
  assert.ok(at >= new Date('2026-10-08T12:30:00Z') && at <= new Date('2026-10-08T14:00:00Z'));

  clock = new Date(at.getTime() + 1000);
  const second = await tick(deps);
  assert.equal(second.published, 1);
  assert.deepEqual(published, ['c:01-intro.jpg', 'c:02-question.jpg', 'c:03-answer.jpg']);
  const got = await getSet(db, set!.id);
  assert.equal(got!.set.status, 'published');
  assert.deepEqual([...(await recentKeys(db, 'guess_the_number', 30, clock))], ['openai.test/devday']);
  // Only the published person photo goes into Tommy's used-photo log (S-24).
  assert.deepEqual([...(await recentUsedPhotoUrls(db, clock))], ['https://img.test/q.jpg']);

  // The same pass polled the new frames' first insights; a minute later nothing is due.
  assert.equal(second.insights, 3);
  clock = new Date(clock.getTime() + 60_000);
  assert.equal((await tick(deps)).insights, 0);
  const { rows } = await db.query<{ reach: number; final: boolean }>(`SELECT reach, final FROM stories.insights`);
  assert.equal(rows.length, 3);
  assert.equal(rows[0]!.final, false);
});

test('worker: a flagged auto set is not self-approved even with approval off', async () => {
  const { db } = await harnessDb();
  await saveSeriesSetting(db, 'guess_the_number', { auto: true });
  await setSwitches(db, { requireApproval: false, publishingLive: true });
  const renderer = await stubRenderer();
  const flagging: ReviewCall = async () => ({ error: 'review call failed: 529', usage: null });
  const st = storage();
  const deps = {
    db, sourceDb: db, now: () => new Date('2026-10-08T08:00:00Z'),
    builder: async () => ({ db, sourceDb: db, jevTransport: stubJev(), write: stubWriter({}), photos: stubPhotos(), renderer, review: flagging, storage: st, builders: { guess_the_number: async () => ({ ok: true as const, payload: {}, frames: [{ seq: 1, role: 'intro' as const, backdrop: 'black' as const, copy: { role: 'intro' as const, difficulty: 'low' as const, topic: 't' } }], candidates: [], historyKeys: [] }) } }),
    meta: () => { throw new Error('not used'); },
    storage: () => st,
    insights: () => { throw new Error('not used'); },
  };
  const r = await tick(deps);
  assert.equal(r.built, 1);
  assert.equal(r.scheduled, 0);
  const sets = await (await import('@/lib/stories/repository')).listSets(db, {});
  assert.equal(sets[0]!.status, 'ready');
  assert.equal(sets[0]!.flagged, true);
});

test('worker (defaults): nothing before 4 AM; an auto set waits at ready for Approve; an approved set is not scheduled while publishing is off', async () => {
  const { db } = await harnessDb();
  await saveSeriesSetting(db, 'guess_the_number', { auto: true });
  const renderer = await stubRenderer();
  const st = storage();
  let clock = new Date('2026-10-08T07:30:00Z'); // 3:30 AM New York
  const frames = [{ seq: 1, role: 'intro' as const, backdrop: 'black' as const, copy: { role: 'intro' as const, difficulty: 'low' as const, topic: 't' } }];
  const deps = {
    db, sourceDb: db, now: () => clock,
    builder: async () => ({ db, sourceDb: db, jevTransport: stubJev(), write: stubWriter({}), photos: stubPhotos(), renderer, review: cleanReview, storage: st, builders: { guess_the_number: async () => ({ ok: true as const, payload: {}, frames, candidates: [], historyKeys: [] }) } }),
    meta: () => { throw new Error('nothing may publish'); },
    storage: () => st,
    insights: () => { throw new Error('not used'); },
  };
  assert.deepEqual(await tick(deps), { built: 0, scheduled: 0, published: 0, insights: 0 });
  clock = new Date('2026-10-08T08:00:00Z'); // 4:00 AM
  assert.equal((await tick(deps)).built, 1);
  const repo = await import('@/lib/stories/repository');
  const [set] = await repo.listSets(db, { series: 'guess_the_number' });
  assert.equal(set!.status, 'ready', 'require_approval is on by default');
  await repo.approveSet(db, set!.id);
  assert.equal((await tick(deps)).scheduled, 0, 'publishing_live is off by default');
  assert.equal((await getSet(db, set!.id))!.set.status, 'approved');
});

test('insights: a frame gets its final capture at 23 hours, before it drops out at 24', async () => {
  const { db } = await harnessDb();
  const { set } = await requestSet(db, { series: 'morning_download', nyDate: DATE, trigger: 'click', style: 'polished' });
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO stories.frames (set_id, seq, role, template, backdrop, copy, ig_media_id, published_at)
     VALUES ($1, 1, 'opener', 't', 'black', '{}'::jsonb, 'm1', '2026-10-08T13:00:00Z') RETURNING id`,
    [set.id],
  );
  const repo = await import('@/lib/stories/repository');
  // Captured at 22:10; the next 2-hour poll would be at 24:10, after the cutoff.
  await repo.recordInsights(db, rows[0]!.id, { reach: 1 }, [], false, new Date('2026-10-09T11:10:00Z'));
  const at23 = new Date('2026-10-09T12:00:30Z');
  assert.deepEqual((await repo.framesDueForInsights(db, { now: at23 })).map((f) => f.ig_media_id), ['m1']);
});

/* ── The writer call ─────────────────────────────────────────────── */

test('writer: a paused web-search turn is resumed; a refusal throws; costs land on the set', async () => {
  const { db } = await harnessDb();
  const { set } = await requestSet(db, { series: 'free_vs_paid', nyDate: DATE, trigger: 'click', style: 'homemade' });
  let n = 0;
  const create = async (params: Record<string, unknown>) => {
    n++;
    const base = { id: `m${n}`, type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 10 } };
    if (n === 1) return { ...base, stop_reason: 'pause_turn', content: [{ type: 'server_tool_use', id: 's', name: 'web_search', input: {} }] } as never;
    assert.equal((params.messages as unknown[]).length, 2);
    return { ...base, stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'submit_tease', input: { tease: 'ok' } }] } as never;
  };
  const r = await writeStructured<{ tease: string }>({ create, db, setId: set.id, component: 'fvp-copy@1', model: 'claude-sonnet-5-5', system: 'S', tool: { name: 'submit_tease', description: 'd', input_schema: {} }, user: 'U', webSearch: { maxUses: 5 } });
  assert.equal(r.value.tease, 'ok');
  assert.equal(r.usage.length, 2);
  assert.equal((await getSet(db, set.id))!.set.spend_usd, 0.0006);
  const refusing = async () => ({ id: 'r', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'refusal', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 }, content: [] }) as never;
  await assert.rejects(writeStructured({ create: refusing, db, setId: null, component: 'x', model: 'claude-sonnet-5-5', system: 'S', tool: { name: 't', description: 'd', input_schema: {} }, user: 'U' }), /refused/);
});
