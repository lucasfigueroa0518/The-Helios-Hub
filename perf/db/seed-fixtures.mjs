#!/usr/bin/env node
/**
 * Second seed pass: makes the synthetic data usable by real pages.
 * - the perf user (perf/lib/session.mjs) exists, owns campaigns, belongs to boards
 * - one "hero" manual campaign with a full pipeline (leads, workspace, drafts, queue)
 * - tokens for the token-gated pages
 * - writes perf/db/seed-ids.json, which fills the {placeholders} in routes.json
 *
 *   source perf/env.sh && node perf/db/seed-fixtures.mjs
 * Loopback databases only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import { PERF_USER } from '../lib/session.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL;
if (!url || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('Refusing: DATABASE_URL must point at a loopback database (source perf/env.sh).');
  process.exit(1);
}

const REVIEW_TOKEN = 'perfReviewToken0000000000000000000000000000';
const DASHBOARD_TOKEN = 'perf-dashboard-token-000000000000000000000001';

async function one(client, sql, params = []) {
  const { rows } = await client.query(sql, params);
  return rows[0] ?? null;
}

async function main() {
  const client = new pg.Client({ connectionString: url });
  await client.connect();

  // 0. Tombstones: most rows are live (older seeds filled deleted_at etc. at random).
  const { rows: tomb } = await client.query(`
    SELECT table_schema, table_name, column_name FROM information_schema.columns
     WHERE table_schema = ANY($1) AND is_nullable = 'YES'
       AND column_name ~ '^(deleted|archived|removed|cancell?ed|rejected|failed|killed|retired|expired|bounced|unsubscribed|suppressed|errored|paused|stopped|superseded|discarded)_(at|by|on)$'`,
    [['outreach', 'social', 'social_hub', 'reels', 'boards', 'reel_ai_drama', 'memes', 'stories', 'explainers', 'networking', 'real_case', 'intake', 'seo', 'field_notes', 'dashboards', 'ai_events', 'media_library', 'lfd', 'revisions']]);
  for (const t of tomb) {
    await client.query(`UPDATE "${t.table_schema}"."${t.table_name}" SET "${t.column_name}" = NULL
      WHERE "${t.column_name}" IS NOT NULL AND abs(hashtext(ctid::text)) % 100 < 92`).catch((e) => console.warn(`tombstone ${t.table_name}.${t.column_name}:`, e.message));
  }

  // 0b. In-flight states are rare in a live system: settle ~99% of queued/running rows
  // to a terminal status allowed by the table's own CHECK list.
  const { rows: statusChecks } = await client.query(`
    SELECT n.nspname AS schema, c.relname AS table, a.attname AS col, pg_get_constraintdef(k.oid) AS def
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.conkey[1]
     WHERE k.contype = 'c' AND array_length(k.conkey, 1) = 1 AND a.attname IN ('status', 'state')
       AND n.nspname = ANY($1)`, [['outreach', 'social', 'social_hub', 'reels', 'boards', 'reel_ai_drama', 'memes', 'stories', 'explainers', 'networking', 'real_case', 'intake', 'seo', 'field_notes', 'dashboards', 'ai_events', 'media_library', 'lfd', 'revisions']]);
  const INFLIGHT = /^(requested|running|building|queued|claimed|processing|publishing|creating|in_progress|generating|rendering|handing_off|leased|retrying)$/;
  const TERMINAL = ['ok', 'done', 'succeeded', 'success', 'published', 'built', 'complete', 'completed', 'finished', 'sent', 'posted', 'rendered', 'ready', 'handed_off', 'failed'];
  for (const sc of statusChecks) {
    const vals = [...sc.def.matchAll(/'((?:[^']|'')*)'::/g)].map((m) => m[1]);
    const inflight = vals.filter((v) => INFLIGHT.test(v));
    const terminal = TERMINAL.find((t) => vals.includes(t));
    if (!inflight.length || !terminal) continue;
    await client.query(`UPDATE "${sc.schema}"."${sc.table}" SET "${sc.col}" = $1
      WHERE "${sc.col}" = ANY($2) AND abs(hashtext(ctid::text)) % 100 <> 0`, [terminal, inflight])
      .catch((e) => console.warn(`settle ${sc.schema}.${sc.table}:`, e.message.slice(0, 120)));
  }

  // 1. The perf user and their profile.
  await client.query(
    `INSERT INTO outreach.users (id, email, display_name, last_login_at) VALUES ($1, $2, 'Perf Tester', now())
     ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
    [PERF_USER.id, PERF_USER.email],
  );
  await client.query(
    `INSERT INTO boards.user_profiles (user_id, first_name, last_name)
     VALUES ($1, 'Perf', 'Tester') ON CONFLICT (user_id) DO NOTHING`,
    [PERF_USER.id],
  ).catch(() => {});

  // 2. The perf user owns three quarters of the campaigns (visibility rule in lib/campaigns.ts).
  await client.query(
    `UPDATE outreach.campaigns SET owner_id = $1 WHERE id IN (
       SELECT id FROM outreach.campaigns ORDER BY id LIMIT (SELECT (count(*) * 3 / 4) FROM outreach.campaigns))`,
    [PERF_USER.id],
  );
  await client.query(`UPDATE outreach.campaigns SET merged_into_id = NULL`);

  // Hero manual campaign: the one with the most leads, owned and active.
  const hero = await one(client, `
    SELECT c.id FROM outreach.campaigns c
      JOIN outreach.drafting_workspaces w ON w.campaign_id = c.id
     WHERE c.owner_id = $1
     ORDER BY (SELECT count(*) FROM outreach.campaign_leads cl WHERE cl.campaign_id = c.id) DESC LIMIT 1`, [PERF_USER.id]);
  await client.query(`UPDATE outreach.campaigns SET status = 'active', kind = 'manual' WHERE id = $1`, [hero.id]);
  // Give the hero a realistic pipeline: 1,500 leads attached.
  await client.query(`
    INSERT INTO outreach.campaign_leads (campaign_id, lead_id, run_id)
    SELECT $1, l.id, (SELECT id FROM outreach.runs ORDER BY id LIMIT 1) FROM outreach.leads l
     WHERE NOT EXISTS (SELECT 1 FROM outreach.campaign_leads cl WHERE cl.campaign_id = $1 AND cl.lead_id = l.id)
     LIMIT 1500
    ON CONFLICT DO NOTHING`, [hero.id]).catch((e) => console.warn('hero leads:', e.message));

  // Auto campaign: active + live.
  const auto = await one(client, `SELECT id FROM outreach.campaigns WHERE id <> $1 ORDER BY id DESC LIMIT 1`, [hero.id]);
  await client.query(`UPDATE outreach.campaigns SET kind = 'auto', status = 'active', auto_status = 'live', owner_id = $2 WHERE id = $1`, [auto.id, PERF_USER.id]);

  // 3. Boards: the perf user is in every workspace and on every board.
  await client.query(`INSERT INTO boards.workspace_members (workspace_id, user_id)
    SELECT w.id, $1 FROM boards.workspaces w ON CONFLICT DO NOTHING`, [PERF_USER.id]).catch((e) => console.warn('workspace_members:', e.message));
  await client.query(`INSERT INTO boards.board_members (board_id, user_id, added_by_id)
    SELECT b.id, $1, $1 FROM boards.boards b ON CONFLICT DO NOTHING`, [PERF_USER.id]).catch((e) => console.warn('board_members:', e.message));
  await client.query(`UPDATE boards.boards SET archived = false`).catch(() => {});

  // 4. Dashboards: one active project with a known token.
  const project = await one(client, `SELECT id FROM dashboards.projects ORDER BY id LIMIT 1`);
  await client.query(`UPDATE dashboards.projects SET access_token = $2, status = 'ACTIVE' WHERE id = $1`, [project.id, DASHBOARD_TOKEN]);
  await client.query(`UPDATE dashboards.projects SET status = 'ACTIVE' WHERE id IN (SELECT id FROM dashboards.projects ORDER BY id LIMIT 30)`);

  // 5. Reels review link.
  await client.query(`INSERT INTO reels.settings (key, value) VALUES ('review_token', $1), ('review_open', 'true')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(REVIEW_TOKEN)]);

  // 6a. Post bodies get the JSON shapes the hub queries and mappers read
  // (tests/fixtures/social-hub/preview-dataset.ts): 8-11 slides, slide objects, stories, cities.
  const SLIDES = (idExpr, titleExpr) => `(SELECT jsonb_agg(jsonb_build_object(
      'layoutVariant', CASE WHEN g = 1 THEN 'cover' WHEN g % 3 = 0 THEN 'data_block' ELSE 'story_beat' END,
      'headline', jsonb_build_array(jsonb_build_object('text', CASE WHEN g = 1 THEN ${titleExpr} ELSE 'Why it matters, beat ' || g END, 'role', 'narrative')),
      'body', jsonb_build_array(jsonb_build_object('text', 'One plain sentence that carries the story forward, with a number that matters and the catch.', 'role', 'narrative'))))
    FROM generate_series(1, 8 + (abs(hashtext(${idExpr}::text)) % 4)) g)`;
  const OBJECTS = (idExpr, prefix) => `CASE WHEN abs(hashtext(${idExpr}::text)) % 3 <> 0 THEN
    (SELECT jsonb_agg('${prefix}/' || ${idExpr} || '/slide-' || lpad(g::text, 2, '0') || '.jpg') FROM generate_series(1, 9) g) END`;
  await client.query(`UPDATE social.posts p SET
      render = jsonb_build_object('source', 'TechCrunch', 'sourceUrl', 'https://example.com/a/' || p.id, 'storyType', 'tech', 'slides', ${SLIDES('p.id', 'p.title')}),
      slide_objects = ${OBJECTS('p.id', 'posts')},
      brief = jsonb_build_object('angle', 'What changes for founders', 'facts', jsonb_build_array('fact one', 'fact two')),
      draft = jsonb_build_object('hook', p.title)`);
  await client.query(`UPDATE lfd.posts p SET
      render = jsonb_build_object('slides', ${SLIDES('p.id', "'The last few days in AI'")}),
      slide_objects = ${OBJECTS('p.id', 'lfd')},
      stories = (SELECT jsonb_agg(jsonb_build_object('key', 'k' || g, 'headline', 'Story ' || g || ' of the week', 'url', 'https://example.com/lfd/' || g, 'source', 'The Verge')) FROM generate_series(1, 6) g),
      fit_problems = '[]', render_problems = '[]'`);
  await client.query(`UPDATE ai_events.posts p SET
      render = jsonb_build_object('slides', ${SLIDES('p.id', "'Your AI week, already planned.'")}),
      slide_objects = ${OBJECTS('p.id', 'ai-events')},
      cities = '["Miami", "Boston", "New York", "SF Bay Area"]', fit_problems = '[]', render_problems = '[]'`);
  await client.query(`UPDATE field_notes.posts p SET
      slides = ${SLIDES('p.id', "'Field notes'")},
      slide_objects = ${OBJECTS('p.id', 'field-notes')},
      fit_problems = '[]', render_problems = '[]', soft_notes = '[]'`);

  // 6b. Spine: each content item points at a real post of its type (native_ref), like production.
  await client.query(`
    WITH items AS (SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM social_hub.content_items)
    UPDATE social_hub.content_items c
       SET vertical = (ARRAY['carousels','reels','last_few_days','ai_events','field_notes','explainers'])[1 + (i.rn % 6)::int],
           deleted_at = CASE WHEN i.rn % 25 = 0 THEN now() END
      FROM items i WHERE c.id = i.id`);
  const native = [
    ['carousels', 'social.posts'], ['last_few_days', 'lfd.posts'], ['ai_events', 'ai_events.posts'],
    ['field_notes', 'field_notes.posts'], ['reels', 'reels.post_ideas'], ['explainers', 'explainers.jobs'],
  ];
  await client.query(`UPDATE social_hub.content_items SET native_ref = 'tmp:' || id`);
  for (const [vertical, table] of native) {
    await client.query(`
      WITH ci AS (SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM social_hub.content_items WHERE vertical = $1),
           n AS (SELECT id, row_number() OVER (ORDER BY id) AS rn, count(*) OVER () AS total FROM ${table})
      UPDATE social_hub.content_items c
         SET native_ref = n.id::text,
             idea_ref = CASE WHEN $1 = 'reels' THEN n.id::text WHEN $1 = 'carousels' THEN 'story-' || n.rn ELSE NULL END
        FROM ci JOIN n ON n.rn = ci.rn
       WHERE c.id = ci.id`, [vertical]);
    // More items than posts: the rest point nowhere (a removed post), which the spine reads as null.
    await client.query(`
      WITH ci AS (SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM social_hub.content_items WHERE vertical = $1)
      UPDATE social_hub.content_items c SET native_ref = 'removed:' || c.id, idea_ref = NULL
        FROM ci WHERE c.id = ci.id AND ci.rn > (SELECT count(*) FROM ${table})`, [vertical]);
  }

  // 6c. Schedule + publish attempts: cross-column CHECKs the generic seeder can't satisfy.
  await client.query(`DELETE FROM social_hub.media_insights`);
  await client.query(`DELETE FROM social_hub.schedule`);
  await client.query(`
    WITH items AS (SELECT id, vertical, row_number() OVER (PARTITION BY vertical ORDER BY created_at, id) AS rn,
                          count(*) OVER (PARTITION BY vertical) AS total
                     FROM social_hub.content_items WHERE deleted_at IS NULL),
    placed AS (
      SELECT id, rn, vertical, CASE vertical WHEN 'carousels' THEN 'morning' WHEN 'reels' THEN 'midday'
          WHEN 'last_few_days' THEN 'morning' WHEN 'ai_events' THEN 'evening' WHEN 'field_notes' THEN 'afternoon' ELSE 'late' END AS slot,
             -- One post per type per day: history up to today, plus three days already planned.
             (current_date + 3 - (total - rn)::int) AS ny_date
        FROM items
    )
    INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source, slot_by)
    SELECT id, vertical, ny_date, slot, (ny_date + time '13:00') AT TIME ZONE 'America/New_York',
           CASE WHEN ny_date < current_date THEN 'published' ELSE 'scheduled' END, 'auto', 'system'
      FROM placed
    ON CONFLICT DO NOTHING`);
  await client.query(`DELETE FROM social_hub.publish_attempts`);
  await client.query(`
    INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, requested_at, started_at, finished_at, caption, media_id, permalink)
    SELECT s.content_item_id, s.vertical, 'approve', 'published', s.publish_at - interval '5 minutes', s.publish_at - interval '4 minutes', s.publish_at,
           'Caption for ' || s.content_item_id, 'ig_' || substr(md5(s.content_item_id::text), 1, 16), 'https://instagram.com/p/' || substr(md5(s.id::text), 1, 11)
      FROM social_hub.schedule s WHERE s.status = 'published' AND s.content_item_id IS NOT NULL`);
  await client.query(`UPDATE social_hub.schedule s SET publish_attempt_id = a.id
      FROM social_hub.publish_attempts a WHERE a.content_item_id = s.content_item_id AND s.status = 'published'`);
  // Daily insights for each published post: about 7 snapshots per post.
  await client.query(`
    INSERT INTO social_hub.media_insights (media_id, ny_date, vertical, publish_attempt_id, views, reach, likes, comments, saved, shares, total_interactions)
    SELECT a.media_id, (a.finished_at AT TIME ZONE 'America/New_York')::date + d, a.vertical, a.id,
           300 + d * 90 + abs(hashtext(a.id::text)) % 900, 200 + d * 60, 10 + d * 3, d, 5 + d, 2 + d, 20 + d * 8
      FROM social_hub.publish_attempts a CROSS JOIN generate_series(0, 6) d
    ON CONFLICT DO NOTHING`);

  // 6d. Song picks carry their shortlist (lib/reels/music/overview.ts reads shortlist.candidates).
  await client.query(`UPDATE reels.song_picks SET shortlist = jsonb_build_object('candidates', jsonb_build_array(
      jsonb_build_object('audioId', COALESCE(picked_audio_id, 'a1'), 'title', 'Track', 'artist', 'Artist', 'genre', 'pop', 'bpm', 118),
      jsonb_build_object('audioId', 'alt-' || id, 'title', 'Alt', 'artist', 'Other', 'genre', 'house', 'bpm', 124)))`);

  // 7. Placeholder ids.
  const pickId = async (sql, params = []) => (await one(client, sql, params))?.id ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const ids = {
    campaignId: hero.id,
    autoCampaignId: auto.id,
    itemId: await pickId(`SELECT i.id FROM outreach.drafting_items i JOIN outreach.drafting_workspaces w ON w.id = i.workspace_id
                           WHERE w.campaign_id IN (SELECT id FROM outreach.campaigns WHERE owner_id = $1)
                             AND EXISTS (SELECT 1 FROM outreach.email_sends s WHERE s.drafting_item_id = i.id)
                           ORDER BY (SELECT count(*) FROM outreach.inbound_emails e WHERE e.drafting_item_id = i.id) DESC, i.id LIMIT 1`, [PERF_USER.id]),
    jobId: await pickId(`SELECT id FROM explainers.jobs ORDER BY id LIMIT 1`),
    inboxId: await pickId(`SELECT id FROM outreach.sender_inboxes ORDER BY id LIMIT 1`),
    date: today,
    queueItemId: await pickId(`SELECT id FROM outreach.email_send_queue WHERE campaign_id IN (SELECT id FROM outreach.campaigns WHERE owner_id = $1) ORDER BY id LIMIT 1`, [PERF_USER.id]),
    seoPropertyId: await pickId(`SELECT p.id FROM seo.properties p ORDER BY (SELECT count(*) FROM seo.dimension_rows d WHERE d.property_id = p.id) DESC LIMIT 1`),
    postId: await pickId(`SELECT id FROM social.posts ORDER BY created_at DESC LIMIT 1`),
    setId: await pickId(`SELECT id FROM stories.sets ORDER BY id LIMIT 1`),
    projectId: project.id,
    token: DASHBOARD_TOKEN,
    reviewToken: REVIEW_TOKEN,
  };
  await client.query('ANALYZE');
  for (const [k, v] of Object.entries(ids)) if (v === null) console.warn(`seed-ids: no value for ${k}`);
  fs.writeFileSync(path.join(HERE, 'seed-ids.json'), JSON.stringify(ids, null, 2) + '\n');
  console.log('fixtures ready; wrote perf/db/seed-ids.json');
  await client.end();
}

main().catch((error) => { console.error(error); process.exit(1); });
