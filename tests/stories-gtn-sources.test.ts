/**
 * Guess the Number, Bald-Eagle 2026-11-12 (D7, D10): the 0.45 want-to-guess floor, the source fallback through
 * an intake story's member links (publisher first, wrappers last, paywalled skipped), the 'bad-link' rule and the
 * second pick round. Offline: PGlite, stubbed Jev, writer, reader and member links. No live call of any kind.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGuessTheNumber, GATE_FLOORS, type GtnRecord } from '@/lib/stories/build/guess-the-number';
import { badLink, isAggregatorLink, outletFromHost, sourceOrder, type MemberLink } from '@/lib/stories/gtn-sources';
import { createStoriesJev } from '@/lib/stories/jev';
import type { GtnPickCandidate, GtnPickMaterial } from '@/lib/stories/prompts';
import { claimNextRequested, requestSet } from '@/lib/stories/repository';
import { DEFAULT_SETTINGS } from '@/lib/stories/settings';
import { readFirstWithFigure, type SourcePage } from '@/lib/stories/source-page';
import type { StoryCandidate } from '@/lib/stories/sources/reels';

import { harnessDb, stubJev, stubPhotos, stubWriter } from './stories-harness';

const NOW = new Date('2026-10-08T05:00:00Z');
const DATE = '2026-10-08';
type Db = Awaited<ReturnType<typeof harnessDb>>['db'];

const GNEWS = 'https://news.google.com/rss/articles/CBMiWRAPPERLINK?oc=5';
const pick = (rank: number, o: Partial<GtnPickCandidate> = {}): GtnPickCandidate => ({
  rank, origin: 'model', pool_id: '', question: `Question number ${rank}?`, answer: `${rank}0M`, label: `Label ${rank}`, meaning: 'It means something.', topic: `Topic ${rank}`,
  source_url: `https://docs.test/c${rank}`, source_quote: `The figure is ${rank}0M.`, source_verb: 'from', source_name: 'Docs', subjects: [], visual: { kind: 'thematic', query: `visual ${rank}` }, answer_visual: { kind: 'thematic', query: `answer visual ${rank}` }, ...o,
});
const page = (answer: string) => `A page that states the figure plainly. The figure is ${answer} for this. ${'More text. '.repeat(30)}`;
const PAYWALL = (answer: string) => `Subscribe to continue reading. The figure is ${answer}. ${'Teaser. '.repeat(30)}`;
const PASS = (k: string) => (k === 'newly_changed' || k === 'same_subject' ? 0.1 : 0.8);
const qOf = (s: unknown) => (s as { question?: string }).question;

function stubReader(pages: Record<string, string>) {
  const calls: string[] = [];
  const read = async (url: string): Promise<SourcePage> => {
    calls.push(url);
    const p = pages[url];
    return p === undefined ? { ok: false, url, error: 'fetch failed' } : { ok: true, url, text: p, publishedTime: null, via: 'article' };
  };
  return Object.assign(read, { calls });
}

/** A pool story from the intake: its own link is a wrapper; the intake story has more member links. */
const POOL_STORY: StoryCandidate = {
  key: 'pool.test/story', origin: 'reels', ref: 'idea-1', headline: 'A story with a number', sourceName: 'Wire', url: GNEWS, body: 'Story text.', publishedAt: null, nativeScore: 5,
  intake: { storyId: '00000000-0000-4000-8000-000000000001', major: null, builder: null, eventDate: null },
};

async function setup(db: Db, rounds: GtnPickCandidate[][], o: { jev?: ReturnType<typeof stubJev>; pages?: Record<string, string> } = {}) {
  const { set } = await requestSet(db, { series: 'guess_the_number', nyDate: DATE, trigger: 'click', style: DEFAULT_SETTINGS.series.guess_the_number.style });
  await claimNextRequested(db);
  const write = stubWriter({ submit_candidates: (_p, n) => ({ candidates: rounds[Math.min(n, rounds.length) - 1] }) });
  const reader = stubReader(o.pages ?? Object.fromEntries(rounds.flat().map((c) => [c.source_url, page(c.answer)])));
  const jev = o.jev ?? stubJev(PASS);
  const deps = { db, sourceDb: db, jev: createStoriesJev(jev, db), write, photos: stubPhotos(), settings: DEFAULT_SETTINGS, now: NOW, setId: set.id, nyDate: DATE, readSource: reader };
  return { deps, write, reader, jev };
}

