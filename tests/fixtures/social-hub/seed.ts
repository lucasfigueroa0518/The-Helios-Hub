/**
 * Tiny SQL fixture for the Social Hub read tests. Inserted into an
 * in-memory PGlite only (tests/fixtures/social-hub/pglite.ts); hub code
 * never writes. One article (example.com/a) is reused by every vertical so
 * the Sources dedupe has something to dedupe.
 */
import type { PGlite } from '@electric-sql/pglite';

export const IDS = {
  reelRun: '10000000-0000-4000-8000-000000000001',
  reelSrc1: '10000000-0000-4000-8000-000000000011',
  reelSrc2: '10000000-0000-4000-8000-000000000012',
  reelSrc3: '10000000-0000-4000-8000-000000000013',
  idea1: '10000000-0000-4000-8000-000000000021',
  idea2: '10000000-0000-4000-8000-000000000022',
  idea3: '10000000-0000-4000-8000-000000000023',
  slate: '10000000-0000-4000-8000-000000000031',
  video1: '10000000-0000-4000-8000-000000000041',
  reelAttempt: '10000000-0000-4000-8000-000000000051',
  reelSched1: '10000000-0000-4000-8000-000000000061',
  reelSched2: '10000000-0000-4000-8000-000000000062',
  reelSched3: '10000000-0000-4000-8000-000000000063',
  topic1: '20000000-0000-4000-8000-000000000001',
  topic2: '20000000-0000-4000-8000-000000000002',
  cycle: '20000000-0000-4000-8000-000000000003',
  job1: '20000000-0000-4000-8000-000000000011',
  job2: '20000000-0000-4000-8000-000000000012',
  art1: '20000000-0000-4000-8000-000000000021',
  art2: '20000000-0000-4000-8000-000000000022',
  expAttempt: '20000000-0000-4000-8000-000000000031',
  expSched: '20000000-0000-4000-8000-000000000041',
  socRun: '30000000-0000-4000-8000-000000000001',
  socPost1: '30000000-0000-4000-8000-000000000011',
  socPost2: '30000000-0000-4000-8000-000000000012',
  socSched: '30000000-0000-4000-8000-000000000021',
  socAttempt: '30000000-0000-4000-8000-000000000031',
  socItem1: '30000000-0000-4000-8000-000000000041',
  set1: '40000000-0000-4000-8000-000000000001',
  set2: '40000000-0000-4000-8000-000000000002',
  frame1: '40000000-0000-4000-8000-000000000011',
  frame2: '40000000-0000-4000-8000-000000000012',
  frame3: '40000000-0000-4000-8000-000000000013',
  cand1: '40000000-0000-4000-8000-000000000021',
  reelRunEmpty: '10000000-0000-4000-8000-000000000002',
  socRunEmpty: '30000000-0000-4000-8000-000000000002',
  socRunRerun: '30000000-0000-4000-8000-000000000003',
  socRunPreview: '30000000-0000-4000-8000-000000000004',
  video2: '10000000-0000-4000-8000-000000000042',
  reelAttemptFailed: '10000000-0000-4000-8000-000000000052',
} as const;

/** Every ledger dollar the cost seed adds, for the reconciliation test. */
export const SEEDED_LEDGER_MICROS = {
  // cost_events 0.5 + 0.2 + 0.3333 + 0.0001 + 0.7 (empty night) + 0.05 (no run) + Kling clip (priced by klingClipUsdSql)
  reelsEvents: 1_783_400,
  explainers: 3_200_000 + 2_900_000 + 330_000,
  // run 1, empty run, a later rerun touching story-1, a preview run touching story-2
  carousels: 1_300_000 + 400_000 + 300_000 + 200_000,
  stories: 120_000 + 50_000 + 90_000 + 10_000,
} as const;

const I = IDS;

