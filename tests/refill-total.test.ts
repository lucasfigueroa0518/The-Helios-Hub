/** The nightly total of all idea-pool refills (settings standard D19). Offline: an in-memory ledger. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  allowance,
  beginRefill,
  peekRefill,
  recordRefill,
  refillNight,
  settleRefill,
  spentTonightUsd,
  writeRefillTotalUsd,
  type TotalQuery,
} from '@/lib/content-type/refill-total';
import { REFILL_CAP_DEFAULT_USD, REFILL_TOTAL_DEFAULT_USD, refillTotalUsd } from '@/lib/content-type/state';

type Row = { id: number; ny_date: string; vertical: string; reserved_usd: number; spent_usd: number | null };

function fakeLedger(o: { total?: unknown; broken?: boolean } = {}) {
  const rows: Row[] = [];
  let total = o.total;
  const q: TotalQuery = async (text, params = []) => {
    if (o.broken) throw new Error('relation "social_hub.refill_spend" does not exist');
    if (text.includes("key = 'refill_total_cap_usd'") && text.startsWith('SELECT')) return { rows: total === undefined ? [] : [{ value: total }] };
    if (text.includes('INSERT INTO social_hub.settings')) {
      total = params[0];
      return { rows: [] };
    }
    if (text.includes('sum(coalesce(spent_usd, reserved_usd))')) {
      const usd = rows.filter((r) => r.ny_date === params[0]).reduce((n, r) => n + (r.spent_usd ?? r.reserved_usd), 0);
      return { rows: [{ usd }] };
    }
    if (text.includes('INSERT INTO social_hub.refill_spend') && text.includes('settled_at')) {
      rows.push({ id: rows.length + 1, ny_date: params[0] as string, vertical: params[1] as string, reserved_usd: Number(params[2]), spent_usd: Number(params[2]) });
      return { rows: [] };
    }
    if (text.includes('INSERT INTO social_hub.refill_spend')) {
      const row = { id: rows.length + 1, ny_date: params[0] as string, vertical: params[1] as string, reserved_usd: Number(params[2]), spent_usd: null };
      rows.push(row);
      return { rows: [{ id: String(row.id) }] };
    }
    if (text.includes('UPDATE social_hub.refill_spend')) {
      const row = rows.find((r) => String(r.id) === params[0]);
      if (row) row.spent_usd = Number(params[1]);
      return { rows: [] };
    }
    throw new Error(`unexpected query: ${text}`);
  };
  return { q, rows };
}

const now = new Date('2026-11-21T08:00:00Z'); // 3 AM in New York
const logs: Array<[string, Record<string, unknown> | undefined]> = [];
const log = (m: string, f?: Record<string, unknown>) => void logs.push([m, f]);

test('defaults: D19 caps and a $5 total', () => {
  assert.equal(REFILL_TOTAL_DEFAULT_USD, 5);
  assert.equal(refillTotalUsd(undefined), 5);
  assert.equal(refillTotalUsd('7.5'), 7.5);
  assert.equal(refillTotalUsd(-1), 5);
  assert.equal(REFILL_CAP_DEFAULT_USD.reels, 1.5);
  assert.equal(REFILL_CAP_DEFAULT_USD.reel_ai_drama, 3);
  assert.equal(REFILL_CAP_DEFAULT_USD.ai_trivia, 2);
});

test('allowance: the cap, cut to what is left; nothing left is null', () => {
  assert.equal(allowance(2, 5, 0), 2);
  assert.equal(allowance(2, 5, 4), 1);
  assert.equal(allowance(2, 5, 5), null);
  assert.equal(allowance(2, 5, 4.995), null);
});

test('a refill reserves its cap, then settles at what it spent', async () => {
  const { q, rows } = fakeLedger();
  const grant = await beginRefill(q, 'reels', 1.5, { now, log });
  assert.ok(grant);
  assert.equal(grant.capUsd, 1.5);
  assert.equal(await spentTonightUsd(q, refillNight(now)), 1.5);
  await settleRefill(q, grant, 0.62);
  assert.equal(rows[0]!.spent_usd, 0.62);
  assert.equal(await spentTonightUsd(q, refillNight(now)), 0.62);
});

test('the total cuts later refills, then skips them with refill_total_capped', async () => {
  const { q } = fakeLedger({ total: 3 });
  logs.length = 0;
  const a = await beginRefill(q, 'carousels', 2, { now, log });
  await settleRefill(q, a, 2);
  const b = await beginRefill(q, 'ai_trivia', 2, { now, log });
  assert.equal(b?.capUsd, 1);
  await settleRefill(q, b, 1);
  const c = await beginRefill(q, 'real_or_ai', 2, { now, log });
  assert.equal(c, null);
  assert.equal(logs.at(-1)?.[0], 'refill_total_capped');
});

test('a new night starts fresh', async () => {
  const { q } = fakeLedger({ total: 1 });
  const a = await beginRefill(q, 'reels', 1.5, { now, log });
  await settleRefill(q, a, 1);
  assert.equal(await beginRefill(q, 'reels', 1.5, { now, log }), null);
  const tomorrow = new Date(now.getTime() + 24 * 3600_000);
  assert.equal((await beginRefill(q, 'reels', 1.5, { now: tomorrow, log }))?.capUsd, 1);
});

test('an unreadable ledger fails open on the type cap and logs it', async () => {
  const { q } = fakeLedger({ broken: true });
  logs.length = 0;
  const grant = await beginRefill(q, 'explainers', 1, { now, log });
  assert.deepEqual(grant, { capUsd: 1, id: null, nyDate: refillNight(now) });
  assert.equal(logs[0]?.[0], 'refill_total_unread');
  await settleRefill(q, grant, 0.3); // no row: a no-op, never throws
});

test('peek and record (Morning Download pool refresh)', async () => {
  const { q } = fakeLedger({ total: 2 });
  assert.equal(await peekRefill(q, 'stories', 2, { now }), 2);
  await recordRefill(q, 'stories', 1.5, { now });
  assert.equal(await peekRefill(q, 'stories', 2, { now }), 0.5);
  await recordRefill(q, 'stories', 0, { now }); // nothing spent: no row
  assert.equal(await spentTonightUsd(q, refillNight(now)), 1.5);
});

test('the total is a dollar amount above $0 and at most $50', async () => {
  const { q } = fakeLedger();
  assert.equal(await writeRefillTotalUsd(q, 8), 8);
  await assert.rejects(() => writeRefillTotalUsd(q, 0));
  await assert.rejects(() => writeRefillTotalUsd(q, 51));
  await assert.rejects(() => writeRefillTotalUsd(q, Number.NaN));
});
