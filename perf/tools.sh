#!/usr/bin/env bash
# Measurement tools, installed on demand without touching package.json or the lockfile.
# The repo pins its dependency files on purpose (tests/social-hub-scope.test.ts checks
# their hashes against planning/Social Hub/scope-baseline.json), so perf tooling is
# not a devDependency. `npm ci` removes these again; rerun this after it.
set -euo pipefail
cd "$(dirname "$0")/.."
npm install --no-save --no-audit --no-fund \
  lighthouse@13.6.0 \
  @lhci/cli@0.16.1 \
  size-limit@14.3.0 \
  @size-limit/file@14.3.0 \
  @next/bundle-analyzer@15.5.25
