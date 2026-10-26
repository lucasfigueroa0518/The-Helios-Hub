import assert from 'node:assert/strict';
import test from 'node:test';

import type { ExplainersDb } from '@/lib/explainers/db';
import { addTopics } from '@/lib/explainers/repository';
import {
  addStory,
  finishScout,
  getStory,
  listStories,
  pickSeedTopics,
  recordRealCaseCost,
  cycleSpend,
  saveStoryCheck,
  saveStoryScores,
  setStoryStatus,
  startCycle,
  startScout,
  trimStoryPool,
  type NewStory,
} from '@/lib/real-case/repository';
import { ensureRealCaseSchema, realCaseStatements } from '@/lib/real-case/schema';
import { compareStories, STORY_BAR, storyBarMisses, storyTotal } from '@/lib/real-case/scoring';
import { DEFAULT_REAL_CASE_SETTINGS, loadRealCaseSettings, saveRealCaseSetting } from '@/lib/real-case/settings';
import {
  archivedCopyUrl,
  checkStoryClaims,
  excerptOnPage,
  htmlToText,
  normalizeForMatch,
  urlProblem,
  type FetchedPage,
  type PageFetcher,
} from '@/lib/real-case/source-check';
import type { StoryClaim, StoryScores, StorySource } from '@/lib/real-case/types';

import { scratchExplainersDb } from './explainers-pglite';

async function freshDb(): Promise<ExplainersDb> {
  const { db } = await scratchExplainersDb();
  await ensureRealCaseSchema(db);
  return db;
}

async function topic(db: ExplainersDb, title: string, status: string, score: number | null): Promise<string> {
  const [row] = await addTopics(db, [{ title, origin: 'manual' }]);
  await db.query('UPDATE explainers.topics SET status = $2, weighted_score = $3 WHERE id = $1', [row.id, status, score]);
  return row.id;
}

const BEATS = {
  incident: 'A search assistant told people to add glue to pizza sauce.',
  puzzle: 'The advice already existed online, as a joke. How did a joke become the answer?',
  steps: [
    { step: 'retrieve', in_story: 'search pulls the joke post' },
    { step: 'augment', in_story: 'the post sits beside the question' },
    { step: 'generate', in_story: 'the model writes from it' },
  ],
  click: 'The model writes from what it is handed.',
  other_side: 'Limiting forum posts at the retrieve step.',
  takeaway: 'Check what it cites.',
};

function newStory(topicId: string, title: string, over: Partial<NewStory> = {}): NewStory {
  return {
    topicId,
    scoutId: null,
    cycleId: null,
    term: 'retrieval-augmented generation',
    title,
    summary: 'A summary.',
    polarity: 'failure',
    story: BEATS,
    claims: [],
    sources: [],
    ...over,
  };
}

const SCORES = (n: number): StoryScores => ({ recognition: n, tension: n, illumination: n, mechanism_fit: n, tellable: n });

// ── Schema and isolation (RC-01) ────────────────────────────────────────────

test('the real_case schema applies twice without error and leaves explainers settings alone', async () => {
  const { db } = await scratchExplainersDb();
  const before = await db.query('SELECT key, value FROM explainers.settings ORDER BY key');
  await ensureRealCaseSchema(db);
  for (const sql of realCaseStatements()) await db.query(sql);
  const after = await db.query('SELECT key, value FROM explainers.settings ORDER BY key');
  assert.deepEqual(after.rows, before.rows);
  const settings = await loadRealCaseSettings(db);
  assert.deepEqual(settings, DEFAULT_REAL_CASE_SETTINGS);
});

test('the schema file has no foreign key into explainers', () => {
  for (const sql of realCaseStatements()) assert.doesNotMatch(sql, /REFERENCES\s+explainers\./i);
});

test('a full pass of this route never changes an Explainer topic', async () => {
  const db = await freshDb();
  const a = await topic(db, 'RAG', 'pool', 80);
  await topic(db, 'DNS', 'rendered', 70);
  const snapshot = async () => (await db.query('SELECT * FROM explainers.topics ORDER BY id')).rows;
  const before = await snapshot();

  const cycleId = await startCycle(db, { mode: 'development', trigger: 'auto' });
  const seeds = await pickSeedTopics(db, { limit: 3, cooldownDays: 30 });
  const scoutId = await startScout(db, seeds[0], cycleId);
  const story = await addStory(db, newStory(a, 'Glue on pizza', { scoutId, cycleId }));
  await saveStoryScores(db, story.id, SCORES(3.5), storyTotal(SCORES(3.5)));
  await setStoryStatus(db, story.id, 'pool');
  await trimStoryPool(db, 0);
  await finishScout(db, scoutId, { outcome: 'found', storiesFound: 1, bestScore: 87.5 });

  assert.deepEqual(await snapshot(), before);
});

