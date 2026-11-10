/**
 * Fixture for reels.idea_sources_v and the Reels readers moved onto it (central intake Phase 2, Owner E):
 * the Social Hub PGlite (reels + intake schemas + db/reels_intake_views.sql) with `dbQuery` pointed at it,
 * legacy ideas (post_idea_members ⋈ sources) and intake ideas (intake.items, a merged chain) side by side.
 */
import type { PGlite } from '@electric-sql/pglite';

import { openHubTestDb } from './social-hub/pglite';

const id = (n: number) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const F = {
  RUN: id(1),
  SLATE: id(2),
  NY_DATE: '2026-11-08',
  // legacy ideas
  IL: id(10),
  ISEED: id(11),
  L1: id(21),
  L2: id(22),
  L3: id(23),
  LS: id(24),
  // intake stories (= idea ids): ROOT; M2 merged into M1, then M1 into ROOT (items moved as mergeStories moves them); OTHER holds a Reels seed
  ROOT: id(30),
  M1: id(31),
  M2: id(32),
  OTHER: id(33),
  // copy, frame, video
  VIS_L: id(40),
  VID_L: id(41),
  VIS_I: id(42),
  VID_I: id(43),
} as const;

export async function openIdeaSourcesDb(): Promise<PGlite> {
  const { pg } = await openHubTestDb();
  (globalThis as { __outreachHubPool?: unknown }).__outreachHubPool = {
    query: (text: string, params?: unknown[]) => pg.query(text, params as unknown[]),
  };
  return pg;
}