const materialOf = (params: Record<string, unknown>) =>
  JSON.parse(/<material>\n([\s\S]*)\n<\/material>/.exec(String((params.messages as Array<{ content: string }>)[0]!.content))![1]!) as GtnPickMaterial;

test('GTN floors: want_to_guess is 0.45 (Bald-Eagle D10); 0.46 passes, 0.44 fails', async () => {
  assert.equal(GATE_FLOORS.want_to_guess, 0.45);
  const { db } = await harnessDb();
  const [a, b, c] = [pick(1), pick(2), pick(3)];
  const jev = stubJev((k, s) => (k === 'want_to_guess' ? (qOf(s) === a.question ? 0.44 : 0.46) : PASS(k)));
  const { deps, write } = await setup(db, [[a, b, c]], { jev });
  const r = await buildGuessTheNumber(deps, { numbers: async () => [], unbriefed: async () => [] });
  assert.equal(r.ok, true, !r.ok ? r.skip : '');
  assert.deepEqual(r.candidates.map((x) => x.reason), ['want_to_guess', null, 'lower rank']);
  assert.equal(write.calls.length, 1, 'round 1 has a winner: no second try');
  const rec = (r.ok ? r.payload.gtn : null) as GtnRecord;
  assert.equal(rec.rounds.length, 1);
  assert.equal(rec.considered.length, 3);
});

test('GTN source fallback: unreadable own link → next member link; publishers before wrappers; the page used is recorded', async () => {
  const { db } = await harnessDb();
  const pooled = pick(1, { origin: 'pool', pool_id: 'p1', source_url: 'https://first.test/a', answer: '42M' });
  const members: MemberLink[] = [
    { url: 'https://news.google.com/rss/articles/OTHERWRAPPER', outlet: 'Wire' },
    { url: 'https://second.test/b', outlet: 'Second' },
    { url: 'https://third.test/c', outlet: 'Third' },
  ];
  const pages = { 'https://third.test/c': page('42M'), [pick(2).source_url]: page(pick(2).answer), [pick(3).source_url]: page(pick(3).answer) };
  const { deps, reader } = await setup(db, [[pooled, pick(2), pick(3)]], { pages });
  const asked: string[] = [];
  const r = await buildGuessTheNumber(deps, { numbers: async () => [], unbriefed: async () => [POOL_STORY], memberLinks: async (id) => (asked.push(id), members) });
  assert.equal(r.ok, true, !r.ok ? r.skip : '');
  if (!r.ok) return;
  assert.deepEqual(asked, [POOL_STORY.intake!.storyId]);
  // Own link, then publisher member links; the pool's wrapper links come last and are never reached here.
  assert.deepEqual(reader.calls.slice(0, 3), ['https://first.test/a', 'https://second.test/b', 'https://third.test/c']);
  const chosen = r.candidates.find((c) => c.chosen)!;
  assert.equal(chosen.origin, 'reels');
  assert.equal((chosen.payload as { read_url: string }).read_url, 'https://third.test/c');
  const rec = r.payload.gtn as GtnRecord;
  assert.equal(rec.considered[0]!.readUrl, 'https://third.test/c');
  assert.deepEqual(rec.considered[0]!.tried!.map((t) => t.result), ['fetch failed', 'fetch failed', 'read']);
  assert.equal(r.payload.readUrl, 'https://third.test/c');
  // The answer frame credits the publisher of the page actually read, not the cited one.
  assert.deepEqual((r.frames[2]!.copy as { source: unknown }).source, { verb: 'reported by', name: 'Third' });
});

