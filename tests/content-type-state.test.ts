/**
 * Settings standard (planning/settings-standard/CONTRACT.md; D14, D16–D18): the state ↔ stored-key mapping, the
 * mismatch case, refill cap defaults, the posting patch rules, and Pause sending scheduled posts back to the Made
 * tab. Offline: every query goes to a stub that records it. No model calls.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { fieldsOf, writePosting, type Stored } from '@/lib/content-type/posting';
import { keysOf, refillCapUsd, REFILL_CAP_DEFAULT_USD, stateOf, TYPE_STATES } from '@/lib/content-type/state';
import { cancelPassedSlots, scheduledAhead, typeSlotWhere, unslotType, unslottedSql } from '@/lib/content-type/unslot';
import { parsePanelSettings, parsePatch } from '@/app/api/field-notes/settings/handler';
import { parseAiEventsSettings } from '@/lib/ai-events/settings';
import { parseFieldNotesSettings } from '@/lib/field-notes/settings';
import { parseLfdSettings } from '@/lib/lfd/settings';

type Call = { text: string; params: unknown[] };

/** A query stub: records every statement; answers counts with `n`, everything else with no rows. */
function recorder(n = 0) {
  const calls: Call[] = [];
  const query = async (text: string, params: unknown[] = []) => {
    calls.push({ text: text.replace(/\s+/g, ' ').trim(), params });
    if (/count\(\*\)::int AS n/.test(text)) return { rows: [{ n }] };
    if (/UPDATE social_hub\.schedule/.test(text) && /RETURNING/.test(text) && !/WITH sets/.test(text)) return { rows: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, vertical: params[1] })) };
    if (/WITH sets/.test(text)) return { rows: [{ sets: n, slots: n }] };
    return { rows: [] };
  };
  return { calls, query };
}

// ── The model ────────────────────────────────────────────────────────────────

test('stateOf / keysOf: each state round-trips through its stored pair', () => {
  assert.deepEqual(keysOf('paused'), { generate: false, live: false });
  assert.deepEqual(keysOf('approval'), { generate: true, live: false });
  assert.deepEqual(keysOf('live'), { generate: true, live: true });
  for (const s of TYPE_STATES) {
    const k = keysOf(s);
    assert.deepEqual(stateOf(k.generate, k.live), { state: s, mismatch: false }, s);
  }
});

test('stateOf: Generate off with Live on reads as paused and flags the mismatch; missing is off (D6)', () => {
  assert.deepEqual(stateOf(false, true), { state: 'paused', mismatch: true });
  assert.deepEqual(stateOf(null, true), { state: 'paused', mismatch: true });
  assert.deepEqual(stateOf(undefined, undefined), { state: 'paused', mismatch: false });
  assert.deepEqual(stateOf(true, null), { state: 'approval', mismatch: false });
});

test('refillCapUsd: stored positive numbers win; missing or bad falls back to the type default (D19)', () => {
  // The defaults themselves are the lead's call (D19); here only that every type has a positive one.
  for (const [t, v] of Object.entries(REFILL_CAP_DEFAULT_USD)) assert.ok(typeof v === 'number' && v > 0, t);
  assert.equal(refillCapUsd('carousels', 0.4), 0.4);
  assert.equal(refillCapUsd('carousels', '0.3'), 0.3);
  for (const bad of [null, undefined, 0, -1, 'abc', true, Number.NaN]) assert.equal(refillCapUsd('explainers', bad), REFILL_CAP_DEFAULT_USD.explainers, String(bad));
});

// ── posting.ts ───────────────────────────────────────────────────────────────

const stored = (over: Partial<Stored>): Stored => ({ type: 'carousels', generate: null, live: null, refill: null, perDay: 1, maxPerDay: 2, series: null, ...over });

test('fieldsOf: the stored pair becomes the state; live/generate are derived from it; the mismatch reads as paused', () => {
  const paused = fieldsOf(stored({ generate: false, live: true }), 3);
  assert.equal(paused.state, 'paused');
  assert.equal(paused.stateMismatch, true);
  assert.equal(paused.live, false, 'a paused type posts nothing, even with publishing_live on');
  assert.equal(paused.generate, false);
  assert.equal(paused.scheduledAhead, 3);
  assert.equal(paused.refillCapUsd, REFILL_CAP_DEFAULT_USD.carousels);
  assert.ok(!('autoPublish' in paused), 'autoPublish is removed');
  const live = fieldsOf(stored({ generate: true, live: true, refill: 0.4 }), 0);
  assert.deepEqual([live.state, live.stateMismatch, live.live, live.generate, live.refillCapUsd], ['live', false, true, true, 0.4]);
  // Text on Screen: a missing auto_run is off now (D6); the migration writes its explicit row.
  assert.equal(fieldsOf(stored({ type: 'reels', generate: null, live: true }), 0).state, 'paused');
  // A non-boolean stored value is off.
  assert.equal(fieldsOf(stored({ generate: 'true', live: false }), 0).state, 'paused');
});