/** Legacy rows only: what a night before the switch left behind. */
export async function seedLegacy(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO reels.runs (id, trigger, status) VALUES ('${F.RUN}', 'scheduled', 'ok') ON CONFLICT DO NOTHING;
    INSERT INTO reels.post_ideas (id) VALUES ('${F.IL}'), ('${F.ISEED}');
    INSERT INTO reels.sources (id, run_id, canonical_url, headline, body, author, byline, source_name, source_type, adapter_id, bucket,
                               publish_time, ingest_time, citation_urls, drop_reason) VALUES
      ('${F.L1}', '${F.RUN}', 'https://legacy.test/1', 'Legacy primary', 'Body one', 'Ann', 'by Ann', 'Hacker News', 'A2', 'hacker-news', 'A',
       now() - interval '30 hours', now() - interval '1 day', ARRAY['https://cite.test/a'], NULL),
      ('${F.L2}', '${F.RUN}', 'https://legacy.test/2', 'Legacy supporting', 'Body two', NULL, NULL, 'TechCrunch', 'B1', 'techcrunch', 'B',
       NULL, now() - interval '1 day', ARRAY[]::text[], NULL),
      ('${F.L3}', '${F.RUN}', 'https://legacy.test/3', 'Legacy duplicate', 'Body three', NULL, NULL, 'The Verge', 'B1', 'the-verge-ai', 'B',
       NULL, now() - interval '1 day', ARRAY[]::text[], NULL),
      ('${F.LS}', '${F.RUN}', 'https://legacy.test/seed', 'Legacy seed', 'Seed body', NULL, NULL, 'Lucas', 'A1', 'seed', 'A',
       NULL, now() - interval '2 days', ARRAY[]::text[], 'seed');
    INSERT INTO reels.post_idea_members (source_id, post_idea_id, role, joined_at) VALUES
      ('${F.L2}', '${F.IL}', 'supporting', now() - interval '20 hours'),
      ('${F.L1}', '${F.IL}', 'primary', now() - interval '22 hours'),
      ('${F.L3}', '${F.IL}', 'merged_duplicate', now() - interval '18 hours'),
      ('${F.LS}', '${F.ISEED}', 'primary', now() - interval '2 days');
  `);
}

/**
 * Intake rows: ROOT keeps a reels item, a feed-first URL a reels adapter also lists, a search deposit and an old row
 * with no membership columns; it leaves out a feeds-only URL and one the reels list dropped. M2 was merged into M1,
 * then M1 into ROOT: as lib/intake/group.ts mergeStories does, every item moved to the target (k8 → M1 → ROOT, k7 →
 * ROOT, each primary turned supporting), so M1 and M2 keep no items. OTHER holds a Reels seed and an LFD seed.
 */
export async function seedIntake(pg: PGlite): Promise<void> {
  await pg.exec(`
    INSERT INTO intake.stories (id, representative_key, headline, first_seen_at, last_joined_at, merged_into) VALUES
      ('${F.ROOT}', 'https://in.test/k1', 'Intake root', now() - interval '1 day', now() - interval '2 hours', NULL),
      ('${F.OTHER}', 'https://in.test/k9', 'Intake seed story', now() - interval '1 day', now() - interval '1 day', NULL);
    INSERT INTO intake.stories (id, representative_key, headline, first_seen_at, last_joined_at, merged_into) VALUES
      ('${F.M1}', 'https://in.test/k7', 'Merged once', now() - interval '1 day', now() - interval '1 day', '${F.ROOT}');
    INSERT INTO intake.stories (id, representative_key, headline, first_seen_at, last_joined_at, merged_into) VALUES
      ('${F.M2}', 'https://in.test/k8', 'Merged twice', now() - interval '1 day', now() - interval '1 day', '${F.M1}');
    INSERT INTO intake.items (key, family, source_id, source_name, source_type, headline, body, url, author, byline, publish_time,
                              first_seen_at, citation_urls, drop_reason, story_id, role, joined_at,
                              feed_slug, feed_drop_reason, reels_source_id, reels_drop_reason, seeded_by, seed_order) VALUES
      ('https://in.test/k1', 'reels', 'hacker-news', 'Hacker News', 'A2', 'Intake primary', 'Intake body one', 'https://in.test/k1', 'Bo', 'by Bo',
       now() - interval '26 hours', now() - interval '1 day', ARRAY['https://cite.test/b'], NULL, '${F.ROOT}', 'primary', now() - interval '23 hours',
       NULL, NULL, 'hacker-news', NULL, NULL, NULL),
      ('https://in.test/k2', 'feeds', 'feed:verge', 'The Verge', 'feed', 'Intake feed-first', 'Intake body two', 'https://in.test/k2', NULL, NULL,
       NULL, now() - interval '1 day', '{}', NULL, '${F.ROOT}', 'supporting', now() - interval '21 hours',
       'verge', NULL, 'techcrunch', NULL, NULL, NULL),
      ('https://in.test/k3', 'feeds', 'feed:wired', 'Wired', 'feed', 'Intake feeds only', 'x', 'https://in.test/k3', NULL, NULL,
       NULL, now() - interval '1 day', '{}', NULL, '${F.ROOT}', 'supporting', now() - interval '20 hours',
       'wired', NULL, NULL, NULL, NULL, NULL),
      ('https://in.test/k4', 'reels', 'hacker-news', 'Hacker News', 'A2', 'Intake reels-dropped', 'x', 'https://in.test/k4', NULL, NULL,
       NULL, now() - interval '1 day', '{}', NULL, '${F.ROOT}', 'supporting', now() - interval '19 hours',
       'ars', NULL, 'hacker-news', 'stale', NULL, NULL),
      ('https://in.test/k5', 'search', 'search:b6', 'Claude web search', 'B6', 'Intake search find', 'Intake body five', 'https://in.test/k5', NULL, NULL,
       NULL, now() - interval '1 day', '{}', NULL, '${F.ROOT}', 'supporting', now() - interval '18 hours',
       NULL, NULL, NULL, NULL, NULL, NULL),
      ('https://in.test/k6', 'reels', 'github-trending', 'GitHub Trending', 'A1', 'Intake old row', 'Intake body six', 'https://in.test/k6', NULL, NULL,
       NULL, now() - interval '1 day', '{}', NULL, '${F.ROOT}', 'merged_duplicate', now() - interval '17 hours',
       NULL, NULL, NULL, NULL, NULL, NULL),
      ('https://in.test/k7', 'reels', 'hf-daily-papers', 'HF Papers', 'A3', 'Moved from M1', 'Intake body seven', 'https://in.test/k7', NULL, NULL,
       NULL, now() - interval '1 day', '{}', NULL, '${F.ROOT}', 'supporting', now() - interval '16 hours',
       NULL, NULL, 'hf-daily-papers', NULL, NULL, NULL),
      ('https://in.test/k8', 'reels', 'hf-daily-papers', 'HF Papers', 'A3', 'Moved from M2', 'Intake body eight', 'https://in.test/k8', NULL, NULL,
       NULL, now() - interval '1 day', '{}', NULL, '${F.ROOT}', 'supporting', now() - interval '15 hours',
       NULL, NULL, 'hf-daily-papers', NULL, NULL, NULL),
      ('https://in.test/k9', 'seed', 'seed:reels', 'Lucas', 'seed', 'Intake reels seed', 'Seed body nine', 'https://in.test/k9', NULL, NULL,
       NULL, now() - interval '1 day', '{}', NULL, '${F.OTHER}', 'primary', now() - interval '1 day',
       NULL, NULL, NULL, NULL, 'lucas', 'reels'),
      ('https://in.test/k10', 'seed', 'seed:lfd', 'Tommy', 'seed', 'Intake lfd seed', 'x', 'https://in.test/k10', NULL, NULL,
       NULL, now() - interval '1 day', '{}', NULL, '${F.OTHER}', 'supporting', now() - interval '1 day',
       NULL, NULL, NULL, NULL, 'tommy', 'lfd');
    -- The Reels registry rows (contract: a Reels idea id is its intake story id).
    INSERT INTO reels.post_ideas (id) VALUES ('${F.ROOT}'), ('${F.OTHER}');
  `);
}

/** A slate scoring every registered idea, copy for the two story ideas, and a frame + video for each. */
export async function seedSlate(pg: PGlite, ideas: string[]): Promise<void> {
  await pg.exec(`
    INSERT INTO reels.runs (id, trigger, status) VALUES ('${F.RUN}', 'scheduled', 'ok') ON CONFLICT DO NOTHING;
    INSERT INTO reels.score_slates (id, run_id, ny_date, scored_at, pass1_version, pass2_version)
      VALUES ('${F.SLATE}', '${F.RUN}', '${F.NY_DATE}', now() - interval '1 hour', 'p1', 'p2');
  `);
  for (const [i, idea] of ideas.entries()) {
    await pg.query(
      `INSERT INTO reels.idea_scores (slate_id, post_idea_id, origin, net, rank, selected, chosen_bucket, chosen_framework,
                                      psychology, bucket_score, confidence, components)
       VALUES ($1, $2, 'timely', $3, $4, true, 'the_saga', 'arousal', 0.6, 0.6, 0.8, '{}'::jsonb)`,
      [F.SLATE, idea, 3 - i * 0.5, i + 1],
    );
  }
  const story = ideas.filter((x) => x === F.IL || x === F.ROOT);
  for (const idea of story) {
    const [vis, vid] = idea === F.IL ? [F.VIS_L, F.VID_L] : [F.VIS_I, F.VID_I];
    await pg.query(
      `INSERT INTO reels.idea_copy (slate_id, post_idea_id, prompt_version, model, bucket, framework, status, on_screen_copy, caption)
       VALUES ($1, $2, 'v1', 'm', 'the_saga', 'arousal', 'ok', 'A line on screen', 'A caption')`,
      [F.SLATE, idea],
    );
    await pg.query(
      `INSERT INTO reels.visual_jobs (id, post_idea_id, slate_id, status, scene, background_storage_path, finished_at)
       VALUES ($1, $2, $3, 'ok', 'A scene', 'frames/bg.png', now())`,
      [vis, idea, F.SLATE],
    );
    await pg.query(
      `INSERT INTO reels.video_jobs (id, post_idea_id, slate_id, visual_job_id, status, finished_at, video_storage_path)
       VALUES ($1, $2, $3, $4, 'ok', now(), 'videos/x.mp4')`,
      [vid, idea, F.SLATE, vis],
    );
  }
}

/** Mark ideas published: reels.published_status, a published schedule slot, and a failed copy job each. */
export async function seedPublished(pg: PGlite, ideas: string[]): Promise<void> {
  const slots = ['morning', 'midday', 'evening'];
  for (const [i, idea] of ideas.entries()) {
    await pg.query(`INSERT INTO reels.published_status (post_idea_id, published) VALUES ($1, true)`, [idea]);
    await pg.query(
      `INSERT INTO social_hub.schedule (vertical, idea_ref, ny_date, slot, publish_at, status, source)
       VALUES ('reels', $1, '${F.NY_DATE}', $2, now() - interval '1 day', 'published', 'auto')`,
      [idea, slots[i % slots.length]],
    );
    await pg.query(
      `INSERT INTO reels.copy_jobs (post_idea_id, slate_id, status, finished_at, error) VALUES ($1, $2, 'failed', now() - interval '1 hour', 'boom')`,
      [idea, F.SLATE],
    );
  }
}
