#!/usr/bin/env bash
# Install or update the Explainer Reels worker on the shared GCP VM (BUILD_PLAN §6).
#
# NOT YET: Lucas's rule (2026-10-07) keeps Explainer Reels local until a run
# validates it. Run this only after that, once EXPLAINERS_DATABASE_URL points at a
# database the VM can reach.
#
# Unlike deploy-worker-code.sh, this NEVER writes to /opt/helios-worker/app: that
# directory belongs to the outreach and Reels workers, and shipping this branch
# there would replace their code. Everything here lives under /opt/helios-explainers.
#
#   ./scripts/gcp/deploy-explainers-worker.sh
#
# Secrets: Lucas creates /opt/helios-explainers/worker.env on the VM himself
# (EXPLAINERS_DATABASE_URL, ANTHROPIC_API_KEY, HEYGEN_API_KEY, TYPESAFE_API_KEY).
# This script checks the names exist and never reads or prints the values.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ -f scripts/gcp/.deploy-env ]]; then
  # shellcheck disable=SC1091
  source scripts/gcp/.deploy-env
fi

PROJECT="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
ZONE="${GCP_ZONE:-us-west1-a}"
INSTANCE="${GCP_INSTANCE:-helios-orch-worker}"
REMOTE_DIR="/opt/helios-explainers"

command -v gcloud >/dev/null 2>&1 || { echo "gcloud not found. See docs/gcp-e2-micro-worker.md"; exit 1; }
[[ -n "${PROJECT}" && "${PROJECT}" != "(unset)" ]] || { echo "GCP project unset."; exit 1; }

# Ship the working tree (the branch is not committed yet), minus local state and installs.
BUNDLE="$(mktemp -t helios-explainers-XXXXXX).tgz"
trap 'rm -f "$BUNDLE"' EXIT
tar -czf "$BUNDLE" \
  --exclude='node_modules' \
  --exclude='explainers/smoke/.out' \
  --exclude='.explainers-local' \
  package.json package-lock.json tsconfig.json \
  lib db scripts explainers
echo "Bundle: $(du -h "$BUNDLE" | cut -f1) → ${INSTANCE}:${REMOTE_DIR}"

gcloud compute scp --zone="${ZONE}" --project="${PROJECT}" "$BUNDLE" "${INSTANCE}:/tmp/helios-explainers.tgz"
gcloud compute scp --zone="${ZONE}" --project="${PROJECT}" scripts/gcp/helios-explainers.service "${INSTANCE}:/tmp/helios-explainers.service"

gcloud compute ssh "${INSTANCE}" --zone="${ZONE}" --project="${PROJECT}" --command="
  set -euo pipefail
  REMOTE_DIR='${REMOTE_DIR}'
  case \"\$REMOTE_DIR\" in /opt/helios-worker*) echo 'refusing to deploy into /opt/helios-worker' >&2; exit 1;; esac

  node_major=\$(node -p 'process.versions.node.split(\".\")[0]')
  [[ \$node_major -ge 22 ]] || { echo \"Node 22+ required (found \$(node -v))\" >&2; exit 1; }
  command -v ffmpeg >/dev/null || { echo 'ffmpeg missing' >&2; exit 1; }
  echo \"ffmpeg: \$(ffmpeg -version | head -1)\"
  # Linux sandbox for the agent's Bash commands (Agent SDK sandbox.failIfUnavailable).
  command -v bwrap >/dev/null && command -v socat >/dev/null || {
    echo 'bubblewrap and socat are required for the agent sandbox: sudo apt-get install -y bubblewrap socat' >&2; exit 1; }

  sudo mkdir -p \"\$REMOTE_DIR/app\"
  sudo chown -R \"\$(id -un)\" \"\$REMOTE_DIR\"
  [[ -f \"\$REMOTE_DIR/worker.env\" ]] || { echo \"Create \$REMOTE_DIR/worker.env first (see this script's header).\" >&2; exit 1; }
  for key in EXPLAINERS_DATABASE_URL ANTHROPIC_API_KEY HEYGEN_API_KEY TYPESAFE_API_KEY; do
    grep -q \"^\$key=\" \"\$REMOTE_DIR/worker.env\" || { echo \"\$key missing from worker.env\" >&2; exit 1; }
  done

  rm -rf \"\$REMOTE_DIR/app.next\" && mkdir -p \"\$REMOTE_DIR/app.next\"
  tar -xzf /tmp/helios-explainers.tgz -C \"\$REMOTE_DIR/app.next\"
  (cd \"\$REMOTE_DIR/app.next\" && npm ci --no-audit --no-fund && cd explainers/runtime && npm ci --no-audit --no-fund)
  # Chrome for HyperFrames renders.
  (cd \"\$REMOTE_DIR/app.next/explainers/runtime\" && HYPERFRAMES_NO_TELEMETRY=1 npx --no-install hyperframes browser ensure || true)
  rm -rf \"\$REMOTE_DIR/app.prev\"
  [[ -d \"\$REMOTE_DIR/app\" ]] && mv \"\$REMOTE_DIR/app\" \"\$REMOTE_DIR/app.prev\"
  mv \"\$REMOTE_DIR/app.next\" \"\$REMOTE_DIR/app\"

  sudo cp /tmp/helios-explainers.service /etc/systemd/system/helios-explainers.service
  sudo systemctl daemon-reload
  sudo systemctl enable helios-explainers
  sudo systemctl restart helios-explainers
  sudo systemctl --no-pager --full status helios-explainers || true
"

echo "helios-explainers installed on ${INSTANCE} under ${REMOTE_DIR} (outreach and Reels untouched)."
