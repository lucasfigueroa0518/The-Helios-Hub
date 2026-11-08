-- One-time cleanup, local copy 2026-11-03 (Lucas). Retired reels leave the pool, the night's picks and coverage;
-- nothing is deleted. Undo: UPDATE topics back to the status saved in explainers.retired_topics_2026_11_03.
-- Job seqs are the local database's: map them to production's jobs before replaying there.
BEGIN;
ALTER TABLE explainers.topics DROP CONSTRAINT IF EXISTS topics_status_check;
ALTER TABLE explainers.topics ADD CONSTRAINT topics_status_check CHECK (status IN (
    'proposed', 'pool', 'rejected', 'displaced', 'promoted', 'queued', 'rendered', 'archived', 'retired'));
CREATE TABLE IF NOT EXISTS explainers.retired_topics_2026_11_03 AS
  SELECT t.id, t.title, t.status AS previous_status FROM explainers.topics t
   WHERE t.status IN ('rendered', 'archived') AND t.rendered_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM explainers.jobs j WHERE j.topic_id = t.id AND j.seq BETWEEN 80 AND 86)
     AND NOT EXISTS (SELECT 1 FROM explainers.jobs j
                       JOIN social_hub.content_items ci ON ci.vertical = 'explainers' AND ci.native_ref = j.id::text
                       JOIN social_hub.publish_attempts pa ON pa.content_item_id = ci.id
                      WHERE j.topic_id = t.id AND pa.status = 'published');
UPDATE explainers.topics t SET status = 'retired', updated_at = now()
  FROM explainers.retired_topics_2026_11_03 r WHERE r.id = t.id;
INSERT INTO social_hub.content_items (vertical, format, native_ref, idea_ref)
  SELECT 'explainers', 'reel', j.id::text, j.topic_id::text FROM explainers.jobs j WHERE j.seq IN (85, 86)
  ON CONFLICT (vertical, native_ref) DO NOTHING;
INSERT INTO social_hub.approvals (content_item_id, decision, via, decided_by)
  SELECT ci.id, 'approved', 'user', 'lucas' FROM social_hub.content_items ci
    JOIN explainers.jobs j ON ci.vertical = 'explainers' AND ci.native_ref = j.id::text WHERE j.seq IN (85, 86)
  ON CONFLICT (content_item_id) DO UPDATE SET decision = 'approved', via = 'user', decided_by = 'lucas', decided_at = now();
COMMIT;

-- Rejected topics that still have a finished video (they stayed on the bench under their own name).
BEGIN;
INSERT INTO explainers.retired_topics_2026_11_03 (id, title, previous_status)
  SELECT t.id, t.title, t.status FROM explainers.topics t
   WHERE t.status = 'rejected' AND EXISTS (
     SELECT 1 FROM explainers.jobs j JOIN explainers.artifacts a ON a.job_id = j.id AND a.kind = 'video' WHERE j.topic_id = t.id AND j.status = 'ok');
UPDATE explainers.topics t SET status = 'retired', updated_at = now()
  FROM explainers.retired_topics_2026_11_03 r WHERE r.id = t.id AND t.status = 'rejected';
COMMIT;

-- Lucas's review, 2026-11-03: runs 80-84 all cut, kept on disk.
BEGIN;
INSERT INTO explainers.retired_topics_2026_11_03 (id, title, previous_status)
  SELECT DISTINCT t.id, t.title, t.status FROM explainers.topics t JOIN explainers.jobs j ON j.topic_id = t.id
   WHERE j.seq BETWEEN 80 AND 84 AND t.status <> 'retired';
UPDATE explainers.topics t SET status = 'retired', updated_at = now()
  FROM explainers.retired_topics_2026_11_03 r WHERE r.id = t.id AND t.status <> 'retired';
COMMIT;

-- Lucas, 2026-11-03: the 4 remaining pool ideas came from older idea runs; removed too.
BEGIN;
INSERT INTO explainers.retired_topics_2026_11_03 (id, title, previous_status)
  SELECT id, title, status FROM explainers.topics WHERE status = 'pool';
UPDATE explainers.topics SET status = 'retired', updated_at = now() WHERE status = 'pool';
COMMIT;
