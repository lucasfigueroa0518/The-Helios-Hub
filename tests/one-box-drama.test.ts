/**
 * One-box seeding v2, Task 9: the AI Drama seed runner (drama worker). A person's story goes to producer-seed@1 (one pitch),
 * is inserted as a `seed` pitch and checked at once by the session's own checkPitch. Offline: PGlite with the explainers
 * schema (reel_ai_drama and social_hub); the producer, Jev and the visuals check are stubs. No live call of any kind.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import type { Queryable } from '@/lib/explainers/db';
import {
  PRODUCER_SEED_SERVER_TOOLS,
  SEED_MAX_TOKENS,
  producerParams,
  type CreateMessage,
} from '@/lib/reel-ai-drama/development/producer';
import type { DevelopmentDeps } from '@/lib/reel-ai-drama/development/session';
import type { ImageHit, VisualsCheckDeps } from '@/lib/reel-ai-drama/development/visuals-check';
import { refillNightStart } from '@/lib/reel-ai-drama/production/schedule';
import { ensureReelAiDramaSchema } from '@/lib/reel-ai-drama/schema';
import { DEFAULT_SETTINGS, type ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import type { Pitch } from '@/lib/reel-ai-drama/types';
import type { JevTransport } from '@/lib/reels/jev/runner';
import { Ledger, limitText } from '@/lib/seed/one-box/budget';
import { claimRequest, createRequest } from '@/lib/seed/one-box/requests';
import { runClaimedSeed } from '@/lib/seed/one-box/workers';
import { CAP_REACHED_TEXT, dramaSeedWorstCaseUsd, runDramaSeed } from '@/lib/seed/one-box/workers/drama';
import { dramaPollSteps, runPollPass } from '@/lib/reel-ai-drama/worker-poll';
import type { Query } from '@/lib/social/store/pg';

import { scratchExplainersDb } from './explainers-pglite';

const NOW = new Date('2026-11-24T15:00:00Z');
const STORY = 'Jensen Huang flies to Tokyo in 1996 to ask Sega for money he expects to lose';

async function setup(blurb = STORY) {
  const { db } = await scratchExplainersDb();
  await ensureReelAiDramaSchema(db);
  const q: Query = async (text, params) => db.query(text, params as unknown[]) as never;
  await createRequest(q, { vertical: 'reel_ai_drama', blurb, link: 'https://example.com/sega' }, NOW);
  const claimed = await claimRequest(q, 'drama', NOW);
  assert.ok(claimed);
  return { db, q, id: claimed.id, input: claimed.input };
}

function pitch(over: Partial<Pitch> = {}): Pitch {
  return {
    title: 'The founder who bet the company',
    brief: 'A founder with weeks of cash left flies to a partner and asks for money he expects to lose.',
    story_type: 'big_bet',
    era: 'origins',
    event_date: '1996-03-01',
    date_precision: 'month',
    cast: [
      { name: 'Jensen Huang', role: 'founder', kind: 'person', player_id: 'jensen-huang', widely_known: false },
      { name: 'Nvidia', role: 'the company', kind: 'company', player_id: 'nvidia', widely_known: true },
    ],
    why_now: null,
    expected_visuals: [
      { kind: 'person_photo', what: 'the founder', hint: 'Jensen Huang 1996' },
      { kind: 'event_photo', what: 'the meeting', hint: 'Jensen Huang Tokyo meeting' },
      { kind: 'place_photo', what: 'Tokyo', hint: 'Tokyo' },
    ],
    sources: [
      { url: 'https://example.com/story', title: 'The story', publisher: 'Example News', date: null },
      { url: 'https://www.sec.gov/filing.htm', title: 'A filing', publisher: 'SEC', date: null },
    ],
    ...over,
  } as Pitch;
}

function message(content: unknown[], stop: string, usage: Partial<Anthropic.Usage> = {}): Anthropic.Message {
  return {
    id: `msg_${Math.random()}`,
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 2000, output_tokens: 800, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: { web_search_requests: 2 }, ...usage },
  } as unknown as Anthropic.Message;
}

/** A producer stub: optionally one pause_turn first, then one submit_pitches with the candidates. */
function stubProducer(candidates: unknown[], opts: { pause?: Partial<Anthropic.Usage> } = {}) {
  const params: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const create = (async (p: Anthropic.MessageCreateParamsNonStreaming) => {
    params.push(p);
    if (opts.pause && params.length === 1) return message([{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'q' } }], 'pause_turn', opts.pause);
    return message([{ type: 'tool_use', id: 't1', name: 'submit_pitches', input: { candidates } }], 'tool_use');
  }) as CreateMessage;
  return { create, params };
}