// ── Seeds (RC-08) ───────────────────────────────────────────────────────────

test('seeds: every non-archived topic, best Explainer score first', async () => {
  const db = await freshDb();
  await topic(db, 'Pool topic', 'pool', 60);
  await topic(db, 'Rendered topic', 'rendered', 90);
  await topic(db, 'Analogy-rejected topic', 'rejected', 75);
  await topic(db, 'Archived topic', 'archived', 99);
  await topic(db, 'Unscored topic', 'proposed', null);
  const seeds = await pickSeedTopics(db, { limit: 10, cooldownDays: 30 });
  assert.deepEqual(
    seeds.map((s) => s.title),
    ['Rendered topic', 'Analogy-rejected topic', 'Pool topic', 'Unscored topic'],
  );
});

test('seeds: a topic searched inside the cooldown is skipped, unless the search failed', async () => {
  const db = await freshDb();
  const now = new Date('2026-10-25T12:00:00Z');
  const found = await topic(db, 'Found recently', 'pool', 90);
  const weak = await topic(db, 'Weak recently', 'pool', 85);
  const failed = await topic(db, 'Failed recently', 'pool', 80);
  const old = await topic(db, 'Searched long ago', 'pool', 70);
  for (const [id, title, outcome, at] of [
    [found, 'Found recently', 'found', '2026-10-20T00:00:00Z'],
    [weak, 'Weak recently', 'weak', '2026-10-01T00:00:00Z'],
    [failed, 'Failed recently', 'failed', '2026-10-24T00:00:00Z'],
    [old, 'Searched long ago', 'none', '2026-08-01T00:00:00Z'],
  ] as const) {
    const scout = await startScout(db, { id, title }, null);
    await db.query('UPDATE real_case.topic_scouts SET outcome = $2, scouted_at = $3 WHERE id = $1', [scout, outcome, at]);
  }
  const seeds = await pickSeedTopics(db, { limit: 10, cooldownDays: 30, now });
  assert.deepEqual(seeds.map((s) => s.title), ['Failed recently', 'Searched long ago']);
});

test('the nightly cycle runs once per New York day; clicks are not limited', async () => {
  const db = await freshDb();
  const now = new Date('2026-10-25T12:00:00Z');
  assert.ok(await startCycle(db, { mode: 'development', trigger: 'auto', now }));
  assert.equal(await startCycle(db, { mode: 'development', trigger: 'auto', now }), null);
  assert.ok(await startCycle(db, { mode: 'development', trigger: 'click', now }));
  assert.ok(await startCycle(db, { mode: 'development', trigger: 'click', now }));
});

// ── Pool ────────────────────────────────────────────────────────────────────

test('trim keeps the best pool_size stories and never cuts the kept one', async () => {
  const db = await freshDb();
  const t = await topic(db, 'RAG', 'pool', 80);
  const ids: Record<string, string> = {};
  for (const [title, score] of [['low', 2], ['mid', 3], ['high', 3.8], ['kept', 1]] as const) {
    const s = await addStory(db, newStory(t, title));
    await saveStoryScores(db, s.id, SCORES(score), storyTotal(SCORES(score)));
    await setStoryStatus(db, s.id, 'pool');
    ids[title] = s.id;
  }
  const cut = await trimStoryPool(db, 2, ids.kept);
  assert.deepEqual(new Set(cut), new Set([ids.low, ids.mid]));
  assert.deepEqual((await listStories(db, ['pool'])).map((s) => s.title), ['high', 'kept']);
  assert.equal((await getStory(db, ids.low))?.reject_reason, 'Below the pool cut.');
});

test('costs: a cycle sums its own spend; a negative cost is refused', async () => {
  const db = await freshDb();
  const cycleId = (await startCycle(db, { mode: 'development', trigger: 'click' }))!;
  await recordRealCaseCost(db, { cycleId, mode: 'development', vendor: 'anthropic', component: 'story_scout', webSearches: 4, usd: 0.2 });
  await recordRealCaseCost(db, { cycleId, mode: 'development', vendor: 'jev', component: 'story_scoring', usd: 0.01 });
  await recordRealCaseCost(db, { mode: 'development', vendor: 'jev', component: 'other', usd: 5 });
  assert.equal(Math.round((await cycleSpend(db, cycleId)) * 100) / 100, 0.21);
  await assert.rejects(recordRealCaseCost(db, { mode: 'development', vendor: 'jev', component: 'x', usd: -1 }));
});

// ── Scoring (RC-13) ─────────────────────────────────────────────────────────

