#!/usr/bin/env bash
# Install or update the Trial Reels nightly worker on the always-on GCP VM.
#
# The Reels worker shares the VM and the code directory with helios-worker but
# runs as its own systemd unit (D-017), so deploying app code with
# deploy-worker-code.sh is what updates the files; this script owns the unit.
#
# Run deploy-worker-code.sh first, then this one.
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

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud not found. See docs/gcp-e2-micro-worker.md"
  exit 1
fi

if [[ -z "${PROJECT}" || "${PROJECT}" == "(unset)" ]]; then
  echo "GCP project unset. Set GCP_PROJECT or run gcloud config set project …"
  exit 1
fi

echo "Installing helios-reels unit → ${INSTANCE} (${ZONE}, project ${PROJECT})"

gcloud compute scp --zone="${ZONE}" --project="${PROJECT}" \
  scripts/gcp/helios-reels.service "${INSTANCE}:/tmp/helios-reels.service"

gcloud compute ssh "${INSTANCE}" --zone="${ZONE}" --project="${PROJECT}" --command="
  set -euo pipefail
  if [[ ! -d /opt/helios-worker/app ]]; then
    echo 'App directory missing. Run ./scripts/gcp/deploy-worker-code.sh first.' >&2
    exit 1
  fi
  if ! grep -q TYPESAFE_API_KEY /opt/helios-worker/worker.env; then
    echo 'TYPESAFE_API_KEY missing from worker.env. Add it and redeploy worker env first.' >&2
    exit 1
  fi
  sudo cp /tmp/helios-reels.service /etc/systemd/system/helios-reels.service
  sudo systemctl daemon-reload
  sudo systemctl enable helios-reels
  sudo systemctl restart helios-reels
  sudo systemctl --no-pager --full status helios-reels || true
"

echo "helios-reels installed on ${INSTANCE}."
