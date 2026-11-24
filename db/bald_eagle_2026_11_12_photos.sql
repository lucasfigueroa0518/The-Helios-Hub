-- Bald-Eagle 2026-11-12, D9 (Tommy: "yes"): the photo bank first, for every content type.
-- finder_source "first": the finder asks the bank before any online search, and searches online only when the bank
-- has too few photos that fit (lib/social/photos/find.ts, lib/social/photos/sources/bank.ts). Was "compete".
-- Idempotent: the row exists since db/media_library_schema.sql; the insert covers a database where it doesn't.
-- The hold on photos chosen by items waiting to post (D3) needs no schema change (lib/photos/pending.ts).

INSERT INTO media_library.settings (key, value, updated_at)
VALUES ('finder_source', '"first"'::jsonb, now())
ON CONFLICT (key) DO UPDATE
   SET value = excluded.value, updated_at = now()
 WHERE media_library.settings.value IS DISTINCT FROM excluded.value;
