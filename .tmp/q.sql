BEGIN READ ONLY;
SELECT rank, selected, on_latest, made_on_latest, copy_missed, round(net::numeric,2) FROM (
WITH latest AS (
  SELECT id, scored_at FROM reels.score_slates ORDER BY scored_at DESC LIMIT 1
),
-- A person's typed-in ideas (design 2026-10-26-text-on-screen-seeding): sources marked adapter 'seed', theirs for a week.
seeds AS (
  SELECT m.post_idea_id, so.ingest_time, (so.ingest_time > now() - interval '7 days') AS open
    FROM reels.post_idea_members m
    JOIN reels.sources so ON so.id = m.source_id
   WHERE so.adapter_id = 'seed' AND so.drop_reason = 'seed'
),
pool AS (
  SELECT s.post_idea_id, s.net, s.rank, s.selected, s.origin, latest.scored_at AS scored_at, true AS on_latest,
         s.psychology, s.bucket_score, s.value_score, s.blockbuster, s.chosen_bucket, s.chosen_framework, s.components,
         false AS unscored
    FROM latest
    JOIN reels.idea_scores s ON s.slate_id = latest.id
   WHERE NOT EXISTS (SELECT 1 FROM seeds x WHERE x.post_idea_id = s.post_idea_id AND NOT x.open)
  UNION ALL
  -- A seed whose score row is on an older slate (or that has none yet) still shows, with its newest stored score.
  SELECT x.post_idea_id, o.net, o.rank, COALESCE(o.selected, false), o.origin, COALESCE(o.scored_at, x.ingest_time), false,
         o.psychology, o.bucket_score, o.value_score, o.blockbuster, o.chosen_bucket, o.chosen_framework, o.components,
         (o.post_idea_id IS NULL) AS unscored
    FROM seeds x
    LEFT JOIN LATERAL (
      SELECT s2.*, ss2.scored_at
        FROM reels.idea_scores s2 JOIN reels.score_slates ss2 ON ss2.id = s2.slate_id
       WHERE s2.post_idea_id = x.post_idea_id
       ORDER BY ss2.scored_at DESC LIMIT 1
    ) o ON true
   WHERE x.open
     AND NOT EXISTS (SELECT 1 FROM reels.idea_scores s3 JOIN latest ON s3.slate_id = latest.id WHERE s3.post_idea_id = x.post_idea_id)
)
SELECT s.post_idea_id, src.headline, s.net, s.rank, s.selected, s.origin, s.scored_at::text AS scored_at,
       s.psychology, s.bucket_score, s.value_score, s.blockbuster, s.chosen_bucket, s.chosen_framework, s.components,
       ps.published,
       EXISTS (SELECT 1 FROM seeds x WHERE x.post_idea_id = s.post_idea_id) AS yours,
       s.unscored,
       EXISTS (SELECT 1 FROM social_hub.schedule x
                WHERE x.vertical = 'reels' AND x.idea_ref = s.post_idea_id::text AND x.status IN ('scheduled', 'publishing')) AS scheduled,
       s.on_latest,
       -- The last run's own work on it (Lucas, 2026-10-26: the run's picks lead the queue; a skip says why).
       EXISTS (SELECT 1 FROM reels.video_jobs j JOIN latest ON j.slate_id = latest.id WHERE j.post_idea_id = s.post_idea_id AND j.status = 'ok') AS made_on_latest,
       (EXISTS (SELECT 1 FROM reels.idea_copy c JOIN latest ON c.slate_id = latest.id WHERE c.post_idea_id = s.post_idea_id AND c.status <> 'ok')
        AND NOT EXISTS (SELECT 1 FROM reels.idea_copy c JOIN latest ON c.slate_id = latest.id WHERE c.post_idea_id = s.post_idea_id AND c.status = 'ok')) AS copy_missed,
       EXISTS (SELECT 1 FROM reels.video_jobs j WHERE j.post_idea_id = s.post_idea_id AND j.status = 'ok') AS has_video,
       (SELECT count(*)::int FROM reels.video_jobs j WHERE j.post_idea_id = s.post_idea_id AND j.status = 'ok') AS video_count,
       (SELECT max(j.finished_at)::text FROM reels.video_jobs j WHERE j.post_idea_id = s.post_idea_id AND j.status = 'ok') AS last_video_at
  FROM pool s
  LEFT JOIN reels.published_status ps ON ps.post_idea_id = s.post_idea_id
  LEFT JOIN LATERAL (
    SELECT so.headline
      FROM reels.post_idea_members m
      JOIN reels.sources so ON so.id = m.source_id
     WHERE m.post_idea_id = s.post_idea_id
     ORDER BY CASE m.role WHEN 'primary' THEN 0 WHEN 'supporting' THEN 1 ELSE 2 END, m.joined_at
     LIMIT 1
  ) src ON true
 ORDER BY s.rank NULLS LAST, s.net DESC NULLS LAST
 LIMIT 200) z WHERE selected OR rank <= 5 OR copy_missed ORDER BY rank NULLS LAST;
ROLLBACK;
