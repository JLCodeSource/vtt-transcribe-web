#!/usr/bin/env bash
# Run the full e2e suite in a container. Uses the host NVIDIA GPU (WebGPU test) when one is available.
#   ./scripts/e2e.sh                 # everything
#   ./scripts/e2e.sh --project=real  # any `playwright test` args
set -euo pipefail
cd "$(dirname "$0")/.."
docker build -q -f Dockerfile.e2e -t vtt-web-e2e . >/dev/null
GPU=()
if command -v nvidia-smi >/dev/null && nvidia-smi >/dev/null 2>&1; then
  if [[ -e /var/run/cdi/nvidia.yaml || -e /etc/cdi/nvidia.yaml ]]; then GPU=(--device nvidia.com/gpu=all)
  elif docker info 2>/dev/null | grep -qi 'runtimes:.*nvidia'; then GPU=(--gpus all)
  fi
fi
ENVS=(-e HOME=/tmp -e OWNER="$(id -u):$(id -g)")
if ((${#GPU[@]})); then ENVS+=(-e NVIDIA_DRIVER_CAPABILITIES=all -e VTT_GPU=1); echo "GPU detected: running WebGPU tests"; else echo "No GPU available: WebGPU tests are not part of this run"; fi
docker run --rm --ipc=host "${GPU[@]}" "${ENVS[@]}" -v "$PWD":/w -w /w vtt-web-e2e \
  sh -c 'npx playwright test "$@"; rc=$?; chown -R "$OWNER" . 2>/dev/null; exit $rc' sh "$@"