test('writePosting refuses live / generate / autoPublish, a bad state and a bad refill cap, before any query', async () => {
  for (const k of ['live', 'generate', 'autoPublish']) {
    await assert.rejects(() => writePosting('carousels', { [k]: true } as never, 't'), /no longer a setting/, k);
    await assert.rejects(() => writePosting('carousels', { [k]: false } as never, 't'), /no longer a setting/, k);
  }
  await assert.rejects(() => writePosting('carousels', { state: 'on' as never }, 't'), /Paused, Approval or Live/);
  for (const bad of [0, -0.1, 5.01, Number.NaN, '0.3' as never]) {
    await assert.rejects(() => writePosting('explainers', { refillCapUsd: bad }, 't'), /refill cap/, String(bad));
  }
});

// ── Back to Made (D17, D18) ─────────────────────────────────────────────────

test('unslotType: a type by its vertical, future scheduled slots only, cancelled with the reason; approvals untouched', async () => {
  const { calls, query } = recorder(2);
  assert.deepEqual(await unslotType(query, 'carousels', 'paused'), { slots: 2, sets: 0 });
  assert.equal(calls.length, 1);
  const [c] = calls;
  assert.match(c!.text, /^UPDATE social_hub\.schedule SET status = 'cancelled', error = \$1 WHERE status = 'scheduled' AND publish_at > now\(\) AND vertical = \$2 RETURNING id$/);
  assert.deepEqual(c!.params, ['paused', 'carousels']);
  assert.doesNotMatch(c!.text, /approvals|approved_at/, 'the post stays approved (D18)');
});

test('unslotType: a Stories type by its series, its sets back to approved with no minute, in one statement', async () => {
  const { calls, query } = recorder(1);
  assert.deepEqual(await unslotType(query, 'ai_trivia', 'paused'), { slots: 1, sets: 1 });
  assert.equal(calls.length, 1);
  const [c] = calls;
  assert.match(c!.text, /UPDATE stories\.sets SET status = 'approved', publish_at = NULL, updated_at = now\(\) WHERE series = \$2 AND status = 'scheduled' AND publish_at > now\(\)/);
  assert.match(c!.text, /UPDATE social_hub\.schedule SET status = 'cancelled', error = \$1 WHERE status = 'scheduled' AND publish_at > now\(\) AND vertical = ANY\(\$3::text\[\]\) AND \(slot = \$4 OR split_part\(slot, ':', 2\) = \$4\)/);
  assert.doesNotMatch(c!.text, /approved_at = NULL/, 'the set keeps its approval (D18)');
  assert.deepEqual(c!.params, ['paused', 'ai_trivia', ['stories', 'ai_trivia', 'real_or_ai'], 'ai_trivia']);
  // Morning Download's series is morning_download (its hub id stays `stories`).
  assert.deepEqual(typeSlotWhere('stories').params, [['stories', 'ai_trivia', 'real_or_ai'], 'morning_download']);
});

test('scheduledAhead counts the same slots Pause would take back', async () => {
  const { calls, query } = recorder(4);
  assert.equal(await scheduledAhead(query, 'real_or_ai'), 4);
  assert.match(calls[0]!.text, /FROM social_hub\.schedule WHERE status = 'scheduled' AND publish_at > now\(\) AND vertical = ANY\(\$1::text\[\]\)/);
  assert.deepEqual(calls[0]!.params, [['stories', 'ai_trivia', 'real_or_ai'], 'real_or_ai']);
});

test('cancelPassedSlots: due slots of the given not-Live types, reason slot-passed; none given, no query', async () => {
  const { calls, query } = recorder(1);
  assert.deepEqual(await cancelPassedSlots(query, []), []);
  assert.equal(calls.length, 0);
  await cancelPassedSlots(query, ['carousels', 'explainers']);
  assert.match(calls[0]!.text, /SET status = 'cancelled', error = \$1 WHERE status = 'scheduled' AND publish_at <= now\(\) AND vertical = ANY\(\$2::text\[\]\)/);
  assert.deepEqual(calls[0]!.params, ['slot-passed', ['carousels', 'explainers']]);
});

test('unslottedSql: matches only the unslot reasons and the approved-while-Paused hold (D18), and never an item that has a live slot again', () => {
  const sql = unslottedSql('ci.id');
  assert.match(sql, /u\.error IN \('paused', 'slot-passed', 'paused-hold'\)/);
  assert.match(sql, /NOT EXISTS .* w\.status IN \('scheduled', 'publishing', 'published'\)/s);
});

