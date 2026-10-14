/**
 * Shared queue, Trial Reels (the 1 AM run), offline: slot order with a
 * promoted and a demoted idea (pure fillSlots with a stub attempt), and the
 * nightly generation on PGlite: an older promoted idea joins tonight's slate
 * from its stored scores (no re-scoring, no model call) and is made first; a
 * gone or person-placed one is skipped with why; no moves table, no change.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { fillSlots, orderedForSlots, type GradedLine, type SlotAttempt, type SlotIdea } from '@/lib/reels/copy/slots';
import type { CopyClient } from '@/lib/reels/copy/writer';
import { REEL_SKIP } from '@/lib/reels/pipeline/promote';
import { generatePassingReels } from '@/lib/reels/pipeline/slots';
import type { BucketId, FrameworkId } from '@/lib/reels/scoring/decide';

import { openHubTestDb } from './fixtures/social-hub/pglite';

// ── Slot order (pure) ───────────────────────────────────────────────────────

const idea = (id: string, net: number, framework: FrameworkId, bucket: BucketId): SlotIdea =>
  ({ id, net, bucketScore: 1, psychologyScore: 1, lastJoinedMs: 0, confidence: 1, framework, bucket });
const line = (ideaId: string, level: number): GradedLine =>
  ({ ideaId, lineIndex: 0, plain: level, stake: level, loop: 2, care: 2, reward: 2, sameStory: 0.9, inRange: true });
const pass = (id: string): SlotAttempt => ({ passed: true, judged: true, lines: [line(id, 4)] });
const miss = (id: string): SlotAttempt => ({ passed: false, judged: true, lines: [line(id, 1)] });

function recorder(result: (id: string) => SlotAttempt) {
  const tried: Array<[string, boolean]> = [];
  return { tried, attempt: async (row: SlotIdea, rewrite: boolean) => { tried.push([row.id, rewrite]); return result(row.id); } };
}

test('Q4: a promoted idea outside the knowledge lane takes slot 1 first', async () => {
  const ideas = [idea('know', 5, 'identity', 'ball_knowledge'), idea('saga', 4, 'arousal', 'the_saga'), idea('low', 1, 'arousal', 'the_warning')];
  const r = recorder(pass);
  const filled = await fillSlots({ ideas, locks: [], count: 2, penalties: new Map(), attempt: r.attempt, onPenalty: () => undefined, onFallback: () => undefined, moves: { promote: 'low', demoted: new Set() } });
  assert.deepEqual(filled.map((s) => [s.slot, s.postIdeaId]), [[1, 'low'], [2, 'saga']]);
  assert.deepEqual(r.tried, [['low', true], ['saga', true]]);
});

test('a promoted non-lane idea that misses slot 1 falls through like a general idea (penalized); the lane idea opens fresh', async () => {
  const ideas = [idea('know', 5, 'identity', 'ball_knowledge'), idea('low', 1, 'arousal', 'the_warning')];
  const r = recorder((id) => (id === 'low' ? miss(id) : pass(id)));
  const penalties = new Map<string, number>();
  const shipped: string[] = [];
  const filled = await fillSlots({ ideas, locks: [], count: 1, penalties, attempt: r.attempt, onPenalty: () => undefined, onFallback: (row) => { shipped.push(row.id); }, moves: { promote: 'low', demoted: new Set() } });
  assert.deepEqual(filled.map((s) => [s.slot, s.postIdeaId, s.passed]), [[1, 'know', true]]);
  assert.deepEqual(r.tried, [['low', true], ['know', true]]);
  assert.ok(penalties.has('low'), 'penalized like a general miss');
  assert.deepEqual(shipped, [], 'its miss never ships on its best line');
});

test('a demoted idea is tried last; with a lock on the lane slot a promoted lane idea leads the general pool', async () => {
  const flat = [idea('a', 5, 'arousal', 'the_saga'), idea('b', 4, 'arousal', 'the_saga'), idea('c', 3, 'arousal', 'the_saga')];
  assert.deepEqual(orderedForSlots(flat, () => 0, { promote: null, demoted: new Set(['a']) }).map((i) => i.id), ['b', 'c', 'a']);
  const r1 = recorder(pass);
  const one = await fillSlots({ ideas: flat, locks: [], count: 1, penalties: new Map(), attempt: r1.attempt, onPenalty: () => undefined, onFallback: () => undefined, moves: { promote: null, demoted: new Set(['a']) } });
  assert.deepEqual(one.map((s) => s.postIdeaId), ['b']);

  const ideas = [idea('locked', 5, 'identity', 'ball_knowledge'), idea('saga', 4, 'arousal', 'the_saga'), idea('know2', 2, 'identity', 'ball_knowledge')];
  const r2 = recorder(pass);
  const filled = await fillSlots({ ideas, locks: [{ slot: 1, postIdeaId: 'locked' }], count: 2, penalties: new Map(), attempt: r2.attempt, onPenalty: () => undefined, onFallback: () => undefined, moves: { promote: 'know2', demoted: new Set() } });
  assert.deepEqual(filled.map((s) => [s.slot, s.postIdeaId]), [[1, 'locked'], [2, 'know2']]);
});

// ── The nightly generation (PGlite) ─────────────────────────────────────────

const R = {
  RUN: 'a0000000-0000-4000-8000-000000000001',
  RUN2: 'a0000000-0000-4000-8000-000000000002',
  YESTERDAY: 'a0000000-0000-4000-8000-000000000003',
  TODAY: 'a0000000-0000-4000-8000-000000000004',
  OLD: 'a0000000-0000-4000-8000-000000000011',
  CARRY: 'a0000000-0000-4000-8000-000000000012',
  GONE: 'a0000000-0000-4000-8000-000000000013',
  VIDEO_OLD: 'a0000000-0000-4000-8000-000000000021',
  VIDEO_CARRY: 'a0000000-0000-4000-8000-000000000022',
};

/** Trial Reels read lib/db.ts's shared pool: point it at PGlite (as tests/social-fill.test.ts does). */
async function reelsDb(): Promise<PGlite> {
  const { pg } = await openHubTestDb();
  (globalThis as { __outreachHubPool?: unknown }).__outreachHubPool = { query: (text: string, params?: unknown[]) => pg.query(text, params as unknown[]) };
  return pg;
}

