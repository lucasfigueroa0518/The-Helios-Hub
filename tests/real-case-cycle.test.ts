import assert from 'node:assert/strict';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';
import type { EntryType, Questions, SystemOneResult } from '@typesafe-ai/sdk';

import type { ExplainersDb } from '@/lib/explainers/db';
import { addTopics } from '@/lib/explainers/repository';
import { findStoriesForTopic, runStoryCycle, type StoryCycleResult } from '@/lib/real-case/cycle';
import { STORY_GATE, STORY_SCORING } from '@/lib/real-case/jev/questions';
import { listLatestScouts, listStories } from '@/lib/real-case/repository';
import { ensureRealCaseSchema } from '@/lib/real-case/schema';
import {
  parseStories,
  runScout,
  ScoutError,
  REAL_CASE_BRIEF,
  STORY_SCOUT_INSTRUCTIONS,
  storyScoutParams,
  type ScoutedStory,
  type ScoutRequest,
  type StoryScout,
} from '@/lib/real-case/scout';
import { saveRealCaseSetting } from '@/lib/real-case/settings';
import type { FetchedPage, PageFetcher } from '@/lib/real-case/source-check';
import type { StoryScores } from '@/lib/real-case/types';
import type { JevTransport } from '@/lib/reels/jev/runner';

import { scratchExplainersDb } from './explainers-pglite';

// ── Fixtures ────────────────────────────────────────────────────────────────
// Invented, neutral events: the tests check plumbing, never a real case's facts.

const PAGE = 'https://example.org/report';
const PAGE_TEXT = 'The nightly job copied the old file over the new one before anyone noticed the change. The team added a check that compares dates first.';

function story(title: string, over: Partial<ScoutedStory> = {}): ScoutedStory {
  return {
    term: 'file sync',
    title,
    summary: 'A nightly job overwrote newer work with an older copy.',
    polarity: 'failure',
    story: {
      incident: 'A shop lost a day of edits.',
      puzzle: 'Why would a backup erase work?',
      steps: [
        { step: 'compare', in_story: 'the job skipped the date check' },
        { step: 'copy', in_story: 'the old file was copied' },
        { step: 'overwrite', in_story: 'the new file was replaced' },
      ],
      click: 'It copied without comparing dates.',
      other_side: 'A date check before copying.',
      takeaway: 'Sync tools need a rule for which copy wins.',
    },
    sources: [{ id: 's1', url: PAGE, publisher: 'Example', kind: 'postmortem', published: '2025-03-01' }],
    claims: [
      { id: 'c1', text: 'The job copied the old file over the new one.', source_id: 's1', excerpt: 'the nightly job copied the old file over the new one', core: true },
      { id: 'c2', text: 'A date check was added.', source_id: 's1', excerpt: 'the team added a check that compares dates first', core: false },
    ],
    ...over,
  };
}

/** A story as the scout's tool input carries it: the beats at the top level. */
function toolInput(s: ScoutedStory): Record<string, unknown> {
  const { story: beats, ...rest } = s;
  return { ...rest, ...beats };
}

const fetcher: PageFetcher = async (url): Promise<FetchedPage> =>
  url === PAGE ? { ok: true, url, contentType: 'text/html', body: `<p>${PAGE_TEXT}</p>` } : { ok: false, reason: 'HTTP 404', status: 404 };

const SCORES = (n: number): StoryScores => ({ recognition: n, tension: n, illumination: n, mechanism_fit: n, tellable: n });

/** Jev stub: scores and gates by story title; same-event matches by a shared title prefix before " #". */
function stubJev(scoreByTitle: Record<string, number>, gated: string[] = []) {
  const calls: string[] = [];
  const transport: JevTransport = {
    async systemOne<const Q extends Questions>(state: EntryType, questions: Q) {
      const s = state as Record<string, any>;
      const keys = Object.keys(questions);
      calls.push(keys[0]);
      const event = (t: string) => t.split(' #')[0];
      const answers: Record<string, unknown> = {};
      for (const key of keys) {
        if (key in STORY_SCORING.questions) answers[key] = { type: 'score', score: scoreByTitle[s.story.title] ?? 2, confidence: 1 };
        else if (key in STORY_GATE.questions) answers[key] = { type: 'noul', noul: key === 'private_person' && gated.includes(s.story.title) ? 0.9 : 0.1 };
        else if (key === 'same_event_as_existing') answers[key] = { type: 'noul', noul: s.history.some((h: { title: string }) => event(h.title) === event(s.candidate.title)) ? 0.9 : 0.1 };
        else if (key === 'same_lesson_as_recent') answers[key] = { type: 'noul', noul: 0.1 };
        else answers[key] = { type: 'noul', noul: event(s.incumbents[key].title) === event(s.candidate.title) ? 0.9 : 0.1 };
      }
      return { model: 'jev-stub', answers, usage: { input_tokens: 1000, output_tokens: 0 } } as unknown as SystemOneResult<Q>;
    },
  };
  return { transport, calls };
}