test('scoring: total out of 100, the bar, the floors and the tie-breaks', () => {
  assert.equal(storyTotal(SCORES(4)), 100);
  assert.equal(storyTotal(SCORES(2)), 50);
  assert.deepEqual(storyBarMisses(SCORES(3.5)), []);
  const weakFit = { ...SCORES(4), mechanism_fit: 2 };
  assert.ok(storyTotal(weakFit) >= STORY_BAR.total);
  assert.deepEqual(storyBarMisses(weakFit), ['mechanism fit 2 of 4, under 2.5']);
  // Same total; mechanism fit breaks the tie.
  const a = { ...SCORES(3), mechanism_fit: 4, illumination: 2 };
  const b = { ...SCORES(3), mechanism_fit: 2, illumination: 4 };
  assert.equal(storyTotal(a), storyTotal(b));
  assert.ok(compareStories(a, b) > 0);
});

test('settings: a valid change saves; an invalid one throws', async () => {
  const db = await freshDb();
  assert.equal(await saveRealCaseSetting(db, 'topics_per_night', 5), 5);
  assert.equal((await loadRealCaseSettings(db)).topics_per_night, 5);
  await assert.rejects(saveRealCaseSetting(db, 'nightly_cap_usd', -1));
  await assert.rejects(saveRealCaseSetting(db, 'auto_scout', 'yes'));
});

// ── Source check (RC-13) ────────────────────────────────────────────────────

test('htmlToText drops scripts, styles and tags and decodes entities', () => {
  const html = '<html><head><style>p{}</style><script>var x = "glue";</script></head><body><p>Add&nbsp;1/8 cup of <b>non&#8209;toxic</b> glue&hellip;</p><!-- hidden --></body></html>';
  assert.equal(htmlToText(html), 'Add 1/8 cup of non‑toxic glue…');
});

test('matching ignores case, punctuation and quote style, but not words or their order', () => {
  const page = 'Google said: “We’ve made more than a dozen technical improvements to our systems.”';
  assert.ok(excerptOnPage(page, "we've made more than a dozen technical improvements"));
  assert.ok(excerptOnPage(page, 'We’ve made more than a dozen technical  improvements'));
  assert.equal(excerptOnPage(page, 'we made more than a dozen technical improvements'), false);
  assert.equal(excerptOnPage(page, 'more than a dozen improvements technical'), false);
  // Whole words only: "dozen tech" is not on the page.
  assert.equal(excerptOnPage(page, 'more than a dozen tech'), false);
  assert.equal(normalizeForMatch('Non‑toxic — glue!'), 'non toxic glue');
});

test('urlProblem refuses non-web, credentialed and private addresses', () => {
  assert.equal(urlProblem('https://blog.google/products/search/ai-overviews-update-may-2024/'), null);
  assert.ok(urlProblem('file:///etc/passwd'));
  assert.ok(urlProblem('http://localhost:3000/x'));
  assert.ok(urlProblem('http://127.0.0.1/'));
  assert.ok(urlProblem('http://10.1.2.3/'));
  assert.ok(urlProblem('http://192.168.0.4/'));
  assert.ok(urlProblem('http://169.254.169.254/latest/meta-data'));
  assert.ok(urlProblem('http://[::1]/'));
  assert.ok(urlProblem('https://user:pw@example.com/'));
  assert.ok(urlProblem('not a url'));
});

const LIVE = 'https://example.com/postmortem';
const MOVED = 'https://example.com/old-post';
const DOWN = 'https://example.com/gone';
const PDF = 'https://example.com/ruling.pdf';

function stubFetcher(pages: Record<string, FetchedPage>, calls: string[] = []): PageFetcher {
  return async (url) => {
    calls.push(url);
    return pages[url] ?? { ok: false, reason: 'HTTP 404', status: 404 };
  };
}

const html = (body: string): FetchedPage => ({ ok: true, url: '', contentType: 'text/html; charset=utf-8', body: `<p>${body}</p>` });
const wayback = (url: string, stamp: string): FetchedPage => ({
  ok: true,
  url: '',
  contentType: 'application/json',
  body: JSON.stringify({ archived_snapshots: { closest: { available: true, url: `http://web.archive.org/web/${stamp}/${url}`, timestamp: stamp } } }),
});

test('archivedCopyUrl asks for the copy nearest the date and returns its raw form', async () => {
  const calls: string[] = [];
  const fetcher = stubFetcher({ [`https://archive.org/wayback/available?url=${encodeURIComponent(LIVE)}&timestamp=20240530`]: wayback(LIVE, '20240531000000') }, calls);
  assert.equal(await archivedCopyUrl(LIVE, fetcher, '20240530'), `http://web.archive.org/web/20240531000000id_/${LIVE}`);
  // The availability API failing: the snapshot address, which redirects to the nearest copy.
  assert.equal(await archivedCopyUrl(LIVE, stubFetcher({})), `https://web.archive.org/web/2id_/${LIVE}`);
});

