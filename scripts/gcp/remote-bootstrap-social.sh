#!/usr/bin/env bash
# Runs on the social worker VM (via provision-social-worker.sh). Idempotent.
# Installs what every social worker needs: Node, swap, ffmpeg, the Python venv
# for the reels text engine and song BPM, and headless Chromium's system libs.
set -euo pipefail

APP_DIR=/opt/helios-social
# e2-medium has 4 GB; the night jobs are staggered by the hour, swap covers spikes.
SWAP_MB=4096
NODE_MAJOR=22

export DEBIAN_FRONTEND=noninteractive

apt-get update -y
# bubblewrap + socat: the Linux sandbox for the Explainers render agent (Agent SDK).
# fonts-noto-color-emoji: the homemade Stories frames' emoji (no Apple Color Emoji on Linux).
apt-get install -y ca-certificates curl git build-essential python3 python3-venv ffmpeg bubblewrap socat fonts-noto-color-emoji unzip

if ! swapon --show | grep -q '/swapfile'; then
  if [[ ! -f /swapfile ]]; then
    fallocate -l "${SWAP_MB}M" /swapfile || dd if=/dev/zero of=/swapfile bs=1M count="${SWAP_MB}"
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile || true
  if ! grep -q '/swapfile' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
fi

if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt "${NODE_MAJOR}" ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

# The social units run as helios, never root: Claude Code refuses
# --dangerously-skip-permissions as root, and the Explainers render agent needs it.
id -u helios >/dev/null 2>&1 || useradd --system --user-group --home-dir "${APP_DIR}/home" --shell /usr/sbin/nologin helios

mkdir -p "${APP_DIR}/app" "${APP_DIR}/explainers/jobs" "${APP_DIR}/explainers/storage" "${APP_DIR}/home" "${APP_DIR}/ms-playwright" "${APP_DIR}/reel-ai-drama"
chown -R helios:helios "${APP_DIR}/app" "${APP_DIR}/explainers" "${APP_DIR}/home" "${APP_DIR}/ms-playwright" "${APP_DIR}/reel-ai-drama"
chmod 755 "${APP_DIR}"

# rembg: AI Drama person cutouts (lib/real-case/objects/cutout.ts runs `rembg i -m u2net`).
# Its own venv outside app/, which every deploy replaces. Python 3.10 (Ubuntu 22.04) tops out at
# rembg 2.0.69; the [cpu] extra brings onnxruntime. The u2net model (~176 MB) is fetched once
# into helios's home so the first job doesn't download it. Without rembg, jobs skip cutouts.
REMBG_VENV="${APP_DIR}/rembg-venv"
REMBG_VERSION=2.0.69
mkdir -p "${REMBG_VENV}" && chown helios:helios "${REMBG_VENV}"
[[ -x "${REMBG_VENV}/bin/python" ]] || sudo -u helios python3 -m venv "${REMBG_VENV}"
if ! sudo -u helios "${REMBG_VENV}/bin/python" -c "import rembg, onnxruntime" 2>/dev/null; then
  sudo -u helios "${REMBG_VENV}/bin/pip" install -q --upgrade pip
  sudo -u helios "${REMBG_VENV}/bin/pip" install -q "rembg[cpu,cli]==${REMBG_VERSION}"
fi
if [[ ! -s "${APP_DIR}/home/.u2net/u2net.onnx" ]]; then
  PROBE="$(sudo -u helios mktemp -d)"
  sudo -u helios "${REMBG_VENV}/bin/python" -c "from PIL import Image; Image.new('RGB', (64, 64), 'white').save('${PROBE}/in.png')"
  sudo -u helios env HOME="${APP_DIR}/home" "${REMBG_VENV}/bin/rembg" i -m u2net "${PROBE}/in.png" "${PROBE}/out.png" >/dev/null 2>&1
  rm -rf "${PROBE:?}"
fi
# worker.env is copied in by the first deploy; when it is already here, point the workers at rembg.
if [[ -f "${APP_DIR}/worker.env" ]] && ! grep -q '^REMBG_BIN=' "${APP_DIR}/worker.env"; then
  echo "REMBG_BIN=${REMBG_VENV}/bin/rembg" >> "${APP_DIR}/worker.env"
fi

echo "Bootstrap done: node $(node -v), $(ffmpeg -version | head -1), rembg $("${REMBG_VENV}/bin/pip" show rembg 2>/dev/null | awk '/^Version/ {print $2}')"