test('GTN credit: a page read under the cited link keeps the model credit; outlet names from hosts', async () => {
  assert.equal(outletFromHost('https://www.example-news.com/a'), 'Example News');
  assert.equal(outletFromHost('https://news.example.co.uk/a'), 'Example');
  const { db } = await harnessDb();
  const { deps } = await setup(db, [[pick(1, { source_name: 'Docs Site' }), pick(2), pick(3)]]);
  const r = await buildGuessTheNumber(deps, { numbers: async () => [], unbriefed: async () => [] });
  assert.equal(r.ok, true, !r.ok ? r.skip : '');
  if (!r.ok) return;
  assert.deepEqual((r.frames[2]!.copy as { source: unknown }).source, { verb: 'from', name: 'Docs Site' });
});

test('GTN run day (Bald-Eagle S6): with a later posting date, the pick and the gate judge "today" as the run day', async () => {
  const { db } = await harnessDb();
  const { deps, write, jev } = await setup(db, [[pick(1), pick(2), pick(3)]]);
  const r = await buildGuessTheNumber({ ...deps, nyDate: '2026-10-10' }, { numbers: async () => [], unbriefed: async () => [] });
  assert.equal(r.ok, true, !r.ok ? r.skip : '');
  assert.equal(materialOf(write.calls[0]!).today, DATE);
  const gates = jev.calls.filter((c) => c.keys.includes('verifiable'));
  assert.ok(gates.length > 0 && gates.every((c) => (c.state as { today: string }).today === DATE));
});

test('GTN source fallback: wrappers are tried last, after every publisher link failed', async () => {
  assert.deepEqual(sourceOrder('https://own.test/x', [GNEWS, 'https://pub.test/a', 'https://own.test/x?utm_source=feed', 'https://pub.test/b']), ['https://own.test/x', 'https://pub.test/a', 'https://pub.test/b', GNEWS]);
  const read = stubReader({ [GNEWS]: page('7M') });
  const got = await readFirstWithFigure(sourceOrder('https://own.test/x', [GNEWS, 'https://pub.test/a']), '7M', read);
  assert.equal(got.page.ok, true);
  assert.deepEqual(read.calls, ['https://own.test/x', 'https://pub.test/a', GNEWS]);
});

test('GTN source fallback: a paywalled page is skipped even when it has the figure', async () => {
  const { db } = await harnessDb();
  const pooled = pick(1, { origin: 'pool', pool_id: 'p1', source_url: 'https://paywalled.test/a', answer: '42M' });
  const pages = { 'https://paywalled.test/a': PAYWALL('42M'), 'https://open.test/b': page('42M'), [pick(2).source_url]: page(pick(2).answer), [pick(3).source_url]: page(pick(3).answer) };
  const { deps } = await setup(db, [[pooled, pick(2), pick(3)]], { pages });
  const r = await buildGuessTheNumber(deps, { numbers: async () => [], unbriefed: async () => [POOL_STORY], memberLinks: async () => [{ url: 'https://open.test/b', outlet: 'Open' }] });
  assert.equal(r.ok, true, !r.ok ? r.skip : '');
  if (!r.ok) return;
  const rec = r.payload.gtn as GtnRecord;
  assert.deepEqual(rec.considered[0]!.tried, [{ url: 'https://paywalled.test/a', result: 'paywalled' }, { url: 'https://open.test/b', result: 'read' }]);
  assert.equal(r.candidates[0]!.chosen, true);
});

test('GTN source fallback: no page has the figure → the first readable page is still gated; all paywalled → unreadable', async () => {
  const read = stubReader({ 'https://a.test/1': page('nothing here'), 'https://b.test/2': page('no number') });
  const got = await readFirstWithFigure(['https://a.test/1', 'https://b.test/2'], '99M', read);
  assert.equal(got.page.ok && got.page.url, 'https://a.test/1');
  assert.deepEqual(got.tried.map((t) => t.result), ['read (no page had the figure)', 'no figure']);
  const walled = await readFirstWithFigure(['https://a.test/1'], '5M', stubReader({ 'https://a.test/1': PAYWALL('5M') }));
  assert.deepEqual([walled.page.ok, !walled.page.ok && walled.page.error], [false, 'paywalled']);
});

