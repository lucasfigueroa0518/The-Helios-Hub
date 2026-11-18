#!/usr/bin/env bash
# Source this file to point the app at the local measurement database.
# Every value here is local-only. No real keys: with ANTHROPIC_API_KEY unset and
# the stub modes below, no request can reach a paid API (CLAUDE.md Rule 1).
PERF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$PERF_DIR/.local"
export PERF_PG_PORT="${PERF_PG_PORT:-54329}"
export DATABASE_URL="${PERF_DATABASE_URL:-postgresql://postgres@127.0.0.1:${PERF_PG_PORT}/helios}"
export DIRECT_DATABASE_URL="$DATABASE_URL"
# Throwaway signing key for locally minted test sessions; regenerated per machine.
if [ -z "${AUTH_SECRET:-}" ]; then
  if [ ! -s "$PERF_DIR/.local/auth_secret" ]; then
    node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))" > "$PERF_DIR/.local/auth_secret"
  fi
  export AUTH_SECRET="$(cat "$PERF_DIR/.local/auth_secret")"
fi
export AUTH_URL="${AUTH_URL:-http://127.0.0.1:${PERF_APP_PORT:-3100}}"
export AUTH_TRUST_HOST=true
export ALLOWED_EMAIL_DOMAINS="${ALLOWED_EMAIL_DOMAINS:-heliosgroup.ai}"
export GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-perf-local}"
export GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-perf-local}"
export EXTRACTION_MODE=stub
export DRAFTING_MODE=stub
export ORCHESTRATOR=off
# Explainer Reels read the shared pool, as in production (lib/explainers/connection.ts).
export EXPLAINERS_DB=supabase
unset EXPLAINERS_DATABASE_URL
unset ANTHROPIC_API_KEY ANTHROPIC_ADMIN_API_KEY OPENAI_API_KEY FAL_API_KEY TYPESAFE_API_KEY HF_TOKEN
export NEXT_TELEMETRY_DISABLED=1
# Local-only bearer for /api/public/trivia-game/days (routes.json sample.headers).
export HUB_GAME_EXPORT_TOKEN=perf-local-game-export-token