export async function seedHubFixture(pg: PGlite): Promise<void> {
  await pg.exec(`
-- ── Trial Reels ─────────────────────────────────────────────────────────────
INSERT INTO reels.runs (id, trigger, status, requested_at, started_at, finished_at)
VALUES ('${I.reelRun}', 'scheduled', 'ok', '2026-10-06T05:00:00Z', '2026-10-06T05:00:00Z', '2026-10-06T06:00:00Z');
INSERT INTO reels.sources (id, run_id, canonical_url, headline, source_name, source_type, adapter_id, bucket) VALUES
 ('${I.reelSrc1}', '${I.reelRun}', 'https://example.com/a?utm_source=x', 'OpenAI ships a new model', 'Example', 'rss', 'a1', 'A'),
 ('${I.reelSrc2}', '${I.reelRun}', 'https://example.com/b', 'Chip export rules tighten', 'Example', 'rss', 'a1', 'A'),
 ('${I.reelSrc3}', '${I.reelRun}', 'https://example.com/c', 'A startup folds', 'Example', 'rss', 'a1', 'B');
INSERT INTO reels.post_ideas (id) VALUES ('${I.idea1}'), ('${I.idea2}'), ('${I.idea3}');
INSERT INTO reels.post_idea_members (source_id, post_idea_id, role) VALUES
 ('${I.reelSrc1}', '${I.idea1}', 'primary'), ('${I.reelSrc2}', '${I.idea2}', 'primary'), ('${I.reelSrc3}', '${I.idea3}', 'primary');
INSERT INTO reels.published_status (post_idea_id, published, published_at) VALUES ('${I.idea1}', true, '2026-10-06T13:30:00Z');
INSERT INTO reels.score_slates (id, run_id, ny_date, scored_at, pass1_version, pass2_version)
VALUES ('${I.slate}', '${I.reelRun}', '2026-10-06', '2026-10-06T05:30:00Z', 'p1', 'p2');
INSERT INTO reels.idea_scores (slate_id, post_idea_id, origin, net, rank, selected, chosen_bucket, chosen_framework, blockbuster, components) VALUES
 ('${I.slate}', '${I.idea1}', 'timely', 3.2, 1, true, 'ball_knowledge', 'curiosity', 0, '{}'),
 ('${I.slate}', '${I.idea2}', 'timely', 1.1, 2, true, 'the_saga', 'arousal', 1, '{}'),
 ('${I.slate}', '${I.idea3}', 'carryover', 0.4, 3, false, 'the_warning', 'identity', 0, '{}');
INSERT INTO reels.idea_copy (slate_id, post_idea_id, prompt_version, model, bucket, framework, status, on_screen_copy, full_story_below)
VALUES ('${I.slate}', '${I.idea1}', 'v1', 'm', 'ball_knowledge', 'curiosity', 'ok', E'The model nobody saw coming\\nline two', true);
INSERT INTO reels.copy_jobs (post_idea_id, slate_id, status, finished_at, usd)
VALUES ('${I.idea1}', '${I.slate}', 'ok', '2026-10-06T06:10:00Z', 0.2);
INSERT INTO reels.video_jobs (id, post_idea_id, slate_id, status, finished_at, motion_prompt, video_storage_path, higgsfield_job_id, usd)
VALUES ('${I.video1}', '${I.idea1}', '${I.slate}', 'ok', '2026-10-06T08:00:00Z', E'Hook: glitch\\nHook SFX: none', 'videos/1.mp4', 'h1', 0.1);
INSERT INTO reels.publish_attempts (id, video_job_id, post_idea_id, trigger, status, requested_at, finished_at, audio_id, caption, graduation_strategy, media_id, permalink)
VALUES ('${I.reelAttempt}', '${I.video1}', '${I.idea1}', 'auto', 'published', '2026-10-06T13:25:00Z', '2026-10-06T13:30:00Z', 'aud-1', 'caption', 'MANUAL', 'm-r1', 'https://instagram.com/reel/r1');
INSERT INTO reels.posting_schedule (id, post_idea_id, video_job_id, ny_date, slot, publish_at, status, source, publish_attempt_id, approved_at) VALUES
 ('${I.reelSched1}', '${I.idea1}', '${I.video1}', '2026-10-06', 'morning', '2026-10-06T13:30:00Z', 'published', 'auto', '${I.reelAttempt}', '2026-10-06T11:00:00Z'),
 ('${I.reelSched2}', '${I.idea2}', NULL, '2026-10-07', 'midday', '2026-10-07T16:00:00Z', 'scheduled', 'auto', NULL, NULL),
 ('${I.reelSched3}', '${I.idea3}', NULL, '2026-10-06', 'evening', '2026-10-06T23:00:00Z', 'cancelled', 'auto', NULL, NULL);
UPDATE reels.posting_schedule SET error = 'not approved before its slot' WHERE id = '${I.reelSched3}';
INSERT INTO reels.media_insights (media_id, ny_date, publish_attempt_id, views, reach, likes, comments, saved, shares, reposts, total_interactions, avg_watch_time_ms, total_watch_time_ms, skip_rate) VALUES
 ('m-r1', '2026-10-06', '${I.reelAttempt}', 100, 80, 5, 1, 2, 3, 0, 11, 4000, 400000, 0.4),
 ('m-r1', '2026-10-07', '${I.reelAttempt}', 250, 190, 12, 2, 6, 9, 1, 30, 5200, 1300000, 0.31);

-- ── Explainers ─────────────────────────────────────────────────────────────
INSERT INTO explainers.idea_cycles (id, status, mode, ny_date) VALUES ('${I.cycle}', 'ok', 'production', '2026-10-05');
INSERT INTO explainers.topics (id, title, scope, source_url, origin, status, audience_fit, teachability_45s, analogy_potential, visual_potential, accuracy_under_simplification, hook_strength, weighted_score) VALUES
 ('${I.topic1}', 'What is a webhook?', 'Explain push vs poll with one analogy.', 'https://www.example.com/a/', 'generated', 'rendered', 3.4, 3.1, 3.8, 2.9, 3.0, 3.3, 78.5),
 ('${I.topic2}', 'Why databases need primary keys', NULL, NULL, 'seeded', 'pool', 3.0, 3.2, 2.5, 2.4, 3.6, 2.2, 61.0);
INSERT INTO explainers.jobs (id, topic_id, status, trigger, mode, spend_usd, spend_cap_usd, orchestrator_model, frame_worker_model, requested_at, finished_at) VALUES
 ('${I.job1}', '${I.topic1}', 'ok', 'auto', 'production', 3.2, 5, 'claude-sonnet-5-5', 'claude-sonnet-5-5', '2026-10-05T06:00:00Z', '2026-10-05T07:00:00Z'),
 ('${I.job2}', '${I.topic1}', 'ok', 'click', 'production', 2.9, 5, 'claude-sonnet-5-5', 'claude-sonnet-5-5', '2026-10-07T06:00:00Z', '2026-10-07T07:00:00Z');
INSERT INTO explainers.artifacts (id, job_id, kind, storage_path, storage_location) VALUES
 ('${I.art1}', '${I.job1}', 'video', 'jobs/1/video.mp4', 'bucket'),
 ('${I.art2}', '${I.job2}', 'video', 'jobs/2/video.mp4', 'local');
INSERT INTO explainers.feedback (job_id, verdict, tags) VALUES ('${I.job1}', 'approved', ARRAY['hook', 'pacing']);
INSERT INTO explainers.publish_attempts (id, job_id, trigger, status, requested_at, finished_at, caption, video_object, media_id, permalink)
VALUES ('${I.expAttempt}', '${I.job1}', 'auto', 'published', '2026-10-06T19:25:00Z', '2026-10-06T19:30:00Z', 'caption', 'jobs/1/video.mp4', 'm-e1', 'https://instagram.com/reel/e1');
INSERT INTO explainers.posting_schedule (id, job_id, ny_date, slot, publish_at, status, source, publish_attempt_id)
VALUES ('${I.expSched}', '${I.job1}', '2026-10-06', 'afternoon', '2026-10-06T19:30:00Z', 'published', 'auto', '${I.expAttempt}');
INSERT INTO explainers.media_insights (media_id, ny_date, publish_attempt_id, views, reach, likes, comments, saved, shares, total_interactions, avg_watch_time_ms, total_watch_time_ms, skip_rate)
VALUES ('m-e1', '2026-10-07', '${I.expAttempt}', 400, 310, 20, 3, 15, 12, 50, 9000, 3600000, 0.22);

-- ── Carousels ──────────────────────────────────────────────────────────────
INSERT INTO social.runs (id, kind, started_at, finished_at, hook_pass, cap_usd, claude_usd, total_usd, status, trigger, record)
VALUES ('${I.socRun}', 'daily', '2026-10-06T07:00:00Z', '2026-10-06T07:40:00Z', true, 2, 1.2, 1.3, 'ok', 'scheduled', '{
  "result": {"posts": [
    {"storyId": "story-1", "costUsd": 0.6, "checks": {"warnings": [{"detail": "Slide 3 text is tight"}], "fixes": ["Dash removed"]}},
    {"storyId": "story-2", "costUsd": 0.4, "checks": {"warnings": [], "fixes": []}}
  ]},
  "selection": {"shortlist": [
    {"id": "story-1", "members": [{"title": "Crusoe raises $3.9B", "url": "https://example.com/a"}], "probSum": 2.4, "outletCount": 3},
    {"id": "story-2", "members": [{"title": "Newsom pushes an AI kill switch", "url": "https://example.com/d"}], "probSum": 1.9, "outletCount": 1},
    {"id": "story-3", "members": [{"title": "Unused candidate", "url": "https://example.com/e"}], "probSum": 1.1, "outletCount": 1}
  ]}
}'::jsonb);
INSERT INTO social.posts (id, run_id, slug, story_id, title, status, render, caption, created_at, origin, slide_objects) VALUES
 ('${I.socPost1}', '${I.socRun}', 'post-1', 'story-1', 'Crusoe raises $3.9B for AI data centers', 'published',
  '{"source": "TechCrunch", "sourceUrl": "https://example.com/a", "storyType": "tech", "slides": [{}, {}, {}]}', E'Crusoe raised $3.9B.\\nMore below.', '2026-10-06T07:30:00Z', 'pipeline', '["posts/post-1/slide-01.jpg", "posts/post-1/slide-02.jpg", "posts/post-1/slide-03.jpg"]'),
 ('${I.socPost2}', '${I.socRun}', 'post-2', 'story-2', 'Newsom pushes an AI kill switch', 'review',
  '{"source": "The Verge", "sourceUrl": "https://example.com/d", "slides": [{}, {}, {}, {}]}', 'Newsom wants a kill switch.', '2026-10-06T07:35:00Z', 'pipeline', NULL);
-- Carousels' lifecycle is on the spine (social_hub, D36).
INSERT INTO social_hub.content_items (id, vertical, format, native_ref, idea_ref)
VALUES ('${I.socItem1}', 'carousels', 'feed', '${I.socPost1}', 'story-1');
INSERT INTO social_hub.approvals (content_item_id, decision, decided_at, via)
VALUES ('${I.socItem1}', 'approved', '2026-10-06T10:00:00Z', 'user');
INSERT INTO social_hub.schedule (id, content_item_id, vertical, ny_date, slot, publish_at, status, source, publish_attempt_id)
VALUES ('${I.socSched}', '${I.socItem1}', 'carousels', '2026-10-06', 'morning', '2026-10-06T11:30:00Z', 'published', 'auto', '${I.socAttempt}');
INSERT INTO social_hub.publish_attempts (id, content_item_id, vertical, trigger, status, requested_at, finished_at, caption, payload, media_id, permalink)
VALUES ('${I.socAttempt}', '${I.socItem1}', 'carousels', 'auto', 'published', '2026-10-06T11:29:00Z', '2026-10-06T11:31:00Z', 'caption', '{"image_objects": []}', 'm-c1', 'https://instagram.com/p/c1');
INSERT INTO social.used_photos (url, used_at, story_id, slide, source, post_id) VALUES
 ('https://img/1', '2026-10-06T07:30:00Z', 'story-1', 0, 'wikimedia', '${I.socPost1}'),
 ('https://img/2', '2026-10-06T07:30:00Z', 'story-1', 1, 'logo', '${I.socPost1}');
INSERT INTO social_hub.media_insights (media_id, ny_date, vertical, publish_attempt_id, views, reach, likes, comments, saved, shares, total_interactions)
VALUES ('m-c1', '2026-10-07', 'carousels', '${I.socAttempt}', 900, 700, 40, 6, 30, 22, 98);

-- ── IG Stories ─────────────────────────────────────────────────────────────
INSERT INTO stories.sets (id, series, ny_date, status, trigger, style, payload, publish_at, approved_at, published_at, built_at, spend_usd) VALUES
 ('${I.set1}', 'morning_download', '2026-10-06', 'published', 'auto', 'polished',
  '{"stories": [{"key": "k1", "headline": "OpenAI ships a new model", "url": "https://example.com/a"}]}',
  '2026-10-06T13:00:00Z', '2026-10-06T12:00:00Z', '2026-10-06T13:01:00Z', '2026-10-06T08:10:00Z', 0.12),
 ('${I.set2}', 'guess_the_number', '2026-10-07', 'ready', 'auto', 'homemade', '{"question": "How many GPUs did it take?"}', NULL, NULL, NULL, '2026-10-07T08:10:00Z', 0.05);
INSERT INTO stories.frames (id, set_id, seq, role, backdrop, copy, storage_path, ig_media_id) VALUES
 ('${I.frame1}', '${I.set1}', 1, 'opener', 'black', '{}', 'sets/1/1.jpg', 'sm-1'),
 ('${I.frame2}', '${I.set1}', 2, 'story', 'white', '{}', 'sets/1/2.jpg', 'sm-2'),
 ('${I.frame3}', '${I.set1}', 3, 'closer', 'orange', '{}', 'sets/1/3.jpg', 'sm-3');
INSERT INTO stories.insights (frame_id, captured_at, final, reach, views, replies, shares, follows, profile_visits, total_interactions, taps_forward, taps_back, exits, swipe_forward) VALUES
 ('${I.frame1}', '2026-10-06T15:00:00Z', false, 70, 75, 0, 1, 0, 2, 3, 30, 2, 8, 1),
 ('${I.frame1}', '2026-10-07T12:00:00Z', true, 100, 110, 1, 2, 1, 3, 6, 40, 3, 10, 2),
 ('${I.frame2}', '2026-10-07T12:00:00Z', true, 80, 85, 0, 1, 0, 1, 2, 30, 1, 5, 1),
 ('${I.frame3}', '2026-10-07T12:00:00Z', true, 60, 62, 2, 0, 0, 0, 2, 0, 0, 2, 0);
-- ── Cost rows (§8a) ────────────────────────────────────────────────────────
INSERT INTO reels.runs (id, trigger, status, requested_at, finished_at) VALUES ('${I.reelRunEmpty}', 'scheduled', 'ok', '2026-10-07T05:00:00Z', '2026-10-07T05:30:00Z');
INSERT INTO reels.cost_events (run_id, vendor, component, usd, created_at) VALUES
 ('${I.reelRun}', 'anthropic', 'scoring-pass1', 0.5, '2026-10-06T05:20:00Z'),
 ('${I.reelRun}', 'anthropic', 'copy-caption', 0.2, '2026-10-06T06:05:00Z'),
 ('${I.reelRun}', 'jev', 'grouping', 0.3333, '2026-10-06T05:10:00Z'),
 ('${I.reelRun}', 'anthropic', 'reel-scene', 0.0001, '2026-10-06T07:00:00Z'),
 ('${I.reelRunEmpty}', 'anthropic', 'scoring-pass1', 0.7, '2026-10-07T05:20:00Z'),
 (NULL, 'anthropic', 'song-tag', 0.05, '2026-10-06T09:00:00Z');
INSERT INTO explainers.cost_events (job_id, idea_cycle_id, mode, vendor, component, usd, created_at) VALUES
 ('${I.job1}', NULL, 'production', 'heygen', 'render', 3.0, '2026-10-05T06:30:00Z'),
 ('${I.job1}', NULL, 'production', 'anthropic', 'orchestrator', 0.2, '2026-10-05T06:10:00Z'),
 ('${I.job2}', NULL, 'production', 'heygen', 'render', 2.9, '2026-10-07T06:30:00Z'),
 (NULL, '${I.cycle}', 'production', 'anthropic', 'idea-generator', 0.21, '2026-10-05T06:01:00Z'),
 (NULL, '${I.cycle}', 'production', 'jev', 'idea-scoring', 0.12, '2026-10-05T06:02:00Z');
INSERT INTO social.runs (id, kind, started_at, finished_at, hook_pass, cap_usd, claude_usd, total_usd, status, trigger, record)
VALUES ('${I.socRunEmpty}', 'daily', '2026-10-07T07:00:00Z', '2026-10-07T07:20:00Z', false, 2, 0.39, 0.4, 'partial', 'scheduled', '{"result": {"posts": []}}');
-- A second reel made the same night, with more job spend (weighted direct split).
INSERT INTO reels.video_jobs (id, post_idea_id, slate_id, status, finished_at, video_storage_path, usd)
VALUES ('${I.video2}', '${I.idea2}', '${I.slate}', 'ok', '2026-10-06T08:30:00Z', 'videos/2.mp4', 0.6);
-- A failed retry on the posted reel: a second post on the same content item.
INSERT INTO reels.publish_attempts (id, video_job_id, post_idea_id, trigger, status, requested_at, finished_at, audio_id, caption, graduation_strategy, error)
VALUES ('${I.reelAttemptFailed}', '${I.video1}', '${I.idea1}', 'force', 'failed', '2026-10-07T13:00:00Z', '2026-10-07T13:01:00Z', 'aud-1', 'caption', 'MANUAL', 'quota');
-- A later daily run touched story-1 again (rerun-photos); a preview run touched story-2.
INSERT INTO social.runs (id, kind, started_at, finished_at, hook_pass, cap_usd, claude_usd, total_usd, status, trigger, record) VALUES
 ('${I.socRunRerun}', 'daily', '2026-10-08T07:00:00Z', '2026-10-08T07:10:00Z', false, 2, 0.28, 0.3, 'ok', 'scheduled',
  '{"jev": {"costUsd": 0.02}, "result": {"posts": [{"storyId": "story-1", "costUsd": 0.25}]}}'),
 ('${I.socRunPreview}', 'preview', '2026-10-07T20:00:00Z', '2026-10-07T20:10:00Z', true, 2, 0.2, 0.2, 'ok', 'cli',
  '{"result": {"posts": [{"storyId": "story-2", "costUsd": 0.15}]}}');
INSERT INTO stories.cost_events (set_id, vendor, component, usd, created_at) VALUES
 ('${I.set1}', 'anthropic', 'writer', 0.12, '2026-10-06T08:00:00Z'),
 ('${I.set2}', 'anthropic', 'writer', 0.05, '2026-10-07T08:00:00Z'),
 (NULL, 'jev', 'sources', 0.09, '2026-10-06T07:50:00Z'),
 (NULL, 'jev', 'sources', 0.01, '2026-10-09T07:50:00Z');

INSERT INTO stories.candidates (id, set_id, origin, ref, payload, score, chosen) VALUES
 ('${I.cand1}', '${I.set2}', 'catalog', 'cat-9', '{"question": "How many tokens fit in a context window?"}', 0.71, false),
 ('40000000-0000-4000-8000-000000000022', '${I.set1}', 'reels', 'idea-1', '{"headline": "OpenAI ships a new model"}', 0.9, true);
`);
}