test("GTN 'bad-link': a model idea citing a wrapper link or a higher rank's link fails unread; a pool item may carry a wrapper", async () => {
  assert.equal(isAggregatorLink(GNEWS), true);
  assert.equal(isAggregatorLink('https://news.example.test/a'), false);
  assert.equal(badLink('https://docs.test/a?utm_source=x', ['https://docs.test/a']), 'link already cited by a higher-ranked candidate');
  const { db } = await harnessDb();
  const pooled = pick(1, { origin: 'pool', pool_id: 'p1', source_url: GNEWS, answer: '42M' });
  const fine = pick(2);
  const wrapper = pick(3, { source_url: 'https://news.google.com/rss/articles/MODELWRAPPER' });
  const shared = pick(4, { source_url: `${fine.source_url}?utm_source=x` });
  const pages = { [GNEWS]: page('42M'), [fine.source_url]: page(fine.answer) };
  const { deps, reader } = await setup(db, [[pooled, fine, wrapper, shared]], { pages });
  const r = await buildGuessTheNumber(deps, { numbers: async () => [], unbriefed: async () => [POOL_STORY], memberLinks: async () => [] });
  assert.equal(r.ok, true, !r.ok ? r.skip : '');
  if (!r.ok) return;
  assert.deepEqual(r.candidates.map((c) => [c.origin, c.reason]), [['reels', null], ['model', 'lower rank'], ['model', 'bad-link'], ['model', 'bad-link']]);
  assert.deepEqual(reader.calls, [GNEWS, fine.source_url], 'bad links are never fetched');
  const rec = r.payload.gtn as GtnRecord;
  assert.deepEqual(rec.considered.slice(2, 4).map((c) => c.error), ['news aggregator link', 'link already cited by a higher-ranked candidate']);
});

test('GTN second try: fires only when round 1 has no winner, told each failure and the links tried; round 2 can win', async () => {
  const { db } = await harnessDb();
  const r1 = [pick(1), pick(2), pick(3)];
  const r2 = [pick(1, { question: 'Second round one?', source_url: 'https://docs.test/r2a', answer: '11M' }), pick(2, { question: 'Second round two?', source_url: 'https://docs.test/r2b', answer: '12M' }), pick(3, { question: 'Second round three?', source_url: 'https://docs.test/r2c', answer: '13M' })];
  const pages = Object.fromEntries([...r1.slice(1), ...r2].map((c) => [c.source_url, page(c.answer)]));
  const firstRound = new Set(r1.map((c) => c.question));
  const jev = stubJev((k, s) => (k === 'want_to_guess' && firstRound.has(qOf(s) ?? '') ? 0.3 : PASS(k)));
  const { deps, write } = await setup(db, [r1, r2], { jev, pages });
  const r = await buildGuessTheNumber(deps, { numbers: async () => [], unbriefed: async () => [] });
  assert.equal(r.ok, true, !r.ok ? r.skip : '');
  if (!r.ok) return;
  assert.equal(write.calls.length, 2);
  assert.equal(materialOf(write.calls[0]!).retry, undefined);
  const retry = materialOf(write.calls[1]!).retry!;
  assert.deepEqual(retry.failures.map((f) => [f.question, f.failed_gate]), [[r1[0]!.question, 'unreadable'], [r1[1]!.question, 'want_to_guess'], [r1[2]!.question, 'want_to_guess']]);
  assert.match(retry.failures[1]!.reason, /want_to_guess 0\.30 vs floor 0\.45/);
  assert.deepEqual(retry.links_tried, r1.map((c) => c.source_url));
  assert.equal(r.candidates.length, 6);
  assert.deepEqual(r.candidates.map((c) => [(c.payload as { round: number }).round, c.chosen, c.reason]), [
    [1, false, 'unreadable'], [1, false, 'want_to_guess'], [1, false, 'want_to_guess'], [2, true, null], [2, false, 'lower rank'], [2, false, 'lower rank'],
  ]);
  assert.equal((r.frames[1]!.copy as { question: string }).question, 'Second round one?');
  const rec = r.payload.gtn as GtnRecord;
  assert.deepEqual(rec.rounds.map((x) => [x.round, x.considered.length]), [[1, 3], [2, 3]]);
  assert.deepEqual(rec.considered.map((c) => c.round), [1, 1, 1, 2, 2, 2]);
  assert.equal(r.payload.round, 2);
});