/** A Jev transport answering every score question with `score` (0–4), and the nouls so nothing is capped. */
function stubJev(score: number): JevTransport & { calls: number } {
  const t = {
    calls: 0,
    async systemOne(_state: unknown, questions: Record<string, { type: string }>) {
      t.calls += 1;
      const answers: Record<string, unknown> = {};
      for (const key of Object.keys(questions)) {
        const noul = key.startsWith('pair_') ? 0 : key === 'mostly_spectacle' || key === 'announced_plan' ? 0.05 : 0.95;
        answers[key] = questions[key]!.type === 'noul' ? { type: 'noul', noul } : { type: 'score', score, confidence: 1, legend: {}, probabilities: {} };
      }
      return { model: 'jev-stub', answers, usage: { input_tokens: 1000, output_tokens: 5 } } as never;
    },
  };
  return t as never;
}

const hit = (i: number): ImageHit => ({ url: `https://news.example.com/${i}.jpg`, thumbnail: `https://t.example.com/${i}.jpg`, width: 1600, height: 1000, domain: 'news.example.com', title: `Jensen Huang photo ${i}`, page: null });

function visualsDeps(): Omit<VisualsCheckDeps, 'record'> {
  return {
    commonsDepth: async () => 40,
    wikidataQid: async () => 'Q1',
    geocode: async () => ({ lat: 35.68, lon: 139.69 }),
    imageSearch: async () => ({ hits: [hit(1), hit(2), hit(3), hit(4)], usd: 0.001 }),
    look: async ({ hits }) => ({
      tiles: hits.map((_, index) => ({ index, usable: true, watermark: false, ai_art: false, relevant: true, kind: 'event_photo' as const, note: 'a photo' })),
      cost: { vendor: 'anthropic' as const, usd: 0.0005, inputTokens: 3000, outputTokens: 200 },
    }),
    banked: () => null,
    hasLogo: (id) => id === 'nvidia',
  };
}

const devDeps = (db: Queryable, create: CreateMessage, jev: JevTransport): DevelopmentDeps => ({
  db, producer: { create, loadPrompt: () => 'the producer prompt' }, jevTransport: jev, visuals: visualsDeps(), settings: DEFAULT_SETTINGS,
});

async function requestRow(q: Query, id: string) {
  const { rows } = await q(`SELECT status, stage, message, idea_id, cost_usd::float AS cost FROM social_hub.seed_requests WHERE id = $1::uuid`, [id]);
  return rows[0] as { status: string; stage: string; message: string | null; idea_id: string | null; cost: number };
}

async function pitches(db: Queryable) {
  const { rows } = await db.query<{ id: string; origin: string; status: string; reject_reason: string | null; session_id: string | null }>(
    'SELECT id, origin, status, reject_reason, session_id FROM reel_ai_drama.pitches ORDER BY created_at',
  );
  return rows;
}

