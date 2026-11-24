import assert from 'node:assert/strict';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';
import type { EntryType, Questions, SystemOneResult } from '@typesafe-ai/sdk';

import type { ExplainersDb } from '@/lib/explainers/db';
import { addTopics } from '@/lib/explainers/repository';
import { findNewsStories, labelTopics, runStoryCycle, type StoryCycleResult } from '@/lib/real-case/cycle';
import { STORY_GATE, STORY_SCORING } from '@/lib/real-case/jev/questions';
import { addStory, listLatestScouts, listStories } from '@/lib/real-case/repository';
import { ensureRealCaseSchema } from '@/lib/real-case/schema';
import {
  NEWS_BRIEF,
  parseStories,
  runScout,
  ScoutError,
  STORY_SCOUT_INSTRUCTIONS,
  storyScoutParams,
  windowStart,
  type ScoutedStory,
  type ScoutRequest,
  type StoryScout,
} from '@/lib/real-case/scout';
import { saveRealCaseSetting } from '@/lib/real-case/settings';
import type { FetchedPage, PageFetcher } from '@/lib/real-case/source-check';
import type { JevTransport } from '@/lib/reels/jev/runner';

import { scratchExplainersDb } from './explainers-pglite';

// ── Fixtures ────────────────────────────────────────────────────────────────
// Invented, neutral events: the tests check plumbing, never a real story's facts.

const NOW = new Date('2026-10-26T07:00:00Z');
const PAGE = 'https://example.org/report';
const PAGE_TEXT = [
  'On October 20 the shop switched on a new scheduling assistant for its weekend staff.',
  'Within an hour the assistant booked every worker for the same Saturday shift.',
  'Managers spent the weekend calling staff to cancel the extra shifts.',
  'The assistant read the old roster file, which listed every worker as available.',
  'The shop now checks the roster date before the assistant runs.',
  'Its notice read: "We are sorry for the scheduling mix-up this weekend."',
].join(' ');

const CLAIMS: ScoutedStory['claims'] = [
  { id: 'c1', text: 'The shop switched on a scheduling assistant on October 20.', source_id: 's1', excerpt: 'On October 20 the shop switched on a new scheduling assistant', act: 'setup', core: true },
  { id: 'c2', text: 'The assistant booked every worker for the same shift.', source_id: 's1', excerpt: 'the assistant booked every worker for the same Saturday shift', act: 'moment', core: true },
  { id: 'c3', text: 'Managers called staff all weekend to cancel shifts.', source_id: 's1', excerpt: 'Managers spent the weekend calling staff to cancel the extra shifts', act: 'fallout', core: false },
  { id: 'c4', text: 'The assistant read an old roster file.', source_id: 's1', excerpt: 'The assistant read the old roster file, which listed every worker as available', act: 'reveal', core: true },
  { id: 'c5', text: 'The shop now checks the roster date first.', source_id: 's1', excerpt: 'The shop now checks the roster date before the assistant runs', act: 'since', core: false },
  { id: 'c6', text: 'The shop apologized in a notice.', source_id: 's1', excerpt: 'Its notice read: "We are sorry for the scheduling mix-up this weekend."', act: 'fallout', core: false },
];

function story(title: string, over: Partial<ScoutedStory> = {}): ScoutedStory {
  return {
    term: 'stale data',
    topicId: null,
    title,
    summary: 'A scheduling assistant booked everyone for one shift because it read an old roster.',
    polarity: 'failure',
    story: {
      event_date: '2026-10-20',
      place: null,
      cold_open: 'An assistant booked every worker for the same shift.',
      setup: 'A shop turned on a scheduling assistant.',
      moment: 'Within an hour everyone was booked for Saturday.',
      fallout: 'Managers spent the weekend cancelling shifts.',
      reveal: 'It read an old roster that listed everyone as available.',
      since: 'The shop checks the roster date first.',
      for_you: 'Check what data an assistant reads before it acts.',
      cast: [{ name: 'The shop', kind: 'organization', role: 'ran the assistant' }],
      timeline: [
        { date: '2026-10-20', what: 'Assistant switched on', claim_id: 'c1' },
        { date: '2026-10-20', what: 'Everyone booked', claim_id: 'c2' },
      ],
      artifacts: [{ id: 'a1', kind: 'statement', speaker: 'The shop', text: 'We are sorry for the scheduling mix-up this weekend.', claim_id: 'c6' }],
    },
    sources: [{ id: 's1', url: PAGE, publisher: 'Example', kind: 'statement', published: '2026-10-21' }],
    claims: CLAIMS,
    ...over,
  };
}