/**
 * Yesterday's slate scored OLD (a saga idea, not on today's slate) and CARRY;
 * both have a finished, unposted video. Today's slate carries CARRY over
 * (knowledge lane), so without moves the one reel tonight reuses CARRY's video.
 */
async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO reels.runs (id, trigger, status) VALUES ('${R.RUN}', 'scheduled', 'ok'), ('${R.RUN2}', 'scheduled', 'ok');
    INSERT INTO reels.post_ideas (id) VALUES ('${R.OLD}'), ('${R.CARRY}'), ('${R.GONE}');
    INSERT INTO reels.score_slates (id, run_id, ny_date, scored_at, pass1_version, pass2_version) VALUES
      ('${R.YESTERDAY}', '${R.RUN2}', '2026-10-07', '2026-10-07T05:30:00Z', 'p1', 'p2'),
      ('${R.TODAY}', '${R.RUN}', '2026-10-08', '2026-10-08T05:30:00Z', 'p1', 'p2');
    INSERT INTO reels.idea_scores (slate_id, post_idea_id, origin, net, rank, selected, chosen_bucket, chosen_framework, psychology, bucket_score, confidence, components) VALUES
      ('${R.YESTERDAY}', '${R.OLD}', 'timely', 1.1, 2, true, 'the_saga', 'arousal', 0.6, 0.6, 0.8, '{"stored":"yesterday"}'::jsonb),
      ('${R.YESTERDAY}', '${R.CARRY}', 'timely', 2.4, 1, true, 'ball_knowledge', 'identity', 0.8, 0.8, 0.9, '{}'::jsonb),
      ('${R.TODAY}', '${R.CARRY}', 'carryover', 2.4, 1, false, 'ball_knowledge', 'identity', 0.8, 0.8, 0.9, '{}'::jsonb);
    INSERT INTO reels.idea_copy (slate_id, post_idea_id, prompt_version, model, bucket, framework, status, caption, call_to_action, hashtags) VALUES
      ('${R.YESTERDAY}', '${R.OLD}', 'v1', 'm', 'the_saga', 'arousal', 'ok', 'Old caption.', 'Follow.', ARRAY['#ai']),
      ('${R.YESTERDAY}', '${R.CARRY}', 'v1', 'm', 'ball_knowledge', 'identity', 'ok', 'Carry caption.', 'Follow.', ARRAY['#ai']);
    INSERT INTO reels.video_jobs (id, post_idea_id, slate_id, status, finished_at, video_storage_path) VALUES
      ('${R.VIDEO_OLD}', '${R.OLD}', '${R.YESTERDAY}', 'ok', '2026-10-07T07:00:00Z', 'videos/old.mp4'),
      ('${R.VIDEO_CARRY}', '${R.CARRY}', '${R.YESTERDAY}', 'ok', '2026-10-07T07:10:00Z', 'videos/carry.mp4');
    INSERT INTO reels.song_picks (video_job_id, post_idea_id, status, finished_at, picked_audio_id, picked_title, picked_artist) VALUES
      ('${R.VIDEO_OLD}', '${R.OLD}', 'ok', '2026-10-07T07:05:00Z', 'aud-1', 'Song', 'Artist'),
      ('${R.VIDEO_CARRY}', '${R.CARRY}', 'ok', '2026-10-07T07:15:00Z', 'aud-2', 'Song', 'Artist');`);
}

const promote = (pg: PGlite, postIdeaId: string) =>
  pg.query(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind, created_at) VALUES ('reels', $1, '2026-10-07', 'promote', '2026-10-07T20:00:00Z')`, [`reels:idea:${postIdeaId}`]);
