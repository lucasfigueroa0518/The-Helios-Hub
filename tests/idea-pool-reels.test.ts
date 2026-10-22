/**
 * The idea pool standard on Trial Reels' 1 AM run (spec 2026-10-21): slot order with several pins, a dragged idea and
 * an archived one (pure fillSlots with a stub attempt), and the nightly generation on PGlite: every pin that can be
 * made is made and used, an archived idea is never made, a placement steers tonight and then expires, and a
 * hand-run generation touches none of it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { fillSlots, orderedForSlots, type GradedLine, type SlotAttempt, type SlotIdea } from '@/lib/reels/copy/slots';
import type { CopyClient } from '@/lib/reels/copy/writer';
import { generatePassingReels } from '@/lib/reels/pipeline/slots';
import type { BucketId, FrameworkId } from '@/lib/reels/scoring/decide';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const idea = (id: string, net: number, framework: FrameworkId, bucket: BucketId): SlotIdea =>
  ({ id, net, bucketScore: 1, psychologyScore: 1, lastJoinedMs: 0, confidence: 1, framework, bucket });
const line = (ideaId: string, level: number): GradedLine =>
  ({ ideaId, lineIndex: 0, plain: level, stake: level, loop: 2, care: 2, reward: 2, sameStory: 0.9, inRange: true });
const pass = (id: string): SlotAttempt => ({ passed: true, judged: true, lines: [line(id, 4)] });
const miss = (id: string): SlotAttempt => ({ passed: false, judged: true, lines: [line(id, 1)] });
function recorder(result: (id: string) => SlotAttempt) {
  const tried: string[] = [];
  return { tried, attempt: async (row: SlotIdea) => { tried.push(row.id); return result(row.id); } };
}
const base = () => [idea('know', 5, 'identity', 'ball_knowledge'), idea('saga', 4, 'arousal', 'the_saga'), idea('low', 1, 'arousal', 'the_warning')];
const run = (ideas: SlotIdea[], moves: Parameters<typeof fillSlots>[0]['moves'], count: number, result: (id: string) => SlotAttempt = pass) => {
  const r = recorder(result);
  return fillSlots({ ideas, locks: [], count, penalties: new Map(), attempt: r.attempt, onPenalty: () => undefined, onFallback: () => undefined, moves }).then((filled) => ({ filled, tried: r.tried }));
};
const none = { promote: null, demoted: new Set<string>() };

test('several pins lead in the order pinned, across slots and lanes', async () => {
  const { filled } = await run(base(), { ...none, promote: 'saga', pins: ['saga', 'low'] }, 3);
  assert.deepEqual(filled.map((s) => [s.slot, s.postIdeaId]), [[1, 'saga'], [2, 'low'], [3, 'know']]);
});

test('a pin that misses is tried once and sinks; the next pin still leads', async () => {
  const ideas = [...base(), idea('gen2', 3, 'arousal', 'the_saga')];
  const { filled, tried } = await run(ideas, { ...none, promote: 'low', pins: ['low', 'saga'] }, 2, (id) => (id === 'low' ? miss(id) : pass(id)));
  assert.deepEqual(filled.map((s) => s.postIdeaId), ['saga', 'gen2']);
  assert.deepEqual(tried, ['low', 'saga', 'gen2'], 'one attempt on the pin that missed, then the next pin, then the best general idea');
});

test('a dragged idea sorts by its key; an archived idea is never in the order; a demote means nothing on the queue', () => {
  const ideas = base();
  const order = (moves: Parameters<typeof orderedForSlots>[2]) => orderedForSlots(ideas, () => 0, moves).map((i) => i.id);
  assert.deepEqual(order({ ...none, pins: [], placed: new Map([['low', 4.5]]), archived: new Set() }), ['know', 'low', 'saga']);
  assert.deepEqual(order({ ...none, pins: [], placed: new Map(), archived: new Set(['know']) }), ['saga', 'low']);
  assert.deepEqual(order({ promote: null, demoted: new Set(['know']), pins: [], placed: new Map(), archived: new Set() }), ['know', 'saga', 'low']);
});

// ── The nightly generation (PGlite) ─────────────────────────────────────────

const R = {
  RUN: 'a0000000-0000-4000-8000-000000000001', RUN2: 'a0000000-0000-4000-8000-000000000002',
  YESTERDAY: 'a0000000-0000-4000-8000-000000000003', TODAY: 'a0000000-0000-4000-8000-000000000004',
  OLD: 'a0000000-0000-4000-8000-000000000011', CARRY: 'a0000000-0000-4000-8000-000000000012',
  VIDEO_OLD: 'a0000000-0000-4000-8000-000000000021', VIDEO_CARRY: 'a0000000-0000-4000-8000-000000000022',
};

async function reelsDb(): Promise<PGlite> {
  const { pg } = await openHubTestDb();
  (globalThis as { __outreachHubPool?: unknown }).__outreachHubPool = { query: (text: string, params?: unknown[]) => pg.query(text, params as unknown[]) };
  return pg;
}

async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO reels.runs (id, trigger, status) VALUES ('${R.RUN}', 'scheduled', 'ok'), ('${R.RUN2}', 'scheduled', 'ok');
    INSERT INTO reels.post_ideas (id) VALUES ('${R.OLD}'), ('${R.CARRY}');
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

const noCopyClient = () => ({ messages: { create: async () => { throw new Error('no live call in tests'); } } }) as unknown as CopyClient;
const row = (pg: PGlite, kind: string, postIdeaId: string, at: string, key: number | null = null) =>
  pg.query(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind, sort_key, created_at) VALUES ('reels', $1, '2026-10-07', $2, $3, $4)`, [`reels:idea:${postIdeaId}`, kind, key, at]);
const used = async (pg: PGlite, postIdeaId: string) =>
  (await pg.query<{ used: boolean }>(`SELECT consumed_at IS NOT NULL AS used FROM social_hub.idea_adjustments WHERE idea_id = $1`, [`reels:idea:${postIdeaId}`])).rows.map((r) => r.used);

test('two pins: both are made (their finished videos reused) and both used up', async () => {
  const pg = await reelsDb();
  await seed(pg);
  await row(pg, 'pin', R.OLD, '2026-10-07T19:00:00Z');
  await row(pg, 'pin', R.CARRY, '2026-10-07T20:00:00Z');
  const out = await generatePassingReels({ runId: R.RUN, slateId: R.TODAY, count: 2, client: noCopyClient(), dailyFill: true });
  assert.deepEqual(out.filled.map((s) => s.postIdeaId), [R.OLD, R.CARRY], 'in the order pinned');
  assert.deepEqual([await used(pg, R.OLD), await used(pg, R.CARRY)], [[true], [true]]);
});

test('an archived idea is never made, even when it is on the slate and has a finished video', async () => {
  const pg = await reelsDb();
  await seed(pg);
  await row(pg, 'archive', R.CARRY, '2026-10-07T19:00:00Z');
  const out = await generatePassingReels({ runId: R.RUN, slateId: R.TODAY, count: 1, client: noCopyClient(), dailyFill: true });
  assert.ok(!out.filled.some((s) => s.postIdeaId === R.CARRY));
  assert.deepEqual(await used(pg, R.CARRY), [false], 'an archive row is never used up');
});

test('a placement is used up after the night ran; a hand-run generation leaves it; a pin that was not reached stays', async () => {
  const pg = await reelsDb();
  await seed(pg);
  await row(pg, 'place', R.CARRY, '2026-10-07T19:00:00Z', 9);
  await generatePassingReels({ runId: R.RUN, slateId: R.TODAY, count: 1, client: noCopyClient() });
  assert.deepEqual(await used(pg, R.CARRY), [false], 'hand-run: not the night');
  await generatePassingReels({ runId: R.RUN, slateId: R.TODAY, count: 1, client: noCopyClient(), dailyFill: true });
  assert.deepEqual(await used(pg, R.CARRY), [true]);
});
