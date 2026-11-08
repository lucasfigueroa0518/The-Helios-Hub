/**
 * AI Drama Reels rows → HubPost / HubIdea (lib/social-hub/adapters/reel-ai-drama.ts): statuses, refs,
 * media, approval and idea states. Pure; canned rows only.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { DramaJobRow, DramaPitchRow } from '@/lib/reel-ai-drama/hub';
import { dramaIdeas, dramaPitchHubId, dramaPosts } from '@/lib/social-hub/adapters/reel-ai-drama';
import { EMPTY_DRAMA_READ, type ReelAiDramaRead } from '@/lib/social-hub/queries/reel-ai-drama';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const J1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const J2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const S1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const A1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function job(over: Partial<DramaJobRow> = {}): DramaJobRow {
  return {
    job_id: J1, pitch_id: P1, status: 'ok', trigger: 'auto', mode: 'production', stage: 'done',
    spend_usd: '3.2', spend_cap_usd: '8', requested_at: '2026-11-08T05:00:00Z', started_at: '2026-11-08T05:01:00Z', finished_at: '2026-11-08T06:00:00Z',
    error: null, kill_reason: null, flags: 0,
    title: 'The night the servers went dark', brief: 'A launch gone wrong.', story_type: 'downfall', era: 'modern', central_player_id: null,
    rank_score: '0.81', drama_score: '0.9', material_score: '0.7', visuals_grade: 'green',
    sources: [{ url: 'https://example.com/a', title: 'Source' }],
    verdict: null, tags: null, note: null, feedback_at: null,
    video_artifact_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', video_location: 'local', sheet_artifact_id: null,
    caption: 'cap', seconds: 72,
    ...over,
  };
}

const read = (over: Partial<ReelAiDramaRead>): ReelAiDramaRead => ({ ...EMPTY_DRAMA_READ, ...over });

test('a finished, unreviewed job is ready content with its video, lab link and refs', () => {
  const [post, ...rest] = dramaPosts(read({ jobs: [job()] }));
  assert.equal(rest.length, 0);
  assert.equal(post!.vertical, 'reel_ai_drama');
  assert.equal(post!.status, 'ready');
  assert.equal(post!.statusNote, 'Waiting for review');
  assert.deepEqual(post!.media, { kind: 'video', src: '/api/reel-ai-drama/artifacts/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' });
  assert.equal(post!.pipelineHref, `/reel-ai-drama/lab?job=${J1}`);
  assert.equal(post!.refs.jobId, J1);
  assert.equal(post!.refs.pitchId, P1);
  assert.equal(post!.approval.required, true);
  assert.equal(post!.factorValues.seconds?.kind, 'number');
});

test('a rejected job never shows as ready; a failed job without video is not content', () => {
  assert.equal(dramaPosts(read({ jobs: [job({ verdict: 'rejected', tags: ['hook'] })] })).length, 0);
  assert.equal(dramaPosts(read({ jobs: [job({ status: 'failed', video_artifact_id: null })] })).length, 0);
});

test('a booked slot becomes a scheduled post with the schedule ref; a published attempt carries its permalink', () => {
  const approved = job({ verdict: 'approved', feedback_at: '2026-11-08T07:00:00Z' });
  const scheduled = dramaPosts(read({
    jobs: [approved],
    schedules: [{ schedule_id: S1, job_id: J1, ny_date: '2026-11-08', slot: 'evening', publish_at: '2026-11-09T01:10:00Z', status: 'scheduled', source: 'auto', error: null }],
  }));
  const s = scheduled.find((p) => p.status === 'scheduled');
  assert.ok(s, 'a scheduled post');
  assert.equal(s!.refs.scheduleId, S1);
  assert.equal(s!.nyDate, '2026-11-08');
  assert.ok(s!.approval.approvedAt);

  const published = dramaPosts(read({
    jobs: [approved],
    attempts: [{ attempt_id: A1, job_id: J1, status: 'published', trigger: 'auto', requested_at: '2026-11-09T01:10:00Z', finished_at: '2026-11-09T01:12:00Z', media_id: 'm1', permalink: 'https://instagram.com/p/x', error: null, caption: 'cap', schedule_id: S1, slot: 'evening', publish_at: '2026-11-09T01:10:00Z' }],
  }));
  const p = published.find((x) => x.status === 'published');
  assert.ok(p, 'a published post');
  assert.equal(p!.permalink, 'https://instagram.com/p/x');
  assert.equal(p!.refs.attemptId, A1);
  assert.equal(p!.refs.jobId, J1);
});

test('only the newest finished reel per pitch is ready content', () => {
  const older = job({ job_id: J2, finished_at: '2026-11-07T06:00:00Z' });
  const posts = dramaPosts(read({ jobs: [older, job()] }));
  const ready = posts.filter((p) => p.status === 'ready');
  assert.equal(ready.length, 1);
  assert.equal(ready[0]!.refs.jobId, J1);
  assert.equal(ready[0]!.versions?.length, 2);
});

test('pitches become ideas with the pitch id, state and run', () => {
  const base: DramaPitchRow = {
    pitch_id: P1, title: 'Pitch', brief: null, status: 'open', origin: 'producer', rank_score: '0.5', drama_score: '0.6', material_score: null, visuals_grade: 'amber',
    event_date: null, central_player_id: null, created_at: '2026-11-01T00:00:00Z', ok_jobs: 0, last_made_at: null, published: false, scheduled: false,
    job_id: null, job_status: null, job_stage: null, job_error: null, job_requested_at: null, job_started_at: null, reject_reason: null, revive_when: null,
  };
  const [idle, running, ready, onDeck] = dramaIdeas([
    base,
    { ...base, pitch_id: P2, job_id: J1, job_status: 'running', job_stage: 'director', job_requested_at: '2026-11-08T05:00:00Z' },
    { ...base, ok_jobs: 1, origin: 'seed' },
    { ...base, ok_jobs: 1, scheduled: true },
  ]);
  assert.equal(idle!.id, dramaPitchHubId(P1));
  assert.equal(idle!.id, `reel_ai_drama:pitch:${P1}`);
  assert.equal(idle!.state, 'idea_only');
  assert.equal(idle!.run, null);
  assert.equal(running!.run?.state, 'running');
  assert.equal(ready!.state, 'content_ready');
  assert.equal(ready!.yours, true);
  assert.equal(onDeck!.state, 'on_deck');
  assert.ok(idle!.breakdown);
});
