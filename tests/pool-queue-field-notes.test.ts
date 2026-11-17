/**
 * Field Notes on the shared idea queue (Tommy, 2026-11-16: "however the other ones are running, it should run"), offline:
 * PGlite with the real hub, media_library and field_notes schemas; stub Claude, Jev and render (no network).
 *   - the selector: archived tips are never picked, pins go first in the order pinned, a dragged tip sits at its key
 *   - a run: pinned tips lead the post, archived seeds stay out, and the pins and placements it read are used up
 *   - Make it on a chosen tip: the same queued run as Generate (cap check, one at a time), this tip first; archived or used
 *     tips refused; the route's 401 / 404 / 409 / 200
 */
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { fieldNotesTipMakeRoute } from '@/app/api/field-notes/tips/[id]/make/handler';
import { queueTipFieldNotesRun, TIP_MAKE_REFUSALS } from '@/lib/field-notes/manual';
import { selectTips, type SelectInput } from '@/lib/field-notes/sources/select';
import { claimRun, requestRun, saveSeededLink, setTipContent } from '@/lib/field-notes/store';
import type { TipCandidate } from '@/lib/field-notes/sources/candidate';
import type { Want } from '@/lib/field-notes/types';
import { carryOutFieldNotesRun, type CarryOutDeps } from '@/lib/field-notes/worker';
import type { HubQuery } from '@/lib/social-hub/db';
import { nightQueue } from '@/lib/social-hub/queue';

import { addPool, freshDb, NOW, stubEngine, type StubEngine } from './fixtures/field-notes/run/seed';

const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = (async () => {
    throw new Error('network is off in tests');
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
});

// ── the selector (pure) ──────────────────────────────────────────────────────

const cand = (id: string, score: number): SelectInput['scored'][number] => ({
  id,
  candidate: { sourceUrl: `https://docs.example.com/${id}`, sourceKind: 'docs', sourceLabel: id, publishedAt: '2026-11-01T00:00:00Z', item: {} as TipCandidate['item'], untrustedContent: `${id} subject\n\nhow it works` },
  score, answers: {}, usd: 0, questionSetVersion: '', leaf: null, want: null, tier: null, purposes: [], fresh: null,
}) as never;
const pick = (input: Partial<SelectInput>, n: number) =>
  selectTips({ scored: [cand('a', 0.9), cand('b', 0.8), cand('c', 0.7), cand('d', 0.6), cand('e', 0.5)], now: NOW, tipExpiryDays: 30, ...input }, n).map((s) => s.candidate.sourceLabel).join('');

test('selectTips without a queue: score order, as before', () => {
  assert.equal(pick({}, 3), 'abc');
});

test('selectTips: archived tips are never picked, even when nothing else is left', () => {
  const queue = nightQueue([{ ideaId: 'a', kind: 'archive' }, { ideaId: 'b', kind: 'archive' }]);
  assert.equal(pick({ queue }, 3), 'cde');
  assert.equal(pick({ queue, minTotal: 5 }, 5), 'cde', 'the starvation relax never brings an archived tip back');
});

test('selectTips: pins first in the order pinned, then a dragged tip at its key among the scores', () => {
  const queue = nightQueue([
    { ideaId: 'e', kind: 'pin' },
    { ideaId: 'd', kind: 'pin' },
    { ideaId: 'c', kind: 'place', sortKey: 0.95 },
  ]);
  assert.equal(pick({ queue }, 4), 'edca');
  // An archive outranks a pin.
  assert.equal(pick({ queue: nightQueue([{ ideaId: 'e', kind: 'pin' }, { ideaId: 'e', kind: 'archive' }]) }, 2), 'ab');
});

// ── a run (PGlite) ───────────────────────────────────────────────────────────