test('pooled pitch: done with the pitch id', async () => {
  const { db, q, id, input } = await setup();
  const producer = stubProducer([{ ...pitch(), typicality: 0.3 }]);
  const settings: ReelAiDramaSettings = { ...DEFAULT_SETTINGS };
  const ledger = new Ledger('reel_ai_drama');
  await runDramaSeed({ q, id, input, db, deps: devDeps(db, producer.create, stubJev(3.6)), settings, ledger, now: NOW });

  const r = await requestRow(q, id);
  assert.equal(r.status, 'done', r.message ?? '');
  const rows = await pitches(db);
  assert.equal(rows.length, 1);
  assert.equal(r.idea_id, rows[0]!.id);
  assert.equal(rows[0]!.origin, 'seed');
  assert.equal(rows[0]!.status, 'pooled');
  assert.equal(rows[0]!.session_id, null);
  assert.ok(r.cost > 0);
  assert.ok(Math.abs(r.cost - ledger.spent) < 1e-4, 'the card shows what the ledger spent');

  // producer-seed@1: the producer's system and roster blocks byte-identical; the same submit tool; only the user turn differs.
  assert.equal(producer.params.length, 1);
  const sent = producer.params[0]!;
  const nightly = producerParams({ loadPrompt: () => 'the producer prompt', model: settings.producer_model }, []);
  assert.deepEqual(sent.system, nightly.system);
  assert.equal(sent.model, settings.producer_model);
  assert.equal(sent.max_tokens, SEED_MAX_TOKENS);
  const tools = sent.tools as unknown as Array<{ name: string }>;
  assert.deepEqual(tools.slice(0, 2), PRODUCER_SEED_SERVER_TOOLS);
  assert.deepEqual(tools[2], (nightly.tools as unknown as unknown[])[2], 'the same submit_pitches tool');
  const user = String(sent.messages[0]!.content);
  assert.match(user, new RegExp(`Write exactly one pitch about this story: ${STORY}`));
  assert.match(user, /https:\/\/example\.com\/sega/);
  assert.ok(!JSON.stringify(sent.system).includes(STORY), "the person's words stay out of the cached prefix");

  // Seed spend is development spend, so it counts toward the nightly cap.
  const { rows: costs } = await db.query<{ mode: string; component: string; job_id: string | null }>('SELECT mode, component, job_id FROM reel_ai_drama.cost_events');
  assert.ok(costs.some((c) => c.component === 'producer_seed' && c.mode === 'development' && c.job_id === null));
});

test('drama under the bar: failed with the reason', async () => {
  const { db, q, id, input } = await setup();
  const producer = stubProducer([{ ...pitch(), typicality: 0.3 }]);
  await runDramaSeed({ q, id, input, db, deps: devDeps(db, producer.create, stubJev(1)), settings: DEFAULT_SETTINGS, ledger: new Ledger('reel_ai_drama'), now: NOW });
  const r = await requestRow(q, id);
  assert.equal(r.status, 'failed');
  assert.match(r.message ?? '', /drama [\d.]+ under the bar 0\.55/);
  const rows = await pitches(db);
  assert.equal(rows[0]!.status, 'rejected');
  assert.equal(rows[0]!.origin, 'seed');
  assert.ok(r.cost > 0);
});

test('nightly cap reached: failed before the producer call', async () => {
  const { db, q, id, input } = await setup();
  // Tonight's development spend so far: 0.80 of the 1.00 cap, and the producer's worst case is more than what is left.
  await db.query(
    `INSERT INTO reel_ai_drama.cost_events (mode, vendor, component, usd, created_at) VALUES ('development', 'anthropic', 'producer', 0.8, $1)`,
    [new Date(refillNightStart(NOW).getTime() + 60_000).toISOString()],
  );
  assert.ok(dramaSeedWorstCaseUsd({ prefixChars: 1, userChars: 1 }) > 0.2);
  const producer = stubProducer([{ ...pitch(), typicality: 0.3 }]);
  await runDramaSeed({ q, id, input, db, deps: devDeps(db, producer.create, stubJev(3.6)), settings: { ...DEFAULT_SETTINGS, nightly_dev_cap_usd: 1 }, ledger: new Ledger('reel_ai_drama'), now: NOW });
  const r = await requestRow(q, id);
  assert.equal(r.status, 'failed');
  assert.equal(r.message, CAP_REACHED_TEXT);
  assert.equal(r.message, "Tonight's development cap is reached; nothing was spent.");
  assert.equal(r.cost, 0);
  assert.equal(producer.params.length, 0);
  assert.equal((await pitches(db)).length, 0);
});

