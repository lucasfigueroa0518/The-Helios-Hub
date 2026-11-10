/** Intake orders open only from their own type's settings and queue (Owner B). A fake query records every table read. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { FVP_ORDER, INTAKE_ORDERS, LFD_ORDER, MD_ORDER, openOrders } from '@/lib/intake/orders';
import type { IntakeQuery } from '@/lib/intake/types';

type World = {
  lfdAuto?: boolean;
  lfdRun?: boolean;
  lfdSeed?: boolean;
  series?: Partial<Record<'morning_download' | 'guess_the_number' | 'free_vs_paid', { enabled?: boolean; auto?: boolean }>>;
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
  assert.deepEqual(await ids({}), []);
  assert.deepEqual(await ids({ lfdAuto: true }), ['lfd']);
  assert.deepEqual(await ids({ lfdRun: true }), ['lfd']);
  assert.deepEqual(await ids({ lfdSeed: true }), ['lfd']);
  assert.deepEqual(await ids({ series: { morning_download: { auto: true } } }), ['md']);
  assert.deepEqual(await ids({ series: { morning_download: { auto: true, enabled: false } } }), []);
  // Guess the Number's order is gone with the series (AT-14); AI Trivia opens no order.
  assert.deepEqual(await ids({ series: { guess_the_number: { auto: true } } }), []);
  assert.deepEqual(await ids({ series: { free_vs_paid: { auto: true } } }), ['fvp']);
  assert.deepEqual(await ids({ pendingSet: 'ai_trivia' }), []);
  assert.deepEqual(await ids({ pendingSet: 'morning_download', lfdAuto: true }), ['lfd', 'md']);
});

test('isOpen reads only its own type’s tables', async () => {
  const lfd = fake({});
  await LFD_ORDER.isOpen(lfd.q, NOW);
  assert.ok(lfd.reads.every((r) => r.startsWith('lfd.')), lfd.reads.join(','));
  for (const o of [MD_ORDER, FVP_ORDER]) {
    const f = fake({});
    await o.isOpen(f.q, NOW);
    assert.ok(f.reads.every((r) => r.startsWith('stories.')), `${o.id}: ${f.reads.join(',')}`);
  }
});

test('order definitions', () => {
  assert.deepEqual(INTAKE_ORDERS.map((o) => [o.id, o.sources, o.lookbackDays, o.scorecards]), [
    ['lfd', ['reels:*', 'feeds:*'], 10, ['reels-score', 'story-scoring', 'major-news', 'story-builder']],
    ['md', ['reels:*', 'feeds:*'], 4, ['reels-score', 'story-scoring', 'major-news', 'story-builder']],
    ['fvp', ['reels:*'], 14, ['reels-score']],
    ['reels', ['reels:*'], 14, ['reels-screen', 'reels-score']],
    ['carousel', ['feeds:*', 'reels:*'], 2, ['story-scoring']],
    ['field-notes', ['field-notes:*'], 45, ['field-notes-score']],
  ]);
});