test('checkStoryClaims: live, archive fallback, unreachable, unreadable, invalid', async () => {
  const sources: StorySource[] = [
    { id: 's1', url: LIVE, publisher: 'Example', kind: 'postmortem' },
    { id: 's2', url: MOVED, publisher: 'Example', kind: 'statement', published: '2024-05-30' },
    { id: 's3', url: DOWN, publisher: 'Example', kind: 'press' },
    { id: 's4', url: PDF, publisher: 'Court', kind: 'court' },
    { id: 's5', url: 'http://127.0.0.1/admin', publisher: 'Nobody', kind: 'other' },
  ];
  const movedCopy = `http://web.archive.org/web/20240531000000id_/${MOVED}`;
  const calls: string[] = [];
  const fetcher = stubFetcher(
    {
      [LIVE]: html('The deploy reached seven of the eight servers before markets opened.'),
      [MOVED]: html('This post has been updated with an editor’s note.'),
      [`https://archive.org/wayback/available?url=${encodeURIComponent(MOVED)}&timestamp=20240530`]: wayback(MOVED, '20240531000000'),
      [movedCopy]: html('We limited the inclusion of satire and humor content in these answers.'),
      [PDF]: { ok: true, url: PDF, contentType: 'application/pdf', body: '%PDF-1.7' },
    },
    calls,
  );
  const claim = (id: string, source_id: string, excerpt: string, core = true): StoryClaim => ({ id, text: id, source_id, excerpt, core });
  const result = await checkStoryClaims(
    [
      claim('c1', 's1', 'reached seven of the eight servers before markets opened'),
      claim('c2', 's1', 'reached all eight servers before markets opened'),
      claim('c3', 's2', 'limited the inclusion of satire and humor content'),
      claim('c4', 's3', 'this page does not exist any more at all', false),
      claim('c5', 's4', 'the court finds that the citations were fake'),
      claim('c6', 's5', 'anything at all on a private address here'),
      claim('c7', 's1', 'seven servers', false),
      claim('c8', 's9', 'a source id the story never listed anywhere'),
    ],
    sources,
    fetcher,
    new Date('2026-10-25T00:00:00Z'),
  );
  const status = Object.fromEntries(result.claims.map((c) => [c.id, `${c.check?.status}${c.check?.via ? `/${c.check.via}` : ''}`]));
  assert.deepEqual(status, {
    c1: 'verified/live',
    c2: 'mismatch/live',
    c3: 'verified/archive',
    c4: 'unreachable',
    c5: 'unreadable',
    c6: 'invalid',
    c7: 'invalid',
    c8: 'invalid',
  });
  assert.deepEqual(result.failedCore, ['c2', 'c5', 'c6', 'c8']);
  assert.deepEqual(result.failedOther, ['c4', 'c7']);
  // Each source's live page is fetched once; the private address never.
  assert.equal(calls.filter((u) => u === LIVE).length, 1);
  assert.equal(calls.some((u) => u.includes('127.0.0.1')), false);
});

test('a failed core claim rejects the story; failed non-core claims only mark the claim', async () => {
  const db = await freshDb();
  const t = await topic(db, 'RAG', 'pool', 80);
  const okStory = await addStory(db, newStory(t, 'ok'));
  const badStory = await addStory(db, newStory(t, 'bad'));
  const at = '2026-10-25T00:00:00.000Z';
  const base = { text: 'x', source_id: 's1', excerpt: 'x' };
  assert.equal(
    await saveStoryCheck(db, okStory.id, {
      claims: [{ ...base, id: 'c1', core: true, check: { status: 'verified', via: 'live', checked_at: at } }, { ...base, id: 'c2', core: false, check: { status: 'mismatch', checked_at: at } }],
      failedCore: [],
      failedOther: ['c2'],
    }),
    'proposed',
  );
  assert.equal(
    await saveStoryCheck(db, badStory.id, {
      claims: [{ ...base, id: 'c1', core: true, check: { status: 'mismatch', detail: 'excerpt not on source s1', checked_at: at } }],
      failedCore: ['c1'],
      failedOther: [],
    }),
    'rejected',
  );
  const bad = await getStory(db, badStory.id);
  assert.equal(bad?.reject_reason, 'Source check failed for core claim c1: c1 mismatch (excerpt not on source s1).');
  assert.equal((await getStory(db, okStory.id))?.claims[1].check?.status, 'mismatch');
});
