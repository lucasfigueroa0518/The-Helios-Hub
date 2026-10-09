#!/usr/bin/env bash
# Create (or reuse) the social worker VM: every Helios Social worker (Trial
# Reels, Carousels, Explainers, IG Stories) runs here; outreach stays alone on
# helios-orch-worker. See docs/social-overnight.md.
#
#   ./scripts/gcp/provision-social-worker.sh
#
# Then ship code with ./scripts/gcp/deploy-social-worker.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

PROJECT="${GCP_PROJECT:-helios-influencer-network}"
ZONE="${GCP_ZONE:-us-west1-a}"
INSTANCE="${SOCIAL_INSTANCE:-helios-social-worker}"
MACHINE="${SOCIAL_MACHINE_TYPE:-e2-medium}"

command -v gcloud >/dev/null 2>&1 || { echo "gcloud not found. brew install --cask google-cloud-sdk, then gcloud auth login"; exit 1; }

echo "Project=${PROJECT} Zone=${ZONE} Instance=${INSTANCE} Machine=${MACHINE}"

if gcloud compute instances describe "${INSTANCE}" --zone="${ZONE}" --project="${PROJECT}" >/dev/null 2>&1; then
  echo "Instance ${INSTANCE} already exists — skipping create."
else
  gcloud compute instances create "${INSTANCE}" \
    --project="${PROJECT}" \
    --zone="${ZONE}" \
    --machine-type="${MACHINE}" \
    --image-family=ubuntu-2204-lts \
    --image-project=ubuntu-os-cloud \
    --boot-disk-size=30GB \
    --boot-disk-type=pd-standard \
    --tags=helios-social-worker \
    --scopes=cloud-platform \
    --metadata=enable-oslogin=TRUE
fi

echo "Waiting for SSH…"
for _ in $(seq 1 30); do
  if gcloud compute ssh "${INSTANCE}" --zone="${ZONE}" --project="${PROJECT}" --command='echo ok' >/dev/null 2>&1; then
    break
  fi
  sleep 5
done

gcloud compute scp --zone="${ZONE}" --project="${PROJECT}" \
  scripts/gcp/remote-bootstrap-social.sh "${INSTANCE}:/tmp/"
gcloud compute ssh "${INSTANCE}" --zone="${ZONE}" --project="${PROJECT}" \
  --command='sudo bash /tmp/remote-bootstrap-social.sh'

echo "VM ready. Next: ./scripts/gcp/deploy-social-worker.sh"
