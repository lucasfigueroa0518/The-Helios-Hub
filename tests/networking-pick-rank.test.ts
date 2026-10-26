import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import type { EntryType, Questions, SystemOneResult } from '@typesafe-ai/sdk';

import { createNetworkingJev, JevSpendCapError } from '@/lib/networking/pick/jev';
import { EVENT_PICK_CALL } from '@/lib/networking/pick/questions';
import { loadScoreHistory, rankWeek } from '@/lib/networking/pick/rank';
import { PLANTED_ID, VALUE_IDS } from '@/lib/networking/pick/score';
import type { EventPickState } from '@/lib/networking/pick/state';
import type { NetworkingQuery } from '@/lib/networking/repository';
import type { Metro } from '@/lib/networking/types';
import type { JevTransport } from '@/lib/reels/jev/runner';

// Offline: PGlite with the real networking and ai_events schemas; Jev is a stub transport.

function sql(file: string): string {
  return readFileSync(path.join(process.cwd(), 'db', file), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('\\'))
    .join('\n');
}

async function openDb(): Promise<{ pg: PGlite; q: NetworkingQuery }> {
  const pg = new PGlite();
  await pg.exec(sql('networking_schema.sql'));
  await pg.exec(sql('ai_events_schema.sql'));
  const q: NetworkingQuery = async (text, params) => ({ rows: (await pg.query(text, params as unknown[])).rows as never[] });
  return { pg, q };
}

/** Sunday 2026-10-25, 12:00 PM ET: the coming week is Mon Oct 26 to Sun Nov 1. */
const NOW = new Date('2026-10-25T16:00:00Z');

let seq = 0;
async function addEvent(
  q: NetworkingQuery,
  o: {
    title: string;
    metro?: Metro;
    startAt: string;
    timezone?: string;
    bucket?: string;
    status?: string;
    organizer?: string | null;
    guests?: number | null;
    description?: string;
  },
): Promise<string> {
  seq += 1;
  const { rows } = await q<{ id: string }>(
    `INSERT INTO networking.events (fingerprint, title, description, canonical_url, start_at, timezone, metro, attendance, access, bucket, status,
                                    organizer_name, guest_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'in_person', 'open', $8, $9, $10, $11)
     RETURNING id`,
    [
      `fp-${seq}`,
      o.title,
      o.description ?? `${o.title}: talks, demos and networking.`,
      `https://luma.com/e${seq}`,
      o.startAt,
      o.timezone ?? null,
      o.metro ?? 'boston',
      o.bucket ?? 'tech',
      o.status ?? 'scheduled',
      o.organizer === undefined ? `Org ${seq}` : o.organizer,
      o.guests ?? null,
    ],
  );
  return rows[0]!.id;
}

/** Answers by event title: every gate passes and every value question answers `value` unless overridden. */
function stubTransport(byTitle: Record<string, { value?: number } & Record<string, number>> = {}): JevTransport & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async systemOne<const Q extends Questions>(state: EntryType, questions: Q): Promise<SystemOneResult<Q>> {
      const title = (state as unknown as EventPickState).title;
      calls.push(title);
      const o = byTitle[title] ?? {};
      const base: Record<string, number> = {
        in_person_networking: 0.9,
        vendor_pitch: 0.1,
        get_rich: 0.05,
        ai_relevant: 0.9,
        [PLANTED_ID]: 0.02,
        ...Object.fromEntries(VALUE_IDS.map((id) => [id, o.value ?? 0.6])),
        ...Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'value')),
      };
      const answers = Object.fromEntries(Object.keys(questions).map((k) => [k, { type: 'noul', noul: base[k] ?? 0 }]));
      return { model: 'jev-stub-1', answers, usage: { input_tokens: 1000, output_tokens: 0 } } as unknown as SystemOneResult<Q>;
    },
  };
}