/** A story as the scout's tool input carries it: the act material at the top level, topic_key for topicId. */
function toolInput(s: ScoutedStory, topicKey: string | null = null): Record<string, unknown> {
  const { story: acts, topicId: _ignored, ...rest } = s;
  return { ...rest, ...acts, topic_key: topicKey };
}

const fetcher: PageFetcher = async (url): Promise<FetchedPage> =>
  url === PAGE ? { ok: true, url, contentType: 'text/html', body: `<p>${PAGE_TEXT}</p>` } : { ok: false, reason: 'HTTP 404', status: 404 };

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

/** One result per search, in order (an Error fails that search). */
function stubScout(results: (ScoutedStory[] | Error)[], usd = 0.2): StoryScout & { asked: ScoutRequest[] } {
  const asked: ScoutRequest[] = [];
  return {
    asked,
    async scout(request) {
      asked.push(request);
      const result = results[asked.length - 1] ?? [];
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

const REQUEST: ScoutRequest = {
  model: 'claude-sonnet-5-5',
  today: '2026-10-26',
  windowDays: 90,
  storiesPerSearch: 3,
  known: [{ title: 'An earlier event', event_date: '2026-09-01' }],
  topics: [{ key: 'T1', id: '00000000-0000-0000-0000-000000000001', title: 'Topic A' }],
};
const PARSE = { max: 3, today: '2026-10-26', windowDays: 90, topics: REQUEST.topics };

test('scout request: cached stable system, web tools, strict submit tool, no forced tool choice', () => {
  const params = storyScoutParams(REQUEST);
  const system = params.system as Anthropic.TextBlockParam[];
  assert.equal(system.length, 1);
  assert.deepEqual(system[0].cache_control, { type: 'ephemeral', ttl: '1h' });
  assert.ok(system[0].text.includes(NEWS_BRIEF));
  // The Explainer brief's analogy rule never reaches this prompt; nor does the first build's ban on news.
  assert.equal(/analog/i.test(system[0].text), false);
  assert.equal(/out of scope/i.test(system[0].text), false);
  // Today, the window, the known events and the topics are never in the cached prefix.
  for (const part of ['2026-10-26', 'An earlier event', 'Topic A']) assert.equal(system[0].text.includes(part), false, part);
  const tools = params.tools as unknown as { type?: string; name: string; strict?: boolean }[];
  assert.deepEqual(tools.map((t) => t.type ?? t.name), ['web_search_20250305', 'web_fetch_20250910', 'submit_stories']);
  assert.equal(tools[2].strict, true);
  assert.deepEqual(params.tool_choice, { type: 'auto' });
  const user = params.messages[0].content as string;
  for (const part of ['Today: 2026-10-26', 'Window: events from 2026-07-28 to today.', 'up to 3 stories', '- 2026-09-01: An earlier event', '- T1: Topic A']) {
    assert.ok(user.includes(part), part);
  }
  // Same prefix on another day: the cache is shared.
  assert.deepEqual(storyScoutParams({ ...REQUEST, today: '2026-11-02', known: [], topics: [] }).system, params.system);
});

test('the scout prompt names no real event, company or person (no example pollution)', () => {
  for (const text of [STORY_SCOUT_INSTRUCTIONS, NEWS_BRIEF]) {
    for (const word of ['Google', 'Bard', 'OpenAI', 'ChatGPT', 'Anthropic', 'Claude', 'Meta', 'Microsoft', 'Tesla', 'Air Canada', 'Avianca', 'lawyer', 'telescope']) {
      assert.equal(text.toLowerCase().includes(word.toLowerCase()), false, word);
    }
  }
});

test('windowStart counts back whole days', () => {
  assert.equal(windowStart('2026-10-26', 90), '2026-07-28');
  assert.equal(windowStart('2026-03-01', 1), '2026-02-28');
  assert.equal(windowStart('2026-10-26', -1), '2026-10-27');
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
    message({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'submit_stories', input: { stories: [toolInput(story('One'), 'T1')] } }] as never }),
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
  // topic_key T1 resolves to its topic's id.
  assert.equal(result.stories[0].topicId, REQUEST.topics[0].id);
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

test('runScout: a submission cut off by max_tokens, or a malformed one, is a priced ScoutError', async () => {
  const cut = message({ stop_reason: 'max_tokens' as never, content: [{ type: 'tool_use', id: 't', name: 'submit_stories', input: {} }] as never });
  await assert.rejects(runScout(async () => cut, REQUEST), (e: unknown) => e instanceof ScoutError && /max_tokens/.test(e.message) && e.spend.webSearches === 3);
  const bad = message({ stop_reason: 'tool_use' as never, content: [{ type: 'tool_use', id: 't', name: 'submit_stories', input: {} }] as never });
  await assert.rejects(runScout(async () => bad, REQUEST), (e: unknown) => e instanceof ScoutError && /no stories list/.test(e.message));
});

test('parseStories keeps valid stories and sets aside broken ones with why', () => {
  const withActs = (title: string, acts: Partial<ScoutedStory['story']>) => {
    const s = story(title);
    return { ...s, story: { ...s.story, ...acts } };
  };
  const parsed = parseStories(
    {
      stories: [
        story('Good'),
        { ...story('No core'), claims: CLAIMS.map((c) => ({ ...c, core: false })) },
        { ...story('Bad source'), claims: [{ ...CLAIMS[0], source_id: 's9' }, ...CLAIMS.slice(1)] },
        { ...story('No reveal'), claims: CLAIMS.filter((c) => c.act !== 'reveal') },
        withActs('Old', { event_date: '2026-07-01' }),
        withActs('Not a day', { event_date: '2026-10' }),
        withActs('No players', { cast: [] }),
        withActs('One entry', { timeline: [story('x').story.timeline[0]] }),
        withActs('Out of order', { timeline: [{ date: '2026-10-21', what: 'b', claim_id: 'c2' }, { date: '2026-10-20', what: 'a', claim_id: 'c1' }] }),
        withActs('Missing', { since: '' }),
        story('Good'),
        story('Second'),
        story('Third'),
        story('Fourth'),
      ].map((s) => toolInput(s)),
    },
    PARSE,
  );
  assert.deepEqual(parsed.stories.map((s) => s.title), ['Good', 'Second', 'Third']);
  assert.deepEqual(parsed.dropped, [
    { title: 'No core', why: 'no core claim' },
    { title: 'Bad source', why: 'claim c1 cites s9, which is not listed' },
    { title: 'No reveal', why: 'no claim for reveal' },
    { title: 'Old', why: 'event date 2026-07-01 is outside the 90-day window' },
    { title: 'Not a day', why: 'event date "2026-10" is not a YYYY-MM-DD day' },
    { title: 'No players', why: 'needs 1 to 5 players, each with a name, a kind and a role' },
    { title: 'One entry', why: 'needs 2 to 6 timeline entries' },
    { title: 'Out of order', why: 'the timeline is not in date order' },
    { title: 'Missing', why: 'missing since' },
    { title: 'Good', why: 'repeats an earlier title' },
    { title: 'Fourth', why: 'over the 3 asked for' },
  ]);
  assert.throws(() => parseStories({}, PARSE), /no stories list/);
});

test('parseStories keeps an artifact only when its words are inside its claim\'s excerpt', () => {
  const s = story('Quotes');
  s.story = {
    ...s.story,
    artifacts: [
      ...s.story.artifacts,
      { id: 'a2', kind: 'post', speaker: 'The shop', text: 'We are thrilled with the new assistant.', claim_id: 'c6' },
      { id: 'a3', kind: 'post', speaker: 'The shop', text: 'We are sorry', claim_id: 'c9' },
    ],
  };
  const [parsed] = parseStories({ stories: [toolInput(s)] }, PARSE).stories;
  assert.deepEqual(parsed.story.artifacts.map((a) => a.id), ['a1']);
  // An unknown topic key is no label.
  assert.equal(parseStories({ stories: [toolInput(story('X'), 'T9')] }, PARSE).stories[0].topicId, null);
});

// ── The cycle ───────────────────────────────────────────────────────────────

test('the nightly cycle is off unless auto_scout is on, and runs once a day', async () => {
  const db = await freshDb();
  const scout = stubScout([]);
  const { transport } = stubJev({});
  assert.deepEqual(await runStoryCycle({ db, scout, jevTransport: transport, fetcher, now: NOW }), { status: 'skipped', reason: 'auto_scout_off' });
  await saveRealCaseSetting(db, 'auto_scout', true);
  ok(await runStoryCycle({ db, scout, jevTransport: transport, fetcher, now: NOW }));
  assert.deepEqual(await runStoryCycle({ db, scout, jevTransport: transport, fetcher, now: NOW }), { status: 'skipped', reason: 'already_ran_today' });
  assert.equal(scout.asked.length, 1);
});

test('a full cycle: found, weak, none and failed searches; checks, gates, bar, pool; Explainer topics untouched', async () => {
  const db = await freshDb();
  await saveRealCaseSetting(db, 'auto_scout', true);
  await saveRealCaseSetting(db, 'searches_per_night', 4);
  await topic(db, 'Data quality', 90);
  await topic(db, 'Archived', 99, 'archived');
  const before = (await db.query('SELECT * FROM explainers.topics ORDER BY id')).rows;

  const unverified = story('Unverified', { claims: [{ ...CLAIMS[0], excerpt: 'words that are not on that page at all anywhere' }, ...CLAIMS.slice(1)] });
  const thin = story('Thin', { claims: [...CLAIMS.filter((c) => c.act !== 'since'), { ...CLAIMS[4], excerpt: 'these words are also nowhere on the page' }] });
  const scout = stubScout([
    [story('Strong'), unverified, thin, story('Private'), story('Middling')],
    [story('Low')],
    [],
    new Error('story scout: the turn ended (end_turn) without calling submit_stories'),
  ]);
  const { transport } = stubJev({ Strong: 3.6, Private: 3.9, Middling: 2.4, Low: 1.5 }, ['Private']);
  const result = ok(await runStoryCycle({ db, scout, jevTransport: transport, fetcher, now: NOW }));

  assert.equal(scout.asked.length, 4);
  // The scout sees today, the window, the non-archived topics as labels, and the events already found.
  assert.equal(scout.asked[0].today, '2026-10-26');
  assert.equal(scout.asked[0].windowDays, 90);
  assert.deepEqual(scout.asked[0].topics.map((t) => [t.key, t.title]), [['T1', 'Data quality']]);
  assert.deepEqual(scout.asked[0].known, []);
  assert.deepEqual(scout.asked[1].known.map((k) => k.title).sort(), ['Middling', 'Private', 'Strong', 'Thin', 'Unverified']);
  assert.deepEqual(result.searches.map((t) => t.outcome), ['found', 'weak', 'none', 'failed']);
  const found = result.searches[0].evaluations.map((e) => [e.title, e.evaluation.outcome]);
  assert.deepEqual(found, [['Strong', 'entered_pool'], ['Unverified', 'source_failed'], ['Thin', 'uncovered'], ['Private', 'gated'], ['Middling', 'below_bar']]);

  const pool = await listStories(db, ['pool']);
  assert.deepEqual(pool.map((s) => s.title), ['Strong']);
  // 3.6 of 4 on the six Jev questions (90 points) plus full freshness (10): 91.
  assert.equal(pool[0].weighted_score, 91);
  assert.equal(pool[0].event_date, '2026-10-20');
  assert.equal(pool[0].scores?.freshness, 4);
  assert.equal(pool[0].claims.every((c) => c.check?.status === 'verified'), true);
  const rejected = await listStories(db, ['rejected']);
  assert.match(rejected.find((s) => s.title === 'Private')!.reject_reason!, /private person/);
  assert.match(rejected.find((s) => s.title === 'Thin')!.reject_reason!, /^No verified fact for since\./);
  assert.match(rejected.find((s) => s.title === 'Middling')!.reject_reason!, /^Below the bar: /);

  const scouts = await listLatestScouts(db);
  assert.equal(scouts.every((s) => s.topic_title === 'News search' && s.topic_id === null), true);
  assert.equal(scouts.filter((s) => s.error === 'story scout: the turn ended (end_turn) without calling submit_stories').length, 1);
  // 3 paid searches at $0.20, the failed one's $0.05, and Jev calls: under the cap, all four ran.
  assert.equal(result.capped, false);
  assert.ok(result.usd > 0.65 && result.usd < 0.7, String(result.usd));

  assert.deepEqual((await db.query('SELECT * FROM explainers.topics ORDER BY id')).rows, before);
});

test('the nightly cap stops new searches; a cap of 0 searches none', async () => {
  const db = await freshDb();
  await saveRealCaseSetting(db, 'auto_scout', true);
  await saveRealCaseSetting(db, 'searches_per_night', 3);
  await saveRealCaseSetting(db, 'nightly_cap_usd', 0.5);
  const scout = stubScout([], 0.3);
  const { transport } = stubJev({});
  const r = ok(await runStoryCycle({ db, scout, jevTransport: transport, fetcher, now: NOW }));
  assert.equal(scout.asked.length, 2);
  assert.equal(r.capped, true);

  const db2 = await freshDb();
  await saveRealCaseSetting(db2, 'auto_scout', true);
  await saveRealCaseSetting(db2, 'nightly_cap_usd', 0);
  const scout2 = stubScout([]);
  ok(await runStoryCycle({ db: db2, scout: scout2, jevTransport: transport, fetcher, now: NOW }));
  assert.equal(scout2.asked.length, 0);
});

test('same event: the stronger telling wins the head-to-head; the weaker is displaced', async () => {
  const db = await freshDb();
  const { transport } = stubJev({ 'Outage #1': 3.2, 'Outage #2': 3.8 });
  const deps = { db, jevTransport: transport, fetcher, now: NOW };
  ok(await findNewsStories({ ...deps, scout: stubScout([[story('Outage #1')]]) }));
  const second = ok(await findNewsStories({ ...deps, scout: stubScout([[story('Outage #2', { term: 'failover' })]]) }));
  assert.equal(second.searches[0].evaluations[0].evaluation.outcome, 'won_head_to_head');
  assert.deepEqual((await listStories(db, ['pool'])).map((s) => s.title), ['Outage #2']);
  const displaced = await listStories(db, ['displaced']);
  assert.equal(displaced[0].title, 'Outage #1');
  assert.equal(displaced[0].duplicate_of, (await listStories(db, ['pool']))[0].id);
});

test('a click runs one search even with auto_scout off; its spend is in this route\'s own ledger', async () => {
  const db = await freshDb();
  const scout = stubScout([[story('Strong')]]);
  const { transport } = stubJev({ Strong: 3.6 });
  const r = ok(await findNewsStories({ db, scout, jevTransport: transport, fetcher, now: NOW }));
  assert.equal(r.searches[0].outcome, 'found');
  assert.equal(scout.asked.length, 1);
  const { rows } = await db.query<{ vendor: string; n: number }>('SELECT vendor, count(*)::int AS n FROM real_case.cost_events GROUP BY vendor ORDER BY vendor');
  assert.deepEqual(rows, [{ vendor: 'anthropic', n: 1 }, { vendor: 'jev', n: 2 }]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM explainers.cost_events')).rows[0].n, 0);
});

test('stories leave the pool when their event ages out of the window, and the first build\'s undated ones too', async () => {
  const db = await freshDb();
  const { transport } = stubJev({ Fresh: 3.6, Aging: 3.6 });
  ok(await findNewsStories({ db, scout: stubScout([[story('Fresh'), story('Aging', { story: { ...story('x').story, event_date: '2026-08-01' } })]]), jevTransport: transport, fetcher, now: NOW }));
  const pool = await listStories(db, ['pool']);
  // Same Jev scores; the fresher story ranks first on freshness.
  assert.deepEqual(pool.map((s) => s.title), ['Fresh', 'Aging']);
  assert.ok(pool[1].scores!.freshness < 4 && pool[1].scores!.freshness > 0);
  // An undated row from the first build, in the pool.
  const old = await addStory(db, { ...story('First build'), scoutId: null, cycleId: null });
  await db.query("UPDATE real_case.stories SET status = 'pool', event_date = NULL WHERE id = $1", [old.id]);

  const later = new Date('2026-11-05T07:00:00Z');
  const r = ok(await findNewsStories({ db, scout: stubScout([[]]), jevTransport: transport, fetcher, now: later }));
  assert.equal(r.expired.length, 2);
  assert.deepEqual((await listStories(db, ['pool'])).map((s) => s.title), ['Fresh']);
  assert.deepEqual((await listStories(db, ['archived'])).map((s) => s.reject_reason), ['Older than the news window.', 'Older than the news window.']);
});

test('labelTopics keys topics T1, T2, ... in order', () => {
  assert.deepEqual(labelTopics([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]), [
    { key: 'T1', id: 'a', title: 'A' },
    { key: 'T2', id: 'b', title: 'B' },
  ]);
});

test('factsOnlyMaterial: each act becomes its own verified claims; unverified claims and padding are gone', async () => {
  const { factsOnlyMaterial } = await import('@/lib/real-case/evaluate');
  const ok = { via: 'live', status: 'verified' } as never;
  const claim = (id: string, act: string, text: string, core = false, check: unknown = ok) => ({ id, act, text, core, check, source_id: 's1', excerpt: text }) as never;
  const story = {
    story: {
      event_date: '2026-10-21', place: null, cold_open: 'A padded hook.', setup: 'Widely used.', moment: 'm', fallout: 'f', reveal: 'r', since: 'Told users X.', for_you: 'Rotate keys.',
      cast: [{ name: 'Harbor City Transit', kind: 'organization', role: 'operator' }, { name: 'The planner', kind: 'product', role: 'the assistant' }], artifacts: [],
      timeline: [{ date: '2026-10-01', what: 'padded', claim_id: 'c2' }, { date: '2026-10-02', what: 'gone', claim_id: 'c9' }],
    } as never,
    claims: [claim('c1', 'setup', 'The planner launched.'), claim('c2', 'moment', 'It sent riders to a closed station.', true), claim('c3', 'fallout', 'It paused.'), claim('c4', 'reveal', 'Its list was old.'), claim('c5', 'since', 'It returned.'), claim('c6', 'since', 'Unverified.', false, { via: 'live', status: 'not_found' })],
  };
  const m = factsOnlyMaterial(story);
  assert.equal(m.cold_open, 'It sent riders to a closed station.');
  assert.equal(m.setup, 'The planner launched.');
  assert.equal(m.since, 'It returned.');
  assert.deepEqual(m.timeline, [{ date: '2026-10-01', what: 'It sent riders to a closed station.', claim_id: 'c2' }]);
  assert.equal(m.for_you, 'Rotate keys.');
  assert.deepEqual(m.cast.map((p) => p.name), ['The planner'], 'a player no claim names is dropped');
});