function stubScout(byTopic: Record<string, ScoutedStory[] | Error>, usd = 0.2): StoryScout & { asked: ScoutRequest[] } {
  const asked: ScoutRequest[] = [];
  return {
    asked,
    async scout(request) {
      asked.push(request);
      const result = byTopic[request.topic.title] ?? [];
      if (result instanceof Error) throw new ScoutError(result.message, { model: 'stub', usages: [], webSearches: 2, usd: 0.05 });
      return { stories: result, dropped: [], model: 'stub', usages: [{ usage: { input_tokens: 5000, output_tokens: 800 } }], webSearches: 4, usd };
    },
  };
}

async function freshDb(): Promise<ExplainersDb> {
  const { db } = await scratchExplainersDb();
  await ensureRealCaseSchema(db);
  return db;
}

async function topic(db: ExplainersDb, title: string, score: number, status = 'pool'): Promise<string> {
  const [row] = await addTopics(db, [{ title, origin: 'manual' }]);
  await db.query('UPDATE explainers.topics SET status = $2, weighted_score = $3 WHERE id = $1', [row.id, status, score]);
  return row.id;
}

const ok = (r: StoryCycleResult) => {
  assert.equal(r.status, 'ok', JSON.stringify(r));
  return r as Extract<StoryCycleResult, { status: 'ok' }>;
};

// ── The scout prompt and request ────────────────────────────────────────────

const REQUEST: ScoutRequest = { model: 'claude-sonnet-5-5', topic: { title: 'Topic A', scope: 'Scope A', term: 'term a' }, storiesPerTopic: 3 };

test('scout request: cached stable system, web tools, strict submit tool, no forced tool choice', () => {
  const params = storyScoutParams(REQUEST);
  const system = params.system as Anthropic.TextBlockParam[];
  assert.equal(system.length, 1);
  assert.deepEqual(system[0].cache_control, { type: 'ephemeral', ttl: '1h' });
  assert.ok(system[0].text.includes(REAL_CASE_BRIEF));
  // The Explainer brief's analogy rule never reaches this prompt.
  assert.equal(/analog/i.test(system[0].text), false);
  // The topic is never in the cached prefix.
  assert.equal(system[0].text.includes('Topic A'), false);
  const tools = params.tools as unknown as { type?: string; name: string; strict?: boolean }[];
  assert.deepEqual(tools.map((t) => t.type ?? t.name), ['web_search_20260209', 'web_fetch_20260209', 'submit_stories']);
  assert.equal(tools[2].strict, true);
  assert.deepEqual(params.tool_choice, { type: 'auto' });
  const user = params.messages[0].content as string;
  assert.ok(user.includes('Topic: Topic A') && user.includes('Term: term a') && user.includes('up to 3 stories'));
  // Same prefix for another topic: the cache is shared.
  assert.deepEqual(storyScoutParams({ ...REQUEST, topic: { title: 'Other', scope: null, term: null } }).system, params.system);
});

test('the scout prompt names no real incident (no example pollution)', () => {
  for (const text of [STORY_SCOUT_INSTRUCTIONS, REAL_CASE_BRIEF]) for (const word of ['glue', 'pizza', 'Avianca', 'Air Canada', 'Knight', 'Replit', 'Fastly', 'Facebook', 'left-pad', 'Mars']) {
    assert.equal(text.toLowerCase().includes(word.toLowerCase()), false, word);
  }
});

function message(over: Partial<Anthropic.Message>): Anthropic.Message {
  return {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content: [],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 100, server_tool_use: { web_search_requests: 3 } },
    ...over,
  } as unknown as Anthropic.Message;
}

test('runScout resumes a paused turn without a new user message, then parses the submission', async () => {
  const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const paused = [{ type: 'server_tool_use', id: 'srv1', name: 'web_search', input: { query: 'q' } }];
  const replies = [
    message({ stop_reason: 'pause_turn' as never, content: paused as never }),
    message({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'submit_stories', input: { stories: [toolInput(story('One'))] } }] as never }),
  ];
  const result = await runScout(async (params) => {
    sent.push(params);
    return replies.shift()!;
  }, REQUEST);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].messages.length, 2);
  assert.equal(sent[1].messages[0].role, 'user');
  assert.equal(sent[1].messages[1].role, 'assistant');
  assert.deepEqual(sent[1].messages[1].content, paused);
  assert.deepEqual(result.stories.map((s) => s.title), ['One']);
  assert.equal(result.webSearches, 6);
  // Sonnet 5.5: 2 × (1000 in at $2/M + 100 out at $10/M) + 6 searches at $0.01.
  assert.equal(Math.round(result.usd * 10000) / 10000, 0.066);
});

