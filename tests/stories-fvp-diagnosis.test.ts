/**
 * Free vs. Paid: a skipped build records why (payload.fvpSkip), and the
 * recorded bar arithmetic matches the three scored attempts of Oct 8-10.
 * Offline: stubbed Sonnet and Jev, PGlite. No live call of any kind.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { BuildDeps } from '@/lib/stories/build/common';
import { buildSet } from '@/lib/stories/build';
import { buildFreeVsPaid, FVP_BAR, pairKey } from '@/lib/stories/build/free-vs-paid';
import { createStoriesJev } from '@/lib/stories/jev';
import { claimNextRequested, getSet, recordHistory, requestSet } from '@/lib/stories/repository';
import { DEFAULT_SETTINGS } from '@/lib/stories/settings';
import type { ToolLead } from '@/lib/stories/sources/reels';

import { harnessDb, stubJev, stubPhotos, stubRenderer, stubWriter } from './stories-harness';

const NOW = new Date('2026-10-13T08:00:00Z');
const DATE = '2026-10-13';
const LEADS: ToolLead[] = [
  { origin: 'catalog', ref: '1', name: 'SHAP', url: 'https://shap.test', description: 'explain models' },
  { origin: 'github', ref: '2', name: 'pytorch', url: 'https://pytorch.test', description: 'tensors' },
  { origin: 'github', ref: '3', name: 'litellm', url: 'https://litellm.test', description: 'gateway' },
];
const pair = (paid: string, free: string) => ({ paid_tool: paid, paid_price: '$10', price_period: 'a month', paid_price_url: 'https://p.test', free_tool: free, free_url: 'https://f.test', what_it_does: 'Does it.', how_to_get: 'Free download', platforms: 'Mac', dev_tool: false });

// The three pairs that reached scoring on Oct 10, with the answers Jev gave (stories.jev_logs).
const HISTORY: Record<string, Record<string, number>> = {
  MindMeister: { accessible: 0.12, paid_known: 0.53, does_the_job: 0.71, viewer_value: 0.49 },
  'Dropbox Plus': { accessible: 0.07, paid_known: 0.85, does_the_job: 0.37, viewer_value: 0.4 },
  SurveyMonkey: { accessible: 0.11, paid_known: 0.79, does_the_job: 0.88, viewer_value: 0.45 },
};
const mean = (a: Record<string, number>) => Object.values(a).reduce((s, v) => s + v, 0) / 4;

async function setup() {
  const { db } = await harnessDb();
  const { set } = await requestSet(db, { series: 'free_vs_paid', nyDate: DATE, trigger: 'auto', style: 'homemade' });
  await claimNextRequested(db);
  return { db, set };
}
const depsFor = (db: Awaited<ReturnType<typeof harnessDb>>['db'], setId: string, write: ReturnType<typeof stubWriter>, jev = stubJev()): BuildDeps =>
  ({ db, sourceDb: db, jev: createStoriesJev(jev, db), write, photos: stubPhotos(), settings: DEFAULT_SETTINGS, now: NOW, setId, nyDate: DATE });
const recordOf = async (db: Awaited<ReturnType<typeof harnessDb>>['db'], id: string) => (await getSet(db, id))!.set.payload.fvpSkip as Record<string, any> | undefined;

test('the historical scores reproduce 0.46 / 0.42 / 0.56 and all sit under the 0.6 bar', () => {
  assert.equal(FVP_BAR, 0.6);
  assert.deepEqual(Object.values(HISTORY).map((a) => +mean(a).toFixed(2)), [0.46, 0.42, 0.56]);
  assert.ok(Object.values(HISTORY).every((a) => mean(a) < FVP_BAR));
});

test('skip, model proposed nothing: the record names that gate and what was offered', async () => {
  const { db, set } = await setup();
  const write = stubWriter({ submit_pairs: () => ({ pairs: [] }) });
  const r = await buildFreeVsPaid(depsFor(db, set.id, write), async () => LEADS);
  assert.equal(r.ok, false);
  const rec = await recordOf(db, set.id);
  assert.equal(rec?.gate, 'model-proposed-none');
  assert.equal(rec?.leadsOffered, 3);
  assert.deepEqual(rec?.leadsByOrigin, { catalog: 1, github: 2 });
  assert.deepEqual(rec?.proposed, []);
});

test('skip, every proposal already shown in 90 days: dropped pairs are named', async () => {
  const { db, set } = await setup();
  const p = pair('Adobe Photoshop', 'GIMP');
  await recordHistory(db, 'free_vs_paid', [pairKey(p)], null);
  const r = await buildFreeVsPaid(depsFor(db, set.id, stubWriter({ submit_pairs: () => ({ pairs: [p] }) })), async () => LEADS);
  assert.equal(r.ok, false);
  const rec = await recordOf(db, set.id);
  assert.equal(rec?.gate, 'all-proposals-already-shown');
  assert.deepEqual(rec?.droppedAsShown, [pairKey(p)]);
  assert.equal(rec?.alreadyShownKeys, 1);
});

test('skip, scored under the bar: each candidate keeps its answers, score and failing gate (the Oct 10 numbers)', async () => {
  const { db, set } = await setup();
  const pairs = [pair('MindMeister', 'TeamMapper'), pair('Dropbox Plus', 'Shifter'), pair('SurveyMonkey', 'LimeSurvey')];
  const jev = stubJev((key, state) => HISTORY[String((state as Record<string, unknown>).paid_tool)]![key]!);
  const r = await buildFreeVsPaid(depsFor(db, set.id, stubWriter({ submit_pairs: () => ({ pairs }) }), jev), async () => LEADS);
  assert.equal(r.ok, false);
  const rec = await recordOf(db, set.id);
  assert.equal(rec?.gate, 'no-pair-cleared');
  assert.equal(rec?.bar, 0.6);
  assert.equal(rec?.considered.length, 3);
  assert.ok(rec?.considered.every((c: any) => c.failedGate === 'below the bar'));
  const best = rec?.considered[0];
  assert.equal(best.pair, 'surveymonkey|limesurvey');
  assert.equal(+best.score.toFixed(2), 0.56);
  assert.equal(best.answers.accessible, 0.11);
});

test('the record survives buildSet\'s own skip bookkeeping and a good build leaves none', async () => {
  const { db, set } = await setup();
  const base = { db, sourceDb: db, jevTransport: stubJev(), write: stubWriter({ submit_pairs: () => ({ pairs: [] }) }), photos: stubPhotos(), renderer: await stubRenderer(), review: (async () => ({ flags: [] })) as never, storage: { upload: async () => {}, sign: async (p: string) => p, download: async () => Buffer.alloc(0), remove: async () => {} }, now: () => NOW };
  const out = await buildSet({ ...base, builders: { free_vs_paid: (d) => buildFreeVsPaid(d, async () => LEADS) } }, set.id);
  assert.equal(out.status, 'skipped');
  const got = await getSet(db, set.id);
  assert.equal(got!.set.status, 'skipped');
  assert.equal(got!.set.payload.candidates, 0);
  assert.equal((got!.set.payload.fvpSkip as { gate: string }).gate, 'model-proposed-none');

  const { db: db2, set: s2 } = await setup();
  const write = stubWriter({
    submit_pairs: () => ({ pairs: [pair('Otter', 'Whisper app')] }),
    submit_check: () => ({ price_confirmed: true, price_seen: '$10', free_confirmed: true, note: '' }),
    submit_tease: () => ({ tease: 'There is a free one.' }),
  });
  const ok = await buildFreeVsPaid(depsFor(db2, s2.id, write), async () => LEADS);
  assert.equal(ok.ok, true);
  assert.equal(await recordOf(db2, s2.id), undefined);
});

test('a failed recording write never turns a skip into a failure', async () => {
  const { db, set } = await setup();
  const flaky = { ...db, query: (async (sql: string, ...rest: unknown[]) => {
    if (/UPDATE stories\.sets SET payload/.test(sql)) throw new Error('write refused');
    return (db.query as (...a: unknown[]) => unknown)(sql, ...rest);
  }) } as typeof db;
  const r = await buildFreeVsPaid(depsFor(flaky, set.id, stubWriter({ submit_pairs: () => ({ pairs: [] }) })), async () => LEADS);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.skip, 'no pair cleared the bar and its checks');
});

test('which gate binds: lifting "accessible" alone, or the bar alone, on the three historical scores', () => {
  const pass = (bar: number, lift: number | null) => Object.entries(HISTORY).filter(([, a]) => mean(lift === null ? a : { ...a, accessible: Math.max(a.accessible!, lift) }) >= bar).map(([k]) => k);
  assert.deepEqual(pass(0.6, null), []);
  assert.deepEqual(pass(0.55, null), ['SurveyMonkey']);
  assert.deepEqual(pass(0.5, null), ['SurveyMonkey']);
  assert.deepEqual(pass(0.6, 0.5), ['SurveyMonkey']); // accessible fixed only: still one of three
  assert.deepEqual(pass(0.5, 0.5), ['MindMeister', 'Dropbox Plus', 'SurveyMonkey']);
});

test('no hints is no reason to skip: the pairing call still runs and its pair is built', async () => {
  const { db, set } = await setup();
  const write = stubWriter({
    submit_pairs: () => ({ pairs: [pair('Adobe Photoshop', 'GIMP')] }),
    submit_check: () => ({ price_confirmed: true, price_seen: '$10', free_confirmed: true, note: '' }),
    submit_tease: () => ({ tease: 'There is a free one.' }),
  });
  const r = await buildFreeVsPaid(depsFor(db, set.id, write), async () => []);
  assert.equal(r.ok, true);
  assert.equal((write.calls[0]!.tools as Array<{ name: string }>).at(-1)!.name, 'submit_pairs');
  const user = (write.calls[0]!.messages as Array<{ content: string }>)[0]!.content;
  assert.match(user, /"leads": \[\]/);
});