// ── writePosting: Pause issues the unslot through the app's database ──────────

const pool = globalThis as { __outreachHubPool?: unknown; __outreachHubGate?: unknown };

function withPool(n: number) {
  const r = recorder(n);
  pool.__outreachHubPool = { query: r.query, options: { max: 4 }, on: () => undefined };
  pool.__outreachHubGate = undefined;
  return r;
}

test('writePosting(carousels, paused): Live off before Generate off, then its future slots are unslotted by vertical', async (t) => {
  t.after(() => {
    pool.__outreachHubPool = undefined;
  });
  const { calls } = withPool(0);
  const state = await writePosting('carousels', { state: 'paused' }, 't');
  const writes = calls.filter((c) => /^INSERT INTO social\.settings/.test(c.text)).map((c) => c.params);
  assert.deepEqual(writes, [['publishing_live', 'false'], ['auto_run', 'false']]);
  const unslot = calls.find((c) => /^UPDATE social_hub\.schedule SET status = 'cancelled'/.test(c.text));
  assert.ok(unslot, 'pause unslots');
  assert.deepEqual(unslot!.params, ['paused', 'carousels']);
  assert.ok(!calls.some((c) => /require_approval/.test(JSON.stringify(c))), 'approval is never written false');
  assert.equal(state.state, 'paused');
});

test('writePosting(carousels, live): Generate on before Live on, and nothing is unslotted', async (t) => {
  t.after(() => {
    pool.__outreachHubPool = undefined;
  });
  const { calls } = withPool(0);
  await writePosting('carousels', { state: 'live', refillCapUsd: 0.4 }, 't');
  const writes = calls.filter((c) => /^INSERT INTO social\.settings/.test(c.text)).map((c) => c.params);
  assert.deepEqual(writes, [['auto_run', 'true'], ['publishing_live', 'true'], ['pool_refill_cap_usd', '0.4']]);
  assert.ok(!calls.some((c) => /SET status = 'cancelled'/.test(c.text)));
});

test('writePosting(ai_trivia, paused): the Stories unslot runs for its series', async (t) => {
  t.after(() => {
    pool.__outreachHubPool = undefined;
  });
  const { calls } = withPool(0);
  await writePosting('ai_trivia', { state: 'paused' }, 't');
  const unslot = calls.find((c) => /WITH sets AS/.test(c.text));
  assert.ok(unslot, 'pause unslots the series');
  assert.deepEqual(unslot!.params, ['paused', 'ai_trivia', ['stories', 'ai_trivia', 'real_or_ai'], 'ai_trivia']);
  const types = calls.find((c) => /INSERT INTO stories\.settings .*'types'/.test(c.text));
  assert.ok(types);
  const saved = JSON.parse(String(types!.params[0])) as Record<string, { requireApproval: boolean; publishingLive: boolean }>;
  assert.equal(saved.ai_trivia!.publishingLive, false);
  for (const v of Object.values(saved)) assert.equal(v.requireApproval, true);
});

// ── Settings readers never read approval as off ─────────────────────────────

test('settings readers: require_approval false is read as true; refill caps read with their defaults', () => {
  const off = [{ key: 'require_approval', value: false }];
  assert.equal(parseLfdSettings(off).requireApproval, true);
  assert.equal(parseAiEventsSettings(off).requireApproval, true);
  assert.equal(parseFieldNotesSettings(off).requireApproval, true);
  assert.equal(parseLfdSettings([]).refillCapUsd, REFILL_CAP_DEFAULT_USD.last_few_days);
  assert.equal(parseAiEventsSettings([{ key: 'pool_refill_cap_usd', value: 0.1 }]).refillCapUsd, 0.1);
  assert.equal(parseFieldNotesSettings([]).refillCapUsd, REFILL_CAP_DEFAULT_USD.field_notes);
});

test('Field Notes settings: the panel reads the state; the old switches are refused', () => {
  const p = parsePanelSettings([{ key: 'auto_run', value: false }, { key: 'publishing_live', value: true }, { key: 'require_approval', value: false }]);
  assert.deepEqual([p.state, p.stateMismatch, p.autoRun, p.publishingLive, p.requireApproval], ['paused', true, false, false, true]);
  assert.deepEqual(parsePatch({ state: 'approval' }), { state: 'approval' });
  for (const k of ['autoRun', 'publishingLive', 'requireApproval']) assert.match((parsePatch({ [k]: true }) as { error: string }).error, /no longer a setting/);
  assert.match((parsePatch({ state: 'on' }) as { error: string }).error, /Paused, Approval or Live/);
});