test('runScout: ending without submit_stories, or a refusal, is an error that carries its spend', async () => {
  await assert.rejects(runScout(async () => message({ content: [{ type: 'text', text: 'done' }] as never }), REQUEST), (e: unknown) => {
    assert.ok(e instanceof ScoutError);
    assert.match(e.message, /without calling submit_stories/);
    assert.equal(e.spend.webSearches, 3);
    return true;
  });
  await assert.rejects(runScout(async () => message({ stop_reason: 'refusal' as never }), REQUEST), /declined/);
});

test('parseStories keeps valid stories and sets aside broken ones with why', () => {
  const twoSteps = story('Two steps');
  twoSteps.story = { ...twoSteps.story, steps: twoSteps.story.steps.slice(0, 2) };
  const missing = story('Missing');
  missing.story = { ...missing.story, takeaway: '' };
  const parsed = parseStories(
    {
      stories: [
        story('Good'),
        { ...story('No core'), claims: story('x').claims.map((c) => ({ ...c, core: false })) },
        { ...story('Bad source'), claims: [{ ...story('x').claims[0], source_id: 's9' }] },
        twoSteps,
        missing,
        story('Good'),
        story('Second'),
        story('Third'),
      ].map(toolInput),
    },
    2,
  );
  assert.deepEqual(parsed.stories.map((s) => s.title), ['Good', 'Second']);
  assert.deepEqual(parsed.dropped, [
    { title: 'No core', why: 'no core claim' },
    { title: 'Bad source', why: 'claim c1 cites s9, which is not listed' },
    { title: 'Two steps', why: 'needs 3 or 4 steps, each with its name and what it was in the story' },
    { title: 'Missing', why: 'missing takeaway' },
    { title: 'Good', why: 'repeats an earlier title' },
    { title: 'Third', why: 'over the 2 asked for' },
  ]);
  assert.throws(() => parseStories({}, 3), /no stories list/);
});

// ── The cycle ───────────────────────────────────────────────────────────────

test('the nightly cycle is off unless auto_scout is on, and runs once a day', async () => {
  const db = await freshDb();
  await topic(db, 'Topic A', 80);
  const scout = stubScout({});
  const { transport } = stubJev({});
  const now = new Date('2026-10-26T07:00:00Z');
  assert.deepEqual(await runStoryCycle({ db, scout, jevTransport: transport, fetcher, now }), { status: 'skipped', reason: 'auto_scout_off' });
  await saveRealCaseSetting(db, 'auto_scout', true);
  ok(await runStoryCycle({ db, scout, jevTransport: transport, fetcher, now }));
  await topic(db, 'Topic B', 70);
  assert.deepEqual(await runStoryCycle({ db, scout, jevTransport: transport, fetcher, now }), { status: 'skipped', reason: 'already_ran_today' });
  assert.equal(scout.asked.length, 1);
});

test('a full cycle: found, weak, none and failed topics; checks, gates, bar, pool; Explainer topics untouched', async () => {
  const db = await freshDb();
  await saveRealCaseSetting(db, 'auto_scout', true);
  await saveRealCaseSetting(db, 'topics_per_night', 4);
  await topic(db, 'Found', 90);
  await topic(db, 'Weak', 80);
  await topic(db, 'Nothing', 70);
  await topic(db, 'Broken', 60);
  await topic(db, 'Archived', 99, 'archived');
  const before = (await db.query('SELECT * FROM explainers.topics ORDER BY id')).rows;

  const unverified = story('Unverified', { claims: [{ ...story('x').claims[0], excerpt: 'words that are not on that page at all anywhere' }] });
  const scout = stubScout({
    Found: [story('Strong'), unverified, story('Private'), story('Middling')],
    Weak: [story('Low')],
    Nothing: [],
    Broken: new Error('story scout: the turn ended (end_turn) without calling submit_stories'),
  });
  const { transport } = stubJev({ Strong: 3.6, Private: 3.9, Middling: 2.4, Low: 1.5 }, ['Private']);
  const result = ok(await runStoryCycle({ db, scout, jevTransport: transport, fetcher, now: new Date('2026-10-26T07:00:00Z') }));

  assert.deepEqual(scout.asked.map((r) => r.topic.title), ['Found', 'Weak', 'Nothing', 'Broken']);
  assert.deepEqual(result.topics.map((t) => [t.title, t.outcome]), [['Found', 'found'], ['Weak', 'weak'], ['Nothing', 'none'], ['Broken', 'failed']]);
  const found = result.topics[0].evaluations.map((e) => [e.title, e.evaluation.outcome]);
  assert.deepEqual(found, [['Strong', 'entered_pool'], ['Unverified', 'source_failed'], ['Private', 'gated'], ['Middling', 'below_bar']]);

  const pool = await listStories(db, ['pool']);
  assert.deepEqual(pool.map((s) => s.title), ['Strong']);
  assert.equal(pool[0].weighted_score, 90);
  assert.equal(pool[0].claims.every((c) => c.check?.status === 'verified'), true);
  const rejected = await listStories(db, ['rejected']);
  assert.match(rejected.find((s) => s.title === 'Private')!.reject_reason!, /private person/);
  assert.match(rejected.find((s) => s.title === 'Middling')!.reject_reason!, /^Below the bar: /);

  const scouts = await listLatestScouts(db);
  assert.equal(scouts.find((s) => s.topic_title === 'Broken')?.error, 'story scout: the turn ended (end_turn) without calling submit_stories');
  // 3 paid scouts at $0.20, the failed one's $0.05, and Jev calls: under the cap, all four topics ran.
  assert.equal(result.capped, false);
  assert.ok(result.usd > 0.65 && result.usd < 0.7, String(result.usd));

  assert.deepEqual((await db.query('SELECT * FROM explainers.topics ORDER BY id')).rows, before);
});