test('visuals cap passed to checkPitch equals the ledger remaining', async () => {
  for (const settingCap of [0.6, 0.05]) {
    const { db, q, id, input } = await setup();
    const producer = stubProducer([{ ...pitch(), typicality: 0.3 }]);
    const ledger = new Ledger('reel_ai_drama');
    let seen: { cap: number; remaining: number; sessionId: unknown } | null = null;
    await runDramaSeed({
      q, id, input, db, deps: devDeps(db, producer.create, stubJev(3.6)), settings: { ...DEFAULT_SETTINGS, visuals_check_cap_usd: settingCap }, ledger, now: NOW,
      check: async (ctx) => {
        seen = { cap: ctx.settings.visuals_check_cap_usd, remaining: ledger.remaining(), sessionId: ctx.sessionId };
        return 'pooled';
      },
    });
    assert.ok(seen);
    const s = seen as { cap: number; remaining: number; sessionId: unknown };
    assert.equal(s.sessionId, null);
    assert.ok(ledger.spent > 0);
    assert.equal(s.cap, Math.min(settingCap, s.remaining));
    if (settingCap === 0.6) assert.equal(s.cap, s.remaining, 'the ledger remaining when it is the smaller');
    else assert.equal(s.cap, 0.05, 'the setting when it is the smaller');
    assert.equal((await requestRow(q, id)).status, 'done');
  }
});

test('a continuation that might pass the limit is not made: failed with the limit text and the spend so far', async () => {
  const { db, q, id, input } = await setup();
  // The first turn pauses after spending about 0.25 (120k input tokens); one more turn's worst case would pass 0.50.
  const producer = stubProducer([{ ...pitch(), typicality: 0.3 }], { pause: { input_tokens: 120_000, output_tokens: 500 } });
  const ledger = new Ledger('reel_ai_drama');
  await runDramaSeed({ q, id, input, db, deps: devDeps(db, producer.create, stubJev(3.6)), settings: DEFAULT_SETTINGS, ledger, now: NOW });
  const r = await requestRow(q, id);
  assert.equal(r.status, 'failed');
  assert.equal(r.message, limitText('reel_ai_drama'));
  assert.equal(producer.params.length, 1);
  assert.ok(r.cost > 0.2 && Math.abs(r.cost - ledger.spent) < 1e-4);
  assert.equal((await pitches(db)).length, 0);
});

test('the seeds step runs while the night step would also run, and neither blocks the other\'s loop iteration', async () => {
  const { db } = await scratchExplainersDb();
  await ensureReelAiDramaSchema(db);
  const q: Query = async (text, params) => db.query(text, params as unknown[]) as never;
  const order: string[] = [];
  const failed: string[] = [];
  const seeded: string[] = [];
  const seedStep = (throwing: boolean) => async () => {
    order.push('seeds');
    const done = await runClaimedSeed({
      q, runner: 'drama',
      deps: { drama: async () => ({ db, settings: DEFAULT_SETTINGS, deps: {} as DevelopmentDeps }) },
      run: { drama: async (i) => { seeded.push(i.input.blurb); if (throwing) throw new Error('boom'); } },
    });
    if (throwing) throw new Error(`seed step failed after ${done?.id}`);
  };
  const pass = (h: { seedsThrow?: boolean; nightThrows?: boolean }) =>
    runPollPass(
      dramaPollSteps({
        requests: async () => void order.push('requests'),
        seeds: seedStep(!!h.seedsThrow),
        tendPool: async () => void order.push('tend_pool'),
        night: async () => { order.push('night'); if (h.nightThrows) throw new Error('night broke'); },
        refill: async () => void order.push('refill'),
        publish: async () => void order.push('publish'),
        insights: async () => void order.push('insights'),
      }),
      (name) => failed.push(name),
    );

  // A queued seed and the night due: one pass runs both, the seed first.
  await createRequest(q, { vertical: 'reel_ai_drama', blurb: 'first story' });
  await pass({});
  assert.deepEqual(order, ['requests', 'seeds', 'tend_pool', 'night', 'refill', 'publish', 'insights']);
  assert.deepEqual(seeded, ['first story']);

  // A seed step that throws does not stop the night; a night that throws does not stop the next pass's seed.
  order.length = 0;
  await createRequest(q, { vertical: 'reel_ai_drama', blurb: 'second story' });
  await pass({ seedsThrow: true, nightThrows: true });
  assert.deepEqual(order, ['requests', 'seeds', 'tend_pool', 'night', 'refill', 'publish', 'insights']);
  assert.deepEqual(failed, ['seeds', 'night']);
  order.length = 0;
  await createRequest(q, { vertical: 'reel_ai_drama', blurb: 'third story' });
  await pass({ nightThrows: true });
  assert.deepEqual(seeded, ['first story', 'second story', 'third story']);
  assert.ok(order.includes('night') && order.includes('seeds'));
});
