#!/usr/bin/env bash
# Reel AI Drama worker on helios-social-worker (planning/AI Mini Docs/HUB-WIRING-CONTRACT.md §7.1 item 7).
# Ships code and the helios-reel-ai-drama unit through deploy-social-worker.sh. The unit is enabled by hand
# once a host is picked; Lucas runs the deploy.
set -euo pipefail
SOCIAL_UNITS="${SOCIAL_UNITS:-helios-reel-ai-drama}" exec "$(dirname "$0")/deploy-social-worker.sh" "$@"