const moveRow = async (pg: PGlite, postIdeaId: string) =>
  (await pg.query<{ used: boolean; skip_reason: string | null }>(`SELECT consumed_at IS NOT NULL AS used, skip_reason FROM social_hub.idea_adjustments WHERE idea_id = $1`, [`reels:idea:${postIdeaId}`])).rows[0]!;
const onToday = async (pg: PGlite, postIdeaId: string) =>
  (await pg.query<{ origin: string; net: number; components: unknown }>(`SELECT origin, net, components FROM reels.idea_scores WHERE slate_id = $1 AND post_idea_id = $2`, [R.TODAY, postIdeaId])).rows[0] ?? null;

function noCopyClient(): CopyClient & { calls: number } {
  const client = { calls: 0, messages: { create: async () => { client.calls += 1; throw new Error('no live call in tests'); } } };
  return client as unknown as CopyClient & { calls: number };
}

test('Review Focus 4: an older promoted idea joins tonight’s slate from its stored scores, no model call, and is made first; the promote is used', async () => {
  const pg = await reelsDb();
  await seed(pg);
  await promote(pg, R.OLD);
  const client = noCopyClient();
  const out = await generatePassingReels({ runId: R.RUN, slateId: R.TODAY, count: 1, client, dailyFill: true });
  assert.deepEqual(out.filled.map((s) => [s.postIdeaId, s.reused === true]), [[R.OLD, true]], 'its finished video takes the one reel');
  assert.equal(client.calls, 0, 'no copy written, no model call');
  const copied = await onToday(pg, R.OLD);
  assert.deepEqual([copied?.origin, Number(copied?.net), copied?.components], ['carryover', 1.1, { stored: 'yesterday' }], 'a copy of the stored row, not a new score');
  assert.deepEqual(await moveRow(pg, R.OLD), { used: true, skip_reason: null });
});

test('Review Focus 4: a promoted idea with no stored score is skipped with why; the night is unchanged', async () => {
  const pg = await reelsDb();
  await seed(pg);
  await promote(pg, R.GONE);
  const out = await generatePassingReels({ runId: R.RUN, slateId: R.TODAY, count: 1, client: noCopyClient(), dailyFill: true });
  assert.deepEqual(out.filled.map((s) => s.postIdeaId), [R.CARRY]);
  assert.equal(await onToday(pg, R.GONE), null);
  assert.deepEqual(await moveRow(pg, R.GONE), { used: false, skip_reason: REEL_SKIP.gone });
});

test('a promoted idea a person already placed is skipped with why, not made twice', async () => {
  const pg = await reelsDb();
  await seed(pg);
  await promote(pg, R.OLD);
  await pg.query(
    `INSERT INTO social_hub.schedule (vertical, idea_ref, ny_date, slot, publish_at, status, source) VALUES ('reels', $1, '2026-10-08', 'midday', '2026-10-08T16:30:00Z', 'scheduled', 'user')`,
    [R.OLD],
  );
  const out = await generatePassingReels({ runId: R.RUN, slateId: R.TODAY, count: 1, client: noCopyClient(), dailyFill: true });
  assert.deepEqual(out.filled.map((s) => s.postIdeaId), [R.CARRY]);
  assert.deepEqual(await moveRow(pg, R.OLD), { used: false, skip_reason: REEL_SKIP.placed });
});

test('Review Focus 3: no moves table: the night runs as before; a hand-run generation never reads moves', async () => {
  const pg = await reelsDb();
  await seed(pg);
  await promote(pg, R.OLD);
  const hand = await generatePassingReels({ runId: R.RUN, slateId: R.TODAY, count: 1, client: noCopyClient() });
  assert.equal(await onToday(pg, R.OLD), null, 'hand-run: nothing copied onto the slate');
  assert.equal(hand.filled.some((s) => s.postIdeaId === R.OLD), false);
  assert.equal((await moveRow(pg, R.OLD)).used, false);

  await pg.exec(`DROP TABLE social_hub.idea_adjustments`);
  const out = await generatePassingReels({ runId: R.RUN, slateId: R.TODAY, count: 1, client: noCopyClient(), dailyFill: true });
  assert.deepEqual(out.filled.map((s) => [s.postIdeaId, s.reused === true]), [[R.CARRY, true]]);
});
