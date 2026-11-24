-- Archive the abandoned v1 social schema `helios_social`, then drop it (Tommy + Lucas, 2026-11-19).
-- Nothing in the code read it (docs/superpowers/specs/2026-10-08-social-storage.md: "dropping it is Tommy's call").
-- Every row of every table is kept as JSON in archive.helios_social_v1; the four empty tables leave only their names.
-- Restore a table: SELECT (jsonb_populate_record(NULL::<recreated table>, row)).* FROM archive.helios_social_v1 WHERE source_table = '<name>';
BEGIN;
CREATE SCHEMA IF NOT EXISTS archive;
REVOKE ALL ON SCHEMA archive FROM PUBLIC;
CREATE TABLE IF NOT EXISTS archive.helios_social_v1 (
  source_table text NOT NULL,
  row jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO archive.helios_social_v1 (source_table, row) SELECT 'article_queue', to_jsonb(t) FROM helios_social.article_queue t;
INSERT INTO archive.helios_social_v1 (source_table, row) SELECT 'image_cache', to_jsonb(t) FROM helios_social.image_cache t;
INSERT INTO archive.helios_social_v1 (source_table, row) SELECT 'posts', to_jsonb(t) FROM helios_social.posts t;
INSERT INTO archive.helios_social_v1 (source_table, row) SELECT 'post_assets', to_jsonb(t) FROM helios_social.post_assets t;
INSERT INTO archive.helios_social_v1 (source_table, row) SELECT 'post_slides', to_jsonb(t) FROM helios_social.post_slides t;
INSERT INTO archive.helios_social_v1 (source_table, row) SELECT 'judge_shadow_ledger', to_jsonb(t) FROM helios_social.judge_shadow_ledger t;
DO $$
BEGIN
  IF (SELECT count(*) FROM archive.helios_social_v1) <>
     (SELECT (SELECT count(*) FROM helios_social.article_queue) + (SELECT count(*) FROM helios_social.image_cache)
           + (SELECT count(*) FROM helios_social.posts) + (SELECT count(*) FROM helios_social.post_assets)
           + (SELECT count(*) FROM helios_social.post_slides) + (SELECT count(*) FROM helios_social.judge_shadow_ledger))
  THEN RAISE EXCEPTION 'archive row count mismatch; nothing dropped';
  END IF;
END $$;
DROP SCHEMA helios_social CASCADE;
COMMIT;
