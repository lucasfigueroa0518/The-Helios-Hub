-- Snapshot of what Helios actually published, for the comment lab. Reads only, in one read-only transaction.
--   psql "$DATABASE_URL" -X -qAt -f scripts/personality_seed_posts.sql > lib/personality/posted-posts.json
BEGIN READ ONLY;
WITH published AS (
  SELECT DISTINCT ON (a.content_item_id) a.content_item_id, a.vertical, a.caption, a.payload, a.permalink, a.finished_at, c.native_ref
    FROM social_hub.publish_attempts a
    JOIN social_hub.content_items c ON c.id = a.content_item_id
   WHERE a.status = 'published' AND c.deleted_at IS NULL
   ORDER BY a.content_item_id, a.finished_at DESC
),
reels AS (
  SELECT p.content_item_id::text AS id, 'Reels' AS type, p.finished_at::date AS date, p.permalink, p.caption, copy.text AS copy
    FROM published p
    CROSS JOIN LATERAL (
      SELECT c.on_screen_copy AS text
        FROM reels.idea_copy c
       WHERE c.post_idea_id::text = p.payload->>'post_idea_id' AND coalesce(c.on_screen_copy, '') <> ''
       ORDER BY (left(c.caption, 60) = left(p.caption, 60)) DESC NULLS LAST, (c.status = 'ok') DESC
       LIMIT 1
    ) copy
   WHERE p.vertical = 'reels'
),
explainers AS (
  SELECT p.content_item_id::text AS id, 'Explainers' AS type, p.finished_at::date AS date, p.permalink, p.caption, script.text AS copy
    FROM published p
    CROSS JOIN LATERAL (
      SELECT a.content AS text FROM explainers.artifacts a
       WHERE a.job_id::text = p.native_ref AND a.kind = 'script' AND coalesce(a.content, '') <> ''
       ORDER BY a.seq DESC LIMIT 1
    ) script
   WHERE p.vertical = 'explainers'
),
carousels AS (
  SELECT p.content_item_id::text AS id, 'Carousels' AS type, p.finished_at::date AS date, p.permalink, p.caption,
         (SELECT string_agg(concat_ws(E'\n', s->'headline'->>'text', s->'body'->>'text'), E'\n\n' ORDER BY n)
            FROM jsonb_array_elements(sp.draft->'slides') WITH ORDINALITY AS t(s, n)) AS copy
    FROM published p
    JOIN social.posts sp ON sp.id::text = p.native_ref
   WHERE p.vertical = 'carousels'
),
-- One frame is one story. Instagram has no comments on Stories, so these are here for the range of real reporting.
morning AS (
  SELECT f.id::text AS id, 'Morning Download' AS type, s.ny_date AS date, NULL::text AS permalink, '' AS caption, f.copy->>'headline' AS copy
    FROM stories.frames f
    JOIN stories.sets s ON s.id = f.set_id
   WHERE f.ig_media_id IS NOT NULL AND s.series = 'morning_download' AND f.copy->>'role' = 'story' AND coalesce(f.copy->>'headline', '') <> ''
)
SELECT coalesce(json_agg(row_to_json(x) ORDER BY x.date DESC, x.id), '[]')
  FROM (SELECT * FROM reels UNION ALL SELECT * FROM explainers UNION ALL SELECT * FROM carousels UNION ALL SELECT * FROM morning) x;
ROLLBACK;
