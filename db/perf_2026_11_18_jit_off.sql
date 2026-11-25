-- D6: turn Postgres JIT off for this database (reversible: db/perf_2026_11_18_jit_off_down.sql).
-- JIT compiled the hub's heaviest statements for longer than they ran (perf/slow-queries.md:
-- 627 of 632 ms, 160 of 161 ms). PostgreSQL's upstream default is now off.
-- Only after `SHOW jit` (perf/db/prod-diagnose.sql section 1) says on, and only by the owner.
-- It applies to new server sessions: pooled connections pick it up as the pooler recycles
-- them (Supabase dashboard -> restart the pooler to apply at once).
ALTER DATABASE postgres SET jit = off;
