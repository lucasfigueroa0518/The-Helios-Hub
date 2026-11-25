#!/usr/bin/env bash
# Creates a throwaway local Postgres 16 cluster with the full Helios schema for
# performance measurement. Local only: refuses any non-loopback DATABASE_URL.
#   perf/db/setup-local.sh            # init (if needed), start, create db, apply schema
#   PERF_PG_RESET=1 perf/db/setup-local.sh   # drop and recreate the database first
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
PGDATA="${PERF_PGDATA:-/var/lib/postgresql/perfdata}"
PORT="${PERF_PG_PORT:-54329}"
URL="postgresql://postgres@127.0.0.1:${PORT}/helios"
ADMIN="postgresql://postgres@127.0.0.1:${PORT}/postgres"

run_pg() { if [ "$(id -u)" = "0" ]; then su postgres -c "$*"; else bash -c "$*"; fi; }

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  mkdir -p "$PGDATA"; [ "$(id -u)" = "0" ] && chown postgres:postgres "$PGDATA"
  run_pg "$PG_BIN/initdb -D $PGDATA -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null"
  cat >> "$PGDATA/postgresql.conf" <<CONF
listen_addresses = '127.0.0.1'
port = ${PORT}
shared_preload_libraries = 'pg_stat_statements'
pg_stat_statements.track = all
log_min_duration_statement = 100
logging_collector = on
log_directory = 'log'
shared_buffers = 512MB
max_connections = 200
CONF
fi
if ! "$PG_BIN/pg_isready" -h 127.0.0.1 -p "$PORT" -q; then
  run_pg "$PG_BIN/pg_ctl -D $PGDATA -l $PGDATA/startup.log start -w >/dev/null"
fi
if [ "${PERF_PG_RESET:-0}" = "1" ]; then
  psql "$ADMIN" -q -c "DROP DATABASE IF EXISTS helios WITH (FORCE);"
fi
psql "$ADMIN" -Atqc "SELECT 1 FROM pg_database WHERE datname='helios'" | grep -q 1 || psql "$ADMIN" -q -c "CREATE DATABASE helios;"

cd "$ROOT"
psql "$URL" -q -v ON_ERROR_STOP=1 -f perf/db/supabase-shim.sql
ORDER="bootstrap outreach_schema drafting_schema reply_schema reply_multiturn_schema
migrate_duration_aware_timeliness_v2 migrate_draft_generation_mode migrate_expansion_step_ladder
drafting_drop_needs_human prior_enrichment_decision cost_ledger_schema orchestration_schema
analytics_schema dashboards_schema networking_schema seo_schema trello_schema smartlead_schema
reels_schema explainers_schema social_schema lfd_schema memes_schema social_hub_schema stories_schema
stories_multi_slot real_case_schema ai_events_schema revisions_schema reel_ai_drama_schema
media_library_schema field_notes_schema intake_schema reels_intake_views social_used_photos_v2
stories_ai_trivia stories_real_or_ai stories_split stories_pool_archive media_library_stories_split
intake_stories_split bald_eagle_2026_11_12_leadtime bald_eagle_2026_11_12_leadtime_reels
bald_eagle_2026_11_12_md bald_eagle_2026_11_12_photos"
for f in $ORDER; do
  psql "$URL" -q -v ON_ERROR_STOP=1 -f "db/$f.sql" >/dev/null 2>"/tmp/perf-schema-$f.err" || { echo "schema $f failed:"; cat "/tmp/perf-schema-$f.err"; exit 1; }
done
psql "$URL" -q -v ON_ERROR_STOP=1 -v drafting_data_schema=outreach -v drafting_function_schema=public \
  -f db/drafting_cost_persistence.sql >/dev/null 2>/tmp/perf-schema-cost.err || { cat /tmp/perf-schema-cost.err; exit 1; }
# Additive perf migrations from this branch (db/perf_*.sql, not the *_down rollbacks).
if compgen -G "db/perf_*.sql" >/dev/null; then
  for f in $(ls db/perf_*.sql | grep -v _down); do psql "$URL" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null; done
fi
echo "local schema ready: $URL"
