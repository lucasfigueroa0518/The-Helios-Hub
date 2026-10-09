#!/usr/bin/env bash
# Trial Reels runs on helios-social-worker now (docs/social-overnight.md).
# This keeps the old command working: it ships code and the helios-reels unit
# through deploy-social-worker.sh.
set -euo pipefail
SOCIAL_UNITS="${SOCIAL_UNITS:-helios-reels}" exec "$(dirname "$0")/deploy-social-worker.sh" "$@"
