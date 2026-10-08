#!/usr/bin/env bash
# Explainer Reels runs on helios-social-worker now (docs/social-overnight.md).
# This keeps the old command working: it ships code and the helios-explainers
# unit through deploy-social-worker.sh. The unit is enabled by hand once.
set -euo pipefail
SOCIAL_UNITS="${SOCIAL_UNITS:-helios-explainers}" exec "$(dirname "$0")/deploy-social-worker.sh" "$@"
