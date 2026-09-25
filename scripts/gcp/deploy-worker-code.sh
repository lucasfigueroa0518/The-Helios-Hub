#!/usr/bin/env bash
# Push latest repo code to the always-on GCP worker and restart.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# Prefer checked-in local deploy coords (gitignored) over shell defaults.
if [[ -f scripts/gcp/.deploy-env ]]; then
  # shellcheck disable=SC1091
  source scripts/gcp/.deploy-env
fi

PROJECT="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
ZONE="${GCP_ZONE:-us-west1-a}"
INSTANCE="${GCP_INSTANCE:-helios-orch-worker}"
ENV_FILE="${WORKER_ENV_FILE:-scripts/gcp/worker.env}"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud not found. See docs/gcp-e2-micro-worker.md"
  exit 1
fi

if [[ -z "${PROJECT}" || "${PROJECT}" == "(unset)" ]]; then
  echo "GCP project unset. Set GCP_PROJECT or run gcloud config set project …"
  exit 1
fi

echo "Deploying worker code → ${INSTANCE} (${ZONE}, project ${PROJECT})"

# Fail fast if the Anthropic key in worker.env is missing/disabled — otherwise
# every user's drafting research fails with research_provider_error in production.
if [[ -f "${ENV_FILE}" ]]; then
  ANTHROPIC_API_KEY="$(
    node -e '
      const fs = require("fs");
      const text = fs.readFileSync(process.argv[1], "utf8");
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^ANTHROPIC_API_KEY=(.*)$/);
        if (!m) continue;
        let v = m[1].trim();
        if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'\''") && v.endsWith("'\''"))) {
          v = v.slice(1, -1);
        }
        process.stdout.write(v);
        process.exit(0);
      }
    ' "${ENV_FILE}"
  )"
  if [[ -z "${ANTHROPIC_API_KEY}" ]]; then
    echo "ERROR: ANTHROPIC_API_KEY missing in ${ENV_FILE}" >&2
    exit 1
  fi
  PROBE_STATUS="$(
    curl -sS -o /tmp/helios-anthropic-probe.json -w '%{http_code}' \
      https://api.anthropic.com/v1/messages \
      -H "content-type: application/json" \
      -H "x-api-key: ${ANTHROPIC_API_KEY}" \
      -H "anthropic-version: 2023-06-01" \
      -d '{"model":"claude-haiku-4-5-20251001","max_tokens":1,"messages":[{"role":"user","content":"ping"}]}' \
      || true
  )"
  if [[ "${PROBE_STATUS}" != "200" ]]; then
    echo "ERROR: ANTHROPIC_API_KEY probe failed (HTTP ${PROBE_STATUS})." >&2
    echo "Sync a working key from .env.local into ${ENV_FILE}, then redeploy." >&2
    head -c 400 /tmp/helios-anthropic-probe.json 2>/dev/null || true
    echo >&2
    exit 1
  fi
  echo "Anthropic key probe ok."
fi

ARCHIVE="$(mktemp -t helios-worker-XXXXXX).tgz"
trap 'rm -f "${ARCHIVE}"' EXIT
tar -czf "${ARCHIVE}" \
  --exclude='./.git' \
  --exclude='./node_modules' \
  --exclude='./.next' \
  --exclude='./.env.local' \
  --exclude='./scripts/gcp/worker.env' \
  --exclude='./.cursor' \
  --exclude='./helios_text_engine/.venv' \
  .

gcloud compute scp --zone="${ZONE}" --project="${PROJECT}" \
  "${ARCHIVE}" "${INSTANCE}:/tmp/helios-app.tgz"

gcloud compute scp --zone="${ZONE}" --project="${PROJECT}" \
  scripts/gcp/helios-worker.service "${INSTANCE}:/tmp/helios-worker.service"

if [[ -f "${ENV_FILE}" ]]; then
  gcloud compute scp --zone="${ZONE}" --project="${PROJECT}" \
    "${ENV_FILE}" "${INSTANCE}:/tmp/worker.env"
  gcloud compute scp --zone="${ZONE}" --project="${PROJECT}" \
    scripts/gcp/merge-higgsfield-env.py "${INSTANCE}:/tmp/merge-higgsfield-env.py"
fi

gcloud compute ssh "${INSTANCE}" --zone="${ZONE}" --project="${PROJECT}" --command="
  set -euo pipefail
  sudo rm -rf /opt/helios-worker/app
  sudo mkdir -p /opt/helios-worker/app
  sudo tar -xzf /tmp/helios-app.tgz -C /opt/helios-worker/app
  if [[ -f /tmp/merge-higgsfield-env.py && -f /tmp/worker.env && -f /opt/helios-worker/worker.env ]]; then
    sudo python3 /tmp/merge-higgsfield-env.py /opt/helios-worker/worker.env /tmp/worker.env
  fi
  if [[ -f /tmp/worker.env ]]; then
    sudo mv /tmp/worker.env /opt/helios-worker/worker.env
    sudo chmod 600 /opt/helios-worker/worker.env
  fi
  sudo cp /tmp/helios-worker.service /etc/systemd/system/helios-worker.service
  sudo systemctl daemon-reload
  cd /opt/helios-worker/app
  # --help succeeds even when ensurepip is missing, so try the real create.
  if ! sudo python3 -m venv helios_text_engine/.venv; then
    sudo apt-get update -qq
    sudo apt-get install -y python3-venv
    sudo rm -rf helios_text_engine/.venv
    sudo python3 -m venv helios_text_engine/.venv
  fi
  sudo helios_text_engine/.venv/bin/pip install -q pillow numpy
  if ! command -v ffmpeg >/dev/null 2>&1; then
    sudo apt-get update -qq
    sudo apt-get install -y ffmpeg
  fi
  sudo npm ci
  sudo systemctl restart helios-worker
  sudo systemctl --no-pager --full status helios-worker || true
  if [[ -f /etc/systemd/system/helios-reels.service ]]; then
    sudo systemctl restart helios-reels
    sudo systemctl --no-pager --full status helios-reels || true
  fi
"

echo "Deployed to ${INSTANCE}."
