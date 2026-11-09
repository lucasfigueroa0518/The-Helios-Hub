#!/usr/bin/env bash
# One-time setup for a Claude Code cloud session working on Reel AI Drama (planning/AI Mini Docs/CLOUD.md).
# Idempotent: safe to run again. Installs the tools, starts a local Postgres, loads the database snapshot
# from db/cloud-seed/, and writes .env.local from the cloud environment's variables.
#
#   bash scripts/cloud-setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

need() { command -v "$1" >/dev/null 2>&1; }
SUDO=$(need sudo && echo sudo || echo "")

echo "== system packages (postgres, ffmpeg, python)"
if need apt-get; then
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq postgresql postgresql-contrib ffmpeg python3-pip unzip curl >/dev/null
fi

echo "== yt-dlp"
need yt-dlp || python3 -m pip install -q --user -U yt-dlp || $SUDO python3 -m pip install -q -U --break-system-packages yt-dlp
export PATH="$HOME/.local/bin:$PATH"

echo "== Real-ESRGAN (optional: needs Vulkan; the harvest fails open without it)"
if ! need realesrgan-ncnn-vulkan; then
  dir="$HOME/.local/share/realesrgan"
  mkdir -p "$dir" "$HOME/.local/bin"
  if curl -fsSL -o /tmp/resr.zip https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-ubuntu.zip; then
    unzip -oq /tmp/resr.zip -d "$dir" && chmod +x "$dir/realesrgan-ncnn-vulkan"
    printf '#!/usr/bin/env bash\ncd %s && exec ./realesrgan-ncnn-vulkan -m models -n realesrgan-x4plus "$@"\n' "$dir" > "$HOME/.local/bin/realesrgan-ncnn-vulkan"
    chmod +x "$HOME/.local/bin/realesrgan-ncnn-vulkan"
  else
    echo "   (download failed; upscaling will be skipped and flagged)"
  fi
fi

echo "== node modules"
npm ci --no-audit --no-fund

echo "== local Postgres + database snapshot"
DB=helios_explainers
if need pg_ctlcluster; then $SUDO service postgresql start >/dev/null || true; fi
if ! $SUDO -u postgres psql -Atc "SELECT 1 FROM pg_roles WHERE rolname='helios'" | grep -q 1; then
  $SUDO -u postgres psql -qc "CREATE ROLE helios LOGIN SUPERUSER PASSWORD 'helios';"
fi
if ! $SUDO -u postgres psql -Atc "SELECT 1 FROM pg_database WHERE datname='$DB'" | grep -q 1; then
  $SUDO -u postgres createdb -O helios "$DB"
  URL="postgresql://helios:helios@127.0.0.1:5432/$DB"
  psql "$URL" -q -v ON_ERROR_STOP=0 -f db/cloud-seed/explainers_schema.sql >/dev/null
  psql "$URL" -q -v ON_ERROR_STOP=0 -f db/cloud-seed/explainers_settings.sql >/dev/null
  psql "$URL" -q -v ON_ERROR_STOP=0 -f db/cloud-seed/reel_ai_drama.sql >/dev/null
  psql "$URL" -q -f db/reel_ai_drama_schema.sql >/dev/null
fi
EXPLAINERS_DATABASE_URL="postgresql://helios:helios@127.0.0.1:5432/$DB"

echo "== .env.local from the cloud environment's variables"
# The cloud runtime sets ANTHROPIC_* for Claude Code itself, so the app's key travels as HELIOS_ANTHROPIC_API_KEY.
missing=()
{
  echo "EXPLAINERS_DATABASE_URL=$EXPLAINERS_DATABASE_URL"
  for pair in ANTHROPIC_API_KEY:HELIOS_ANTHROPIC_API_KEY HEYGEN_API_KEY:HEYGEN_API_KEY SERPER_API_KEY:SERPER_API_KEY OPENAI_API_KEY:OPENAI_API_KEY TYPESAFE_API_KEY:TYPESAFE_API_KEY; do
    name=${pair%%:*}; src=${pair##*:}
    if [ -n "${!src:-}" ]; then echo "$name=${!src}"; else missing+=("$src"); fi
  done
} > .env.local
chmod 600 .env.local

echo "== checks"
psql "$EXPLAINERS_DATABASE_URL" -Atc "BEGIN READ ONLY; SELECT 'pitches', count(*) FROM reel_ai_drama.pitches; SELECT 'voice_id set', count(*) FROM explainers.settings WHERE key='voice_id'; ROLLBACK;" | grep -v -e BEGIN -e ROLLBACK
for t in node ffmpeg ffprobe yt-dlp psql; do need "$t" && echo "ok  $t" || echo "MISSING $t"; done
need realesrgan-ncnn-vulkan && echo "ok  realesrgan (may still lack Vulkan)" || echo "skip realesrgan"
if [ ${#missing[@]} -gt 0 ]; then echo "MISSING env vars (live runs need them): ${missing[*]}"; else echo "ok  all API keys present"; fi
echo "Live runs: env -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN npx tsx scripts/reel_ai_drama_worker.ts …"
