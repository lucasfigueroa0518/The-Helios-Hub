#!/usr/bin/env bash
# Ship repo code to the social worker VM and (re)install its systemd units.
# The social VM owns /opt/helios-social; it never touches helios-orch-worker.
#
#   ./scripts/gcp/deploy-social-worker.sh
#
# Units: every scripts/gcp/<name>.service listed in SOCIAL_UNITS is copied in.
# The default is all four social units: every one runs from /opt/helios-social/app,
# which this script replaces, so leaving one out strands it on a deleted folder (D34).
# A unit is restarted only if it is already enabled on the VM, so a new unit
# stays off until someone runs `sudo systemctl enable --now <name>` there.
#
# Secrets: /opt/helios-social/worker.env lives on the VM. Pass
# SOCIAL_WORKER_ENV_FILE=path to replace it; otherwise it is left alone.
#
# Guards (each restart kills whatever a worker is doing):
#   - refuses while a run, job or build is in flight (read from DATABASE_URL in
#     .env.local); FORCE_DEPLOY=1 deploys anyway
#   - refuses with uncommitted changes to tracked files, since the whole working
#     tree ships; ALLOW_DIRTY=1 deploys them anyway
# The units are stopped before /opt/helios-social/app is replaced and started
# after the install, so no worker runs from a half-installed folder.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

PROJECT="${GCP_PROJECT:-helios-influencer-network}"
ZONE="${GCP_ZONE:-us-west1-a}"
INSTANCE="${SOCIAL_INSTANCE:-helios-social-worker}"
UNITS="${SOCIAL_UNITS:-helios-reels helios-social helios-explainers helios-stories helios-publisher}"
ENV_FILE="${SOCIAL_WORKER_ENV_FILE:-}"
IAP=""
if [[ "${GCP_SSH_IAP:-}" == "1" ]]; then
  IAP="--tunnel-through-iap"
fi

command -v gcloud >/dev/null 2>&1 || { echo "gcloud not found. brew install --cask google-cloud-sdk, then gcloud auth login"; exit 1; }

if [[ "${ALLOW_DIRTY:-}" != "1" ]] && [[ -n "$(git status --porcelain --untracked-files=no 2>/dev/null)" ]]; then
  echo "Uncommitted changes to tracked files would ship to the VM:" >&2
  git status --short --untracked-files=no >&2
  echo "Commit them first, or run with ALLOW_DIRTY=1 to deploy them anyway." >&2
  exit 1
fi

if [[ "${FORCE_DEPLOY:-}" != "1" ]]; then
  DB_URL="$(grep -E '^DATABASE_URL=' .env.local 2>/dev/null | head -1 | cut -d= -f2- | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//' || true)"
  if [[ -n "${DB_URL}" ]] && command -v psql >/dev/null 2>&1; then
    INFLIGHT="$(psql "${DB_URL}" -Atc "
      SELECT 'carousel run ' || id FROM social.runs WHERE status = 'running'
      UNION ALL SELECT 'reels run ' || id FROM reels.runs WHERE status = 'running'
      UNION ALL SELECT 'reels copy job ' || id FROM reels.copy_jobs WHERE status = 'running'
      UNION ALL SELECT 'reels visual job ' || id FROM reels.visual_jobs WHERE status = 'running'
      UNION ALL SELECT 'reels video job ' || id FROM reels.video_jobs WHERE status = 'running'
      UNION ALL SELECT 'explainer job ' || id FROM explainers.jobs WHERE status = 'running'
      UNION ALL SELECT 'story set ' || id FROM stories.sets WHERE status = 'building'
      UNION ALL SELECT 'publish ' || id FROM social_hub.publish_attempts WHERE status IN ('creating', 'processing', 'publishing')" 2>/dev/null || echo 'CHECK_FAILED')"
    if [[ "${INFLIGHT}" == "CHECK_FAILED" ]]; then
      echo "Could not check for in-flight work; deploying anyway (FORCE_DEPLOY=1 silences this)." >&2
    elif [[ -n "${INFLIGHT}" ]]; then
      echo "Work is in flight; a deploy restarts every worker and kills it:" >&2
      echo "${INFLIGHT}" >&2
      echo "Wait for it to finish, or run with FORCE_DEPLOY=1." >&2
      exit 1
    fi
  else
    echo "No DATABASE_URL in .env.local or no psql: skipping the in-flight check." >&2
  fi
fi

echo "Deploying social workers (${UNITS}) → ${INSTANCE} (${ZONE}, project ${PROJECT})"

ARCHIVE="$(mktemp -t helios-social-XXXXXX).tgz"
trap 'rm -f "${ARCHIVE}"' EXIT
tar -czf "${ARCHIVE}" \
  --exclude='./.git' \
  --exclude='./node_modules' \
  --exclude='./.next' \
  --exclude='./.env.local' \
  --exclude='./scripts/gcp/worker.env' \
  --exclude='./.cursor' \
  --exclude='./helios_text_engine/.venv' \
  --exclude='./runs' \
  --exclude='./Claude outputs' \
  --exclude='./.explainers-local' \
  --exclude='./explainers/smoke/.out' \
  .

