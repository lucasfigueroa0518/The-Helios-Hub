/** Intake orders: every order of a type that is not retired is open on every run (settings standard D16). A fake query records every table read. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { INTAKE_ORDERS, LFD_ORDER, MD_ORDER, openOrders, TRIVIA_ORDER } from '@/lib/intake/orders';
import type { IntakeQuery } from '@/lib/intake/types';

type World = {
  lfdAuto?: boolean;
  lfdRun?: boolean;
  lfdSeed?: boolean;
  series?: Partial<Record<'morning_download' | 'ai_trivia' | 'real_or_ai' | 'guess_the_number' | 'free_vs_paid', { enabled?: boolean; auto?: boolean }>>;
  pendingSet?: string;
};

const NOW = new Date('2026-11-09T05:00:00Z');

function fake(w: World): { q: IntakeQuery; reads: string[] } {
  const reads: string[] = [];
  const q: IntakeQuery = {
    async query<T>(text: string, params?: unknown[]) {
      const t = text.replace(/\s+/g, ' ');
      reads.push((t.match(/FROM (\w+\.\w+)/) ?? [])[1] ?? t);
      let rows: unknown[] = [];
      if (t.includes("lfd.settings WHERE key = 'auto_run'")) rows = [{ key: 'auto_run', value: w.lfdAuto === true }];
      else if (t.includes('lfd.runs')) rows = w.lfdRun ? [{ '?column?': 1 }] : [];
      else if (t.includes("lfd.settings WHERE key LIKE 'seed:%'"))
        rows = w.lfdSeed ? [{ key: 'seed:example.com/a', value: { status: 'open', url: 'https://example.com/a', addedAt: '2026-11-08T00:00:00Z', expiresAt: '2026-11-12T00:00:00Z' } }] : [];
      else if (t.includes('stories.settings')) rows = w.series ? [{ key: 'series', value: w.series }] : [];
      else if (t.includes('stories.sets')) rows = w.pendingSet && params?.[0] === w.pendingSet ? [{ '?column?': 1 }] : [];
      else throw new Error(`unexpected query: ${t}`);
      return { rows: rows as T[] };
    },
  };
  return { q, reads };
}

const ids = async (w: World) => (await openOrders(fake(w).q, NOW)).map((o) => o.id);

const ALL = ['lfd', 'md', 'reels', 'carousel', 'field-notes', 'trivia'];

// Settings standard (D16, CONTRACT.md §4): the intake is the refill and refill runs in every state, so every order of a
// type that is not retired is open on every run. The old expectations (an order opens only from its type's Generate
// switch, queue or seeds) contradict the contract and were replaced.
test('every order is open in every state: Generate off, on, a queue or none (D16)', async () => {
  assert.deepEqual(await ids({}), ALL, 'nothing switched on: every order still refills');
  assert.deepEqual(await ids({ lfdAuto: true }), ALL);
  assert.deepEqual(await ids({ lfdRun: true, lfdSeed: true }), ALL);
  assert.deepEqual(await ids({ series: { morning_download: { auto: false, enabled: false }, ai_trivia: { enabled: false } } }), ALL);
  assert.deepEqual(await ids({ series: { morning_download: { auto: true }, ai_trivia: { enabled: true, auto: true } }, pendingSet: 'morning_download' }), ALL);
});

test('retired series have no order, so they never refill (SS-31, AT-14); Real or AI? has none either (SS-30)', async () => {
  const open = await ids({ series: { guess_the_number: { auto: true, enabled: true }, free_vs_paid: { auto: true, enabled: true }, real_or_ai: { auto: true } } });
  for (const gone of ['fvp', 'gtn', 'guess_the_number', 'free_vs_paid', 'real_or_ai']) assert.ok(!(open as string[]).includes(gone), gone);
});

test('isOpen reads nothing: no order depends on its type’s settings any more', async () => {
  for (const o of [LFD_ORDER, MD_ORDER, TRIVIA_ORDER, ...INTAKE_ORDERS]) {
    const f = fake({});
    assert.equal(await o.isOpen(f.q, NOW), true, o.id);
    assert.deepEqual(f.reads, [], o.id);
  }
});

test('order definitions', () => {
  assert.deepEqual(INTAKE_ORDERS.map((o) => [o.id, o.sources, o.lookbackDays, o.scorecards]), [
    ['lfd', ['reels:*', 'feeds:*'], 10, ['reels-score', 'story-scoring', 'major-news', 'story-builder']],
    ['md', ['reels:*', 'feeds:*'], 4, ['reels-score', 'story-scoring', 'major-news', 'story-builder']],
    ['reels', ['reels:*'], 14, ['reels-screen', 'reels-score']],
    ['carousel', ['feeds:*', 'reels:*'], 2, ['story-scoring']],
    ['field-notes', ['field-notes:*'], 45, ['field-notes-score']],
    // SS-30: AI Trivia's cited pages, a no-score pass-through (no existing scorecard judges a fact page).
    ['trivia', ['search:trivia'], 30, []],
  ]);
});