test('ai_events schema applies twice; the pool keys on (week_key, event_id)', async () => {
  const { pg, q } = await openDb();
  await pg.exec(sql('ai_events_schema.sql'));
  const id = await addEvent(q, { title: 'X', startAt: '2026-10-27T22:00:00Z' });
  await q(`INSERT INTO ai_events.pool (week_key, event_id, metro) VALUES ('2026-W44', $1, 'boston')`, [id]);
  await assert.rejects(() => q(`INSERT INTO ai_events.pool (week_key, event_id, metro) VALUES ('2026-W44', $1, 'boston')`, [id]));
  await assert.rejects(() => q(`INSERT INTO ai_events.pool (week_key, event_id, metro) VALUES ('2026-W45', $1, 'la')`, [id]));
  const { rows } = await q<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'ai_events' AND table_name = 'pool' ORDER BY ordinal_position`);
  assert.deepEqual(
    rows.map((r) => r.column_name),
    ['week_key', 'event_id', 'metro', 'rank', 'score', 'gate', 'picked', 'pick_rank', 'pinned_by', 'pinned_at', 'excluded_by', 'excluded_at', 'updated_at', 'partner', 'score_version'],
  );
  await pg.close();
});

test('candidates: the coming week in each metro\'s zone, scheduled tech/both events only', async () => {
  const { pg, q } = await openDb();
  await addEvent(q, { title: 'in-boston', startAt: '2026-10-27T22:00:00Z' });
  await addEvent(q, { title: 'both-bucket', startAt: '2026-10-28T22:00:00Z', bucket: 'both' });
  await addEvent(q, { title: 'vertical', startAt: '2026-10-28T22:00:00Z', bucket: 'vertical' });
  await addEvent(q, { title: 'cancelled', startAt: '2026-10-28T22:00:00Z', status: 'cancelled' });
  await addEvent(q, { title: 'this-sunday', startAt: '2026-10-25T22:00:00Z' });
  // Sunday Nov 1, 11:30 PM PT is in the SF week (Monday 07:30 UTC).
  await addEvent(q, { title: 'sf-sunday-late', metro: 'sf', startAt: '2026-11-02T07:30:00Z', timezone: 'America/Los_Angeles' });
  // Monday Nov 2, 1 AM ET is next week in NYC (Nov 2 06:00 UTC, EST).
  await addEvent(q, { title: 'nyc-next-monday', metro: 'nyc', startAt: '2026-11-02T06:00:00Z' });
  // Monday Oct 26, 00:30 ET opens the NYC week.
  await addEvent(q, { title: 'nyc-monday-early', metro: 'nyc', startAt: '2026-10-26T04:30:00Z' });

  const jev = stubTransport();
  const result = await rankWeek({ q, ask: jev, runId: null, now: NOW });
  assert.equal(result.weekKey, '2026-W44');
  assert.deepEqual(result.cities.map((c) => c.metro), ['miami', 'boston', 'nyc', 'sf'], 'AE-02 order');
  assert.deepEqual(jev.calls.sort(), ['both-bucket', 'in-boston', 'nyc-monday-early', 'sf-sunday-late']);
  await pg.close();
});

test('rankWeek scores, gates with stored reasons, picks, writes the pool, and logs every call', async () => {
  const { pg, q } = await openDb();
  const strong = await addEvent(q, { title: 'Strong', startAt: '2026-10-27T22:00:00Z', organizer: 'Shared Org', guests: 200 });
  const good = await addEvent(q, { title: 'Good', startAt: '2026-10-28T22:00:00Z', guests: 80 });
  const sameOrg = await addEvent(q, { title: 'Same org', startAt: '2026-10-29T22:00:00Z', organizer: 'Shared Org', guests: 300 });
  const weak = await addEvent(q, { title: 'Weak', startAt: '2026-10-29T22:00:00Z' });
  const pitch = await addEvent(q, { title: 'Pitch', startAt: '2026-10-30T22:00:00Z' });
  const planted = await addEvent(q, { title: 'Planted', startAt: '2026-10-30T23:00:00Z' });
  const jev = stubTransport({
    Strong: { value: 0.9 },
    Good: { value: 0.7 },
    'Same org': { value: 0.95 },
    Weak: { value: 0.1 },
    Pitch: { value: 0.9, vendor_pitch: 0.8 },
    Planted: { value: 0.9, [PLANTED_ID]: 0.95, ai_relevant: 0.2 },
  });
  const result = await rankWeek({ q, ask: jev, runId: '11111111-1111-4111-8111-111111111111', now: NOW });
  const boston = result.cities.find((c) => c.metro === 'boston')!;

  assert.equal(result.scored, 6);
  assert.equal(result.reused, 0);
  assert.deepEqual(result.failures, []);
  assert.equal(result.jev.calls, 6);
  assert.ok(Math.abs(result.jev.usd - (6 * 1000 * 0.042) / 1e6) < 1e-12);

  // Picks: Same org outscores Strong but shares its organizer; gated ones never pick. With no score
  // history and only three eligible events, the bar steps down to the gates (AE-28), so Weak is in.
  assert.deepEqual(boston.picks.map((p) => p.event.title), ['Same org', 'Good', 'Weak']);
  assert.equal(boston.tier, 'gates');
  assert.equal(boston.bar, null);
  assert.equal(boston.remainingCount, 6 - 3);
  const pitchRow = boston.ranked.find((p) => p.eventId === pitch)!;
  assert.equal(pitchRow.gate, 'vendor_pitch');
  assert.equal(pitchRow.score, null);
  assert.equal(boston.ranked.at(-1)!.score, null, 'gated events rank last');

  const scores = await q<{ event_id: string; gate: string | null; score: string | null; answers: Record<string, number>; parts: unknown[] }>(
    `SELECT event_id, gate, score::text AS score, answers, parts FROM networking.event_scores WHERE set_version = 'event-pick@1'`,
  );
  assert.equal(scores.rows.length, 6);
  const byId = new Map(scores.rows.map((r) => [r.event_id, r]));
  assert.equal(byId.get(pitch)!.gate, 'vendor_pitch');
  assert.equal(byId.get(planted)!.gate, `ai_relevant, ${PLANTED_ID}`);
  assert.equal(byId.get(planted)!.score, null);
  assert.equal(byId.get(strong)!.gate, null);
  assert.ok(Number(byId.get(strong)!.score) > 3);
  assert.equal(byId.get(strong)!.answers.notable_speakers, 0.9);
  assert.ok(Array.isArray(byId.get(strong)!.parts) && byId.get(strong)!.parts.length > 10);

  const pool = await q<{ event_id: string; rank: number | null; picked: boolean; gate: string | null; metro: string }>(
    `SELECT event_id, rank, picked, gate, metro FROM ai_events.pool WHERE week_key = '2026-W44' ORDER BY rank`,
  );
  assert.equal(pool.rows.length, 6);
  assert.deepEqual(pool.rows.map((r) => r.rank), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(pool.rows.filter((r) => r.picked).map((r) => r.event_id).sort(), [good, sameOrg, weak].sort());
  assert.equal(pool.rows.find((r) => r.event_id === strong)!.picked, false, 'one per organizer');

  // Logs: one row per question set per call; one cost row per call, with week and run.
  const logs = await q<{ question_set_version: string; n: number }>(
    `SELECT question_set_version, count(*)::int AS n FROM networking.jev_logs WHERE week_key = '2026-W44' GROUP BY 1 ORDER BY 1`,
  );
  assert.deepEqual(logs.rows, [{ question_set_version: 'event-pick@1', n: 6 }, { question_set_version: 'planted-v1', n: 6 }]);
  const plantedLog = await q<{ answers: Record<string, unknown>; state: EventPickState }>(
    `SELECT answers, state FROM networking.jev_logs WHERE question_set_version = 'planted-v1' AND event_id = $1`,
    [planted],
  );
  assert.deepEqual(Object.keys(plantedLog.rows[0]!.answers), [PLANTED_ID]);
  assert.ok(plantedLog.rows[0]!.state.listing.untrusted_content.includes('Planted'));
  const cost = await q<{ n: number; run_id: string; vendor: string }>(
    `SELECT count(*)::int AS n, min(run_id::text) AS run_id, min(vendor) AS vendor FROM networking.cost_events WHERE week_key = '2026-W44'`,
  );
  assert.deepEqual(cost.rows[0], { n: 6, run_id: '11111111-1111-4111-8111-111111111111', vendor: 'jev' });
  await pg.close();
});

test('an event already scored for event-pick@1 is never asked again; pins and excludes survive a rerun', async () => {
  const { pg, q } = await openDb();
  const a = await addEvent(q, { title: 'A', startAt: '2026-10-27T22:00:00Z' });
  const b = await addEvent(q, { title: 'B', startAt: '2026-10-28T22:00:00Z', guests: 5 });
  const c = await addEvent(q, { title: 'C', startAt: '2026-10-29T22:00:00Z' });
  const low = await addEvent(q, { title: 'Low', startAt: '2026-10-30T22:00:00Z' });
  const answers = { A: { value: 0.9 }, B: { value: 0.8 }, C: { value: 0.7 }, Low: { value: 0.05 } };

  const first = stubTransport(answers);
  await rankWeek({ q, ask: first, runId: null, now: NOW });
  assert.equal(first.calls.length, 4);

  // A person pins the weak event and excludes the best one.
  await q(`UPDATE ai_events.pool SET pinned_by = 'lucas', pinned_at = now() WHERE event_id = $1`, [low]);
  await q(`UPDATE ai_events.pool SET excluded_by = 'lucas', excluded_at = now() WHERE event_id = $1`, [a]);
  // Going counts move between runs: the score follows, the answers do not.
  await q(`UPDATE networking.events SET guest_count = 250 WHERE id = $1`, [c]);
  // A new event arrives and is the only one asked about.
  await addEvent(q, { title: 'New', startAt: '2026-10-31T16:00:00Z' });

  const second = stubTransport({ ...answers, New: { value: 0.2 } });
  const result = await rankWeek({ q, ask: second, runId: null, now: NOW });
  assert.deepEqual(second.calls, ['New']);
  assert.equal(result.reused, 4);
  assert.equal(result.scored, 1);

  const boston = result.cities.find((x) => x.metro === 'boston')!;
  assert.deepEqual(boston.picks.map((p) => p.event.title), ['Low', 'C', 'B', 'New'], 'the pin first, the exclude gone, C up on attendance');
  assert.ok(boston.ranked.find((p) => p.eventId === c)!.cached);

  const pool = await q<{ event_id: string; pinned_by: string | null; excluded_by: string | null; picked: boolean; pick_rank: number | null }>(
    `SELECT event_id, pinned_by, excluded_by, picked, pick_rank FROM ai_events.pool WHERE week_key = '2026-W44'`,
  );
  const row = (id: string) => pool.rows.find((r) => r.event_id === id)!;
  assert.equal(row(low).pinned_by, 'lucas');
  assert.equal(row(low).picked, true);
  // The pin is the first pick although it ranks last by score; the site reads this order.
  assert.deepEqual([row(low).pick_rank, row(c).pick_rank, row(b).pick_rank, row(a).pick_rank], [1, 2, 3, null]);
  assert.equal(row(a).excluded_by, 'lucas');
  assert.equal(row(a).picked, false);
  const { rows } = await q<{ n: number }>(`SELECT count(*)::int AS n FROM networking.event_scores`);
  assert.equal(rows[0]!.n, 5);
  const stored = await q<{ score: string }>(`SELECT score::text AS score FROM networking.event_scores WHERE event_id = $1`, [c]);
  assert.equal(Number(stored.rows[0]!.score), boston.ranked.find((p) => p.eventId === c)!.score, 'the stored score follows the current terms');
  await pg.close();
});

test('past weeks set the bar (top 30% → 50%), only v2 gated-in scores count, and a partner skips it', async () => {
  const { pg, q } = await openDb();
  // 20 past Boston scores 0, 0.5 … 9.5: top 30% is 6.65, top 40% 5.7, top 50% 4.75.
  for (let i = 0; i < 20; i++) {
    const id = await addEvent(q, { title: `Past ${i}`, startAt: '2026-10-07T22:00:00Z', organizer: null });
    await q(`INSERT INTO ai_events.pool (week_key, event_id, metro, score, score_version) VALUES ('2026-W41', $1, 'boston', $2, 'v2')`, [id, i / 2]);
  }
  // Not history: a v1 score, a gated row, and a later week.
  for (const [week, score, gate, version] of [['2026-W41', 9.9, null, 'v1'], ['2026-W41', 9.9, 'vendor_pitch', 'v2'], ['2026-W45', 9.9, null, 'v2']] as const) {
    const id = await addEvent(q, { title: `Noise ${week}${version}${gate}`, startAt: '2026-10-07T22:00:00Z', organizer: null });
    await q(`INSERT INTO ai_events.pool (week_key, event_id, metro, score, gate, score_version) VALUES ($1, $2, 'boston', $3, $4, $5)`, [week, id, score, gate, version]);
  }
  const history = await loadScoreHistory(q, ['boston'], '2026-W44');
  assert.equal(history.get('boston')!.length, 20);

  // Four strong events (about 6.05 with Tough Tech Week) and one weak one (about 2.85).
  for (const [i, day] of ['27', '28', '29', '30'].entries()) await addEvent(q, { title: `Strong ${i}`, startAt: `2026-10-${day}T22:00:00Z`, guests: 250 });
  await addEvent(q, { title: 'Weak', startAt: '2026-10-31T16:00:00Z', guests: 250 });
  await addEvent(q, { title: 'Hub night', metro: 'miami', startAt: '2026-10-28T23:00:00Z', organizer: 'Miami AI Hub', timezone: 'America/New_York' });
  const jev = stubTransport({ Weak: { value: 0.1 }, 'Hub night': { value: 0.1, vendor_pitch: 0.9 } });
  const result = await rankWeek({ q, ask: jev, runId: null, now: NOW });

  const boston = result.cities.find((c) => c.metro === 'boston')!;
  assert.equal(boston.tier, 'top50', 'nothing clears 6.65 or 5.7; four clear 4.75');
  assert.ok(Math.abs(boston.bar! - 4.75) < 1e-9);
  assert.deepEqual(boston.picks.map((p) => p.event.title).sort(), ['Strong 0', 'Strong 1', 'Strong 2', 'Strong 3']);

  const miami = result.cities.find((c) => c.metro === 'miami')!;
  assert.deepEqual(miami.picks.map((p) => p.event.title), ['Hub night'], 'a gated partner event still goes in');
  const { rows } = await q<{ partner: string | null; score_version: string }>(
    `SELECT p.partner, p.score_version FROM ai_events.pool p JOIN networking.events e ON e.id = p.event_id WHERE e.title = 'Hub night'`,
  );
  assert.deepEqual(rows, [{ partner: 'Miami AI Hub', score_version: 'v2' }]);
  await pg.close();
});

test('a rebuild with a week key ranks that week, whatever the run date; its picks stay', async () => {
  const { pg, q } = await openDb();
  await addEvent(q, { title: 'This week', startAt: '2026-10-28T22:00:00Z' });
  await addEvent(q, { title: 'Next week', startAt: '2026-11-04T23:00:00Z' });
  const jev = stubTransport({ 'This week': { value: 0.9 }, 'Next week': { value: 0.9 } });
  await rankWeek({ q, ask: jev, runId: null, now: NOW });
  assert.deepEqual(jev.calls, ['This week']);

  // Monday of W44: comingWeek would be W45, but a rebuild of W44 must stay on W44.
  const result = await rankWeek({ q, ask: jev, runId: null, now: new Date('2026-10-26T15:00:00Z'), weekKey: '2026-W44' });
  assert.equal(result.week.startDate, '2026-10-26');
  assert.deepEqual(jev.calls, ['This week'], 'no call for next week\'s event');
  const { rows } = await q<{ picked: boolean }>(`SELECT picked FROM ai_events.pool WHERE week_key = '2026-W44'`);
  assert.deepEqual(rows, [{ picked: true }]);
  await assert.rejects(() => rankWeek({ q, ask: jev, runId: null, now: NOW, weekKey: '2026-44' }), /not an ISO week key/);
  await pg.close();
});

test('the spend cap stops further calls; a run where every call fails throws', async () => {
  const { pg, q } = await openDb();
  const jev = createNetworkingJev(stubTransport(), q, { weekKey: '2026-W44', runId: null, capUsd: 0.00001 });
  const state = { title: 'x' } as unknown as EntryType;
  await jev.ask({ component: 'event-pick', sets: EVENT_PICK_CALL.sets, questions: EVENT_PICK_CALL.questions, state, eventId: null });
  await assert.rejects(
    () => jev.ask({ component: 'event-pick', sets: EVENT_PICK_CALL.sets, questions: EVENT_PICK_CALL.questions, state, eventId: null }),
    JevSpendCapError,
  );
  assert.equal(jev.calls, 1);

  await addEvent(q, { title: 'One', startAt: '2026-10-27T22:00:00Z' });
  const broken: JevTransport = {
    async systemOne() {
      throw new Error('TYPESAFE_API_KEY is not set');
    },
  };
  await assert.rejects(() => rankWeek({ q, ask: broken, runId: null, now: NOW }), /every Jev call failed/);
  await pg.close();
});
