#!/usr/bin/env bash
# Full strict check in a node:22-slim container (the host has no node), the same gates CI runs.
#   ./scripts/check.sh              # npm ci, then check, lint, format:check, test
#   ./scripts/check.sh coverage     # ... and the coverage report
set -euo pipefail
cd "$(dirname "$0")/.."
STEPS='npm ci && npm run check && npm run lint && npm run format:check && npm run test'
if [[ "${1:-}" == coverage ]]; then STEPS="$STEPS && npm run coverage"; fi
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/w -w /w node:22-slim bash -c "$STEPS"
