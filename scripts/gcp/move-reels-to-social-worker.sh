#!/usr/bin/env bash
# One-time cutover: move the Trial Reels worker from helios-orch-worker to
# helios-social-worker. Never both running: the old unit is stopped and
# disabled before the new one starts.
#
# Run between 9 PM and midnight New York time, when no posting slot, night run,
# or song ingest is due (docs/social-overnight.md).
#
#   ./scripts/gcp/provision-social-worker.sh      # once, first
#   ./scripts/gcp/move-reels-to-social-worker.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

PROJECT="${GCP_PROJECT:-helios-influencer-network}"
ZONE="${GCP_ZONE:-us-west1-a}"
OLD="${GCP_INSTANCE:-helios-orch-worker}"
NEW="${SOCIAL_INSTANCE:-helios-social-worker}"

command -v gcloud >/dev/null 2>&1 || { echo "gcloud not found."; exit 1; }

# 1. Carry the reels secrets over. The file passes through a private temp dir
#    on this machine and is deleted on exit.
TMPDIR_ENV="$(mktemp -d)"
chmod 700 "${TMPDIR_ENV}"
trap 'rm -rf "${TMPDIR_ENV}"' EXIT
gcloud compute ssh "${OLD}" --zone="${ZONE}" --project="${PROJECT}" \
  --command='sudo cat /opt/helios-worker/worker.env' > "${TMPDIR_ENV}/worker.env"
[[ -s "${TMPDIR_ENV}/worker.env" ]] || { echo "Could not read worker.env from ${OLD}" >&2; exit 1; }

# 2. Ship code + the helios-reels unit to the new VM (installed, not started).
SOCIAL_UNITS=helios-reels SOCIAL_WORKER_ENV_FILE="${TMPDIR_ENV}/worker.env" \
  ./scripts/gcp/deploy-social-worker.sh

# 3. Stop the old one first.
gcloud compute ssh "${OLD}" --zone="${ZONE}" --project="${PROJECT}" --command='
  sudo systemctl disable --now helios-reels
  systemctl is-active helios-reels || true
'

# 4. Start it on the new VM.
gcloud compute ssh "${NEW}" --zone="${ZONE}" --project="${PROJECT}" --command='
  sudo systemctl enable --now helios-reels
  sleep 3
  sudo systemctl --no-pager status helios-reels | head -8
  sudo journalctl -u helios-reels -n 20 --no-pager
'

echo "Trial Reels now runs on ${NEW}; helios-reels is disabled on ${OLD}."
