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

mkdir -p "${APP_DIR}/app" "${APP_DIR}/explainers/jobs" "${APP_DIR}/explainers/storage" "${APP_DIR}/home" "${APP_DIR}/ms-playwright"
chown -R helios:helios "${APP_DIR}/app" "${APP_DIR}/explainers" "${APP_DIR}/home" "${APP_DIR}/ms-playwright"
chmod 755 "${APP_DIR}"

echo "Bootstrap done: node $(node -v), $(ffmpeg -version | head -1)"
