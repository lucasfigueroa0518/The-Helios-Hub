/** Intake orders open only from their own type's settings and queue (Owner B). A fake query records every table read. */
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

test('each order opens only from its own settings', async () => {
  // AI Trivia is on by default and its order opens with it (SS-30): it costs nothing (deposit-only, no scorecard).
  const T = ['trivia'];
  assert.deepEqual(await ids({}), T);
  assert.deepEqual(await ids({ lfdAuto: true }), ['lfd', ...T]);
  assert.deepEqual(await ids({ lfdRun: true }), ['lfd', ...T]);
  assert.deepEqual(await ids({ lfdSeed: true }), ['lfd', ...T]);
  assert.deepEqual(await ids({ series: { morning_download: { auto: true } } }), ['md', ...T]);
  assert.deepEqual(await ids({ series: { morning_download: { auto: true, enabled: false } } }), T);
  // Guess the Number's order is gone with the series (AT-14); Free vs. Paid's too (SS-31): neither opens anything.
  assert.deepEqual(await ids({ series: { guess_the_number: { auto: true }, ai_trivia: { enabled: false } } }), []);
  assert.deepEqual(await ids({ series: { free_vs_paid: { auto: true }, ai_trivia: { enabled: false } } }), []);
  // Real or AI? has no order: its scrapes are photo requests (SS-30).
  assert.deepEqual(await ids({ series: { real_or_ai: { auto: true }, ai_trivia: { enabled: false } } }), []);
  assert.deepEqual(await ids({ pendingSet: 'real_or_ai' }), T);
  assert.deepEqual(await ids({ pendingSet: 'morning_download', lfdAuto: true }), ['lfd', 'md', ...T]);
});

test('the trivia order opens and closes with the ai_trivia series (SS-30)', async () => {
  assert.deepEqual(await ids({ series: { ai_trivia: { enabled: true, auto: true } } }), ['trivia']);
  assert.deepEqual(await ids({ series: { ai_trivia: { enabled: false, auto: true } } }), [], 'disabled: closed');
  assert.deepEqual(await ids({ series: { ai_trivia: { enabled: true, auto: false } } }), ['trivia'], 'auto off: still open, its daily writer runs on enabled alone');
  assert.deepEqual(await ids({ series: { ai_trivia: { enabled: false } }, pendingSet: 'ai_trivia' }), ['trivia'], 'a set waiting to build opens it even when off');
  assert.deepEqual(await ids({ series: { ai_trivia: { auto: true }, morning_download: { auto: true } } }), ['md', 'trivia']);
  // Its own settings only: another type being on never opens it.
  assert.deepEqual(await ids({ lfdAuto: true, series: { morning_download: { auto: true }, ai_trivia: { enabled: false } } }), ['lfd', 'md']);
});

test('isOpen reads only its own type’s tables', async () => {
  const lfd = fake({});
  await LFD_ORDER.isOpen(lfd.q, NOW);
  assert.ok(lfd.reads.every((r) => r.startsWith('lfd.')), lfd.reads.join(','));
  for (const o of [MD_ORDER, TRIVIA_ORDER]) {
    const f = fake({});
    await o.isOpen(f.q, NOW);
    assert.ok(f.reads.every((r) => r.startsWith('stories.')), `${o.id}: ${f.reads.join(',')}`);
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