gcloud compute scp ${IAP} --zone="${ZONE}" --project="${PROJECT}" \
  "${ARCHIVE}" "${INSTANCE}:/tmp/helios-social-app.tgz"

UNIT_FILES=()
for unit in ${UNITS}; do
  [[ -f "scripts/gcp/${unit}.service" ]] || { echo "Missing scripts/gcp/${unit}.service" >&2; exit 1; }
  UNIT_FILES+=("scripts/gcp/${unit}.service")
done
gcloud compute scp ${IAP} --zone="${ZONE}" --project="${PROJECT}" "${UNIT_FILES[@]}" "${INSTANCE}:/tmp/"

if [[ -n "${ENV_FILE}" ]]; then
  gcloud compute scp ${IAP} --zone="${ZONE}" --project="${PROJECT}" "${ENV_FILE}" "${INSTANCE}:/tmp/social-worker.env"
fi

gcloud compute ssh ${IAP} "${INSTANCE}" --zone="${ZONE}" --project="${PROJECT}" --command="
  set -euo pipefail
  if [[ -f /tmp/social-worker.env ]]; then
    sudo mv /tmp/social-worker.env /opt/helios-social/worker.env
    sudo chmod 600 /opt/helios-social/worker.env
  fi
  if [[ ! -f /opt/helios-social/worker.env ]]; then
    echo 'Missing /opt/helios-social/worker.env on the VM. Pass SOCIAL_WORKER_ENV_FILE=… once.' >&2
    exit 1
  fi
  # Every social unit runs as helios (not root): Claude Code refuses
  # --dangerously-skip-permissions as root, and the Explainers render agent needs it.
  # System packages stay root; node_modules, browsers and the venv belong to helios.
  H=/opt/helios-social/home
  PW=/opt/helios-social/ms-playwright
  id -u helios >/dev/null 2>&1 || sudo useradd --system --user-group --home-dir \${H} --shell /usr/sbin/nologin helios
  # Stop before the folder is replaced: a worker must never run from a half-installed app.
  for unit in ${UNITS}; do
    if systemctl is-active --quiet \${unit}; then sudo systemctl stop \${unit}; fi
  done
  sudo rm -rf /opt/helios-social/app
  sudo mkdir -p /opt/helios-social/app /opt/helios-social/explainers/jobs /opt/helios-social/explainers/storage \${H} \${PW}
  sudo tar -xzf /tmp/helios-social-app.tgz -C /opt/helios-social/app --no-same-owner
  sudo chown -R helios:helios /opt/helios-social/app /opt/helios-social/explainers \${H} \${PW}
  sudo chmod -R go-w /opt/helios-social/app && sudo chmod 755 /opt/helios-social/app
  AS_HELIOS=\"sudo -u helios env HOME=\${H} PLAYWRIGHT_BROWSERS_PATH=\${PW} HYPERFRAMES_NO_TELEMETRY=1\"
  cd /opt/helios-social/app
  \${AS_HELIOS} python3 -m venv helios_text_engine/.venv
  # librosa measures song BPM for the Trial Reels song pool (D-175).
  \${AS_HELIOS} helios_text_engine/.venv/bin/pip install -q pillow numpy librosa
  \${AS_HELIOS} npm ci
  # Headless Chromium for carousel slides and story frames: system libs as root, the browser as helios.
  sudo npx --no-install playwright install-deps chromium
  \${AS_HELIOS} npx --no-install playwright install chromium
  # Explainer Reels: pinned HyperFrames CLI + Agent SDK, Chrome for renders, the agent sandbox.
  command -v bwrap >/dev/null && command -v socat >/dev/null && command -v unzip >/dev/null || sudo apt-get install -y -qq bubblewrap socat unzip
  # IG Stories: color emoji for the homemade frames.
  fc-list | grep -qi 'Noto Color Emoji' || sudo apt-get install -y -qq fonts-noto-color-emoji
  (cd explainers/runtime && \${AS_HELIOS} npm ci --no-audit --no-fund && \${AS_HELIOS} npx --no-install hyperframes browser ensure || true)
  for unit in ${UNITS}; do
    sudo cp /tmp/\${unit}.service /etc/systemd/system/\${unit}.service
  done
  sudo systemctl daemon-reload
  for unit in ${UNITS}; do
    if systemctl is-enabled --quiet \${unit}; then
      sudo systemctl restart \${unit}
      sudo systemctl --no-pager status \${unit} | head -5 || true
    else
      echo \"\${unit}: installed, not enabled (enable with: sudo systemctl enable --now \${unit})\"
    fi
  done
"

echo "Deployed to ${INSTANCE}."