test('the nightly cap stops new topics; a cap of 0 searches none', async () => {
  const db = await freshDb();
  await saveRealCaseSetting(db, 'auto_scout', true);
  await saveRealCaseSetting(db, 'nightly_cap_usd', 0.5);
  for (const [t, s] of [['A', 90], ['B', 80], ['C', 70]] as const) await topic(db, t, s);
  const scout = stubScout({}, 0.3);
  const { transport } = stubJev({});
  const r = ok(await runStoryCycle({ db, scout, jevTransport: transport, fetcher, now: new Date('2026-10-26T07:00:00Z') }));
  assert.deepEqual(scout.asked.map((x) => x.topic.title), ['A', 'B']);
  assert.equal(r.capped, true);

  const db2 = await freshDb();
  await saveRealCaseSetting(db2, 'auto_scout', true);
  await saveRealCaseSetting(db2, 'nightly_cap_usd', 0);
  await topic(db2, 'A', 90);
  const scout2 = stubScout({});
  ok(await runStoryCycle({ db: db2, scout: scout2, jevTransport: transport, fetcher, now: new Date('2026-10-26T07:00:00Z') }));
  assert.equal(scout2.asked.length, 0);
});

test('same event: the stronger telling wins the head-to-head; the weaker is displaced', async () => {
  const db = await freshDb();
  const a = await topic(db, 'Topic A', 90);
  const b = await topic(db, 'Topic B', 80);
  const { transport } = stubJev({ 'Outage #1': 3.2, 'Outage #2': 3.8 });
  const deps = { db, jevTransport: transport, fetcher, now: new Date('2026-10-26T07:00:00Z') };
  ok(await findStoriesForTopic({ ...deps, scout: stubScout({ 'Topic A': [story('Outage #1')] }) }, a));
  const second = ok(await findStoriesForTopic({ ...deps, scout: stubScout({ 'Topic B': [story('Outage #2', { term: 'failover' })] }) }, b));
  assert.equal(second.topics[0].evaluations[0].evaluation.outcome, 'won_head_to_head');
  assert.deepEqual((await listStories(db, ['pool'])).map((s) => s.title), ['Outage #2']);
  const displaced = await listStories(db, ['displaced']);
  assert.equal(displaced[0].title, 'Outage #1');
  assert.equal(displaced[0].duplicate_of, (await listStories(db, ['pool']))[0].id);
});

test('a click searches its one topic even with auto_scout off, and skips an archived one', async () => {
  const db = await freshDb();
  const a = await topic(db, 'Topic A', 90);
  const gone = await topic(db, 'Gone', 90, 'archived');
  const scout = stubScout({ 'Topic A': [story('Strong')] });
  const { transport } = stubJev({ Strong: 3.6 });
  const r = ok(await findStoriesForTopic({ db, scout, jevTransport: transport, fetcher }, a));
  assert.equal(r.topics[0].outcome, 'found');
  assert.deepEqual(await findStoriesForTopic({ db, scout, jevTransport: transport, fetcher }, gone), { status: 'skipped', reason: 'no_topics' });
  // Every Jev call and the scout are in this route's own ledger.
  const { rows } = await db.query<{ vendor: string; n: number }>('SELECT vendor, count(*)::int AS n FROM real_case.cost_events GROUP BY vendor ORDER BY vendor');
  assert.deepEqual(rows, [{ vendor: 'anthropic', n: 1 }, { vendor: 'jev', n: 2 }]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM explainers.cost_events')).rows[0].n, 0);
});
