-- Resource Tracker RT-1: a SELECT-only login on the WEBSITE's Supabase (project uxyvaknayquzgsglktow), so the
-- hub can read "Are you smarter than AI?" stats. Run once in that project's SQL editor, as postgres.
-- Replace the password first. Nothing here can write, and it sees only schema `game`.
--
-- Then set GAME_STATS_DATABASE_URL in the hub (Vercel Production + .env.local), using the transaction pooler:
--   postgresql://hub_game_reader.uxyvaknayquzgsglktow:<password>@<pooler host>:6543/postgres
-- (the pooler host is in Supabase → Connect → Transaction pooler).

CREATE ROLE hub_game_reader LOGIN PASSWORD 'CHANGE-ME-to-a-long-random-password' NOINHERIT;

GRANT USAGE ON SCHEMA game TO hub_game_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA game TO hub_game_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA game GRANT SELECT ON TABLES TO hub_game_reader;

-- The game tables have RLS on with no policies (the site uses the service role). A read policy for this role only:
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'game' LOOP
    EXECUTE format('DROP POLICY IF EXISTS hub_game_reader_select ON game.%I', t);
    EXECUTE format('CREATE POLICY hub_game_reader_select ON game.%I FOR SELECT TO hub_game_reader USING (true)', t);
  END LOOP;
END $$;