const WANTS: Want[] = ['faster', 'better', 'newly_possible', 'cheaper'];
async function seeds(q: HubQuery, n: number, tag: string): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const out = await saveSeededLink(q, { sourceUrl: `https://docs.example.com/${tag}-${i}`, sourceLabel: 'docs.example.com', subject: `${tag} subject ${i}`, leaf: 'coding_agent_feature', want: WANTS[i % WANTS.length]!, useWithResult: '', seededBy: 'tommy' });
    await setTipContent(q, out.tipId, 'Open the settings page, find the review option and switch it on. Type /review after a run to get a second pass.');
    await q(`UPDATE field_notes.tips SET created_at = created_at - make_interval(secs => $2::int) WHERE id = $1`, [out.tipId, (n - i) * 10]);
    ids.push(out.tipId);
  }
  return ids;
}
const move = (q: HubQuery, tipId: string, kind: string, sortKey: number | null = null) =>
  q(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind, sort_key) VALUES ('field_notes', $1, '2026-11-04', $2, $3)`, [`field_notes:tip:${tipId}`, kind, sortKey]);
const worker = (query: HubQuery, engine: StubEngine): CarryOutDeps => ({ query, now: () => NOW, log: () => undefined, engine: async () => engine });

test('a run: a pinned tip leads the post, an archived seed stays out, and the moves it read are used up', async () => {
  const { query } = await freshDb();
  await addPool(query, 6);
  const [s0, s1, s2, s3] = await seeds(query, 4, 'q');
  await move(query, s1!, 'archive');
  await move(query, s3!, 'pin');
  await move(query, s2!, 'place', 0.5);
  await requestRun(query, 'manual', 0.5, { requestedBy: 'tommy', seedTipId: null });
  const r = await carryOutFieldNotesRun(worker(query, stubEngine(query)), (await claimRun(query, NOW))!);
  assert.equal(r.status, 'ok', r.note);
  const post = (await query<{ tip_ids: string[] }>(`SELECT tip_ids::text[] AS tip_ids FROM field_notes.posts`)).rows[0]!;
  assert.equal(post.tip_ids[0], s3, 'the pinned tip is first');
  assert.ok(!post.tip_ids.includes(s1!), 'the archived seed is never picked');
  assert.deepEqual([...post.tip_ids].sort(), [s0, s2, s3].sort());
  const active = (await query<{ idea_id: string; kind: string }>(`SELECT idea_id, kind FROM social_hub.idea_adjustments WHERE vertical = 'field_notes' AND consumed_at IS NULL ORDER BY kind`)).rows;
  assert.deepEqual(active, [{ idea_id: `field_notes:tip:${s1}`, kind: 'archive' }], 'the pin and the placement are spent; the archive stays');
});

test('a person\'s Generate keeps the drags it did not use; the scheduled night uses them all up', async () => {
  for (const trigger of ['manual', 'scheduled'] as const) {
    const { query } = await freshDb();
    await addPool(query, 6);
    const [, , , , , s5] = await seeds(query, 6, `t${trigger}`);
    // Dragged far down: the run takes the best tips first, so this one is read but not put on the post.
    await move(query, s5!, 'place', -5);
    await requestRun(query, trigger, 0.5, { requestedBy: trigger === 'manual' ? 'tommy' : null, seedTipId: null, nyDate: trigger === 'scheduled' ? '2026-11-06' : null });
    const r = await carryOutFieldNotesRun(worker(query, stubEngine(query)), (await claimRun(query, NOW))!);
    assert.equal(r.status, 'ok', r.note);
    const tipIds = (await query<{ tip_ids: string[] }>(`SELECT tip_ids::text[] AS tip_ids FROM field_notes.posts`)).rows[0]!.tip_ids;
    assert.ok(!tipIds.includes(s5!), 'the dragged tip is not on this post');
    const place = (await query<{ consumed: boolean }>(`SELECT consumed_at IS NOT NULL AS consumed FROM social_hub.idea_adjustments WHERE idea_id = $1`, [`field_notes:tip:${s5}`])).rows[0]!;
    assert.equal(place.consumed, trigger === 'scheduled', `${trigger}: the drag is ${trigger === 'scheduled' ? 'used up' : 'kept'}`);
  }
});

test('a pin on a tip that is no longer waiting steps aside with why', async () => {
  const { query } = await freshDb();
  await addPool(query, 6);
  const [s0] = await seeds(query, 3, 'g');
  await query(`UPDATE field_notes.tips SET status = 'rejected' WHERE id = $1`, [s0]);
  await move(query, s0!, 'pin');
  await requestRun(query, 'manual', 0.5, { requestedBy: 'tommy', seedTipId: null });
  await carryOutFieldNotesRun(worker(query, stubEngine(query)), (await claimRun(query, NOW))!);
  const pin = (await query<{ skip_reason: string | null }>(`SELECT skip_reason FROM social_hub.idea_adjustments WHERE idea_id = $1`, [`field_notes:tip:${s0}`])).rows[0]!;
  assert.match(pin.skip_reason ?? '', /no longer waiting/);
});

// ── Make it ──────────────────────────────────────────────────────────────────

test('Make it queues the same run as Generate with this tip first; archived and used tips are refused; one run at a time', async () => {
  const { query } = await freshDb();
  const [a, b, c] = await seeds(query, 3, 'm');
  await move(query, b!, 'archive');
  assert.deepEqual(await queueTipFieldNotesRun(query, b!, 'tommy'), { ok: false, note: TIP_MAKE_REFUSALS.archived, capUsd: null });
  await query(`UPDATE field_notes.tips SET status = 'drafted' WHERE id = $1`, [c]);
  assert.equal((await queueTipFieldNotesRun(query, c!, 'tommy')).note, TIP_MAKE_REFUSALS.used);
  assert.equal((await queueTipFieldNotesRun(query, '00000000-0000-4000-8000-000000000000', 'tommy')).note, TIP_MAKE_REFUSALS.missing);
  const out = await queueTipFieldNotesRun(query, a!, 'tommy');
  assert.equal(out.ok, true, out.note);
  assert.ok(out.capUsd != null && out.capUsd > 0, 'the cap the run spends under');
  const run = (await query<{ trigger: string; status: string; requested_by: string; seed: string }>(`SELECT trigger, status, requested_by, record->>'seedTipId' AS seed FROM field_notes.runs`)).rows;
  assert.deepEqual(run, [{ trigger: 'manual', status: 'requested', requested_by: 'tommy', seed: a }]);
  assert.equal((await queueTipFieldNotesRun(query, a!, 'tommy')).ok, false, 'a second click while one is queued queues nothing');
  await query(`DELETE FROM field_notes.runs`);
  await query(`UPDATE field_notes.settings SET value = '0'::jsonb WHERE key = 'run_cap_usd'`);
  const capped = await queueTipFieldNotesRun(query, a!, 'tommy');
  assert.equal(capped.ok, false);
  assert.match(capped.note, /run_cap_usd/, 'the same cap check as Generate');
  assert.equal((await query(`SELECT 1 FROM field_notes.runs`)).rows.length, 0);
});

test('the Make it route: 401 without a session, 404 for a bad id, 409 with the note, 200 when queued', async () => {
  const calls: string[] = [];
  const make = async (_email: string, tipId: string) => {
    calls.push(tipId);
    return tipId.startsWith('1') ? { ok: true, note: 'Run queued.', capUsd: 0.5 } : { ok: false, note: 'nope', capUsd: null };
  };
  const ok = '11111111-1111-4111-8111-111111111111';
  assert.equal((await fieldNotesTipMakeRoute({ session: async () => null, make }, ok)).status, 401);
  assert.equal((await fieldNotesTipMakeRoute({ session: async () => ({ email: 't' }), make }, 'not-a-uuid')).status, 404);
  assert.deepEqual(calls, [], 'nothing queued before the guards pass');
  const queued = await fieldNotesTipMakeRoute({ session: async () => ({ email: 't' }), make }, ok);
  assert.equal(queued.status, 200);
  assert.deepEqual(await queued.json(), { queued: true, note: 'Run queued.', capUsd: 0.5 });
  const refused = await fieldNotesTipMakeRoute({ session: async () => ({ email: 't' }), make }, '22222222-2222-4222-8222-222222222222');
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error, 'nope');
});
