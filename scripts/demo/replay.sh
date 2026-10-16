#!/usr/bin/env bash
set -euo pipefail
ROOT=/data-ssd/zhongchengkai/agnes
NODE="$ROOT/tools/node/bin/node"
cd "$ROOT"
"$NODE" scripts/demo/build-replay-data.mjs
"$ROOT/scripts/demo/start-dashboard.sh"
if [[ -f "$ROOT/artifacts/demo/replay-showcase-v2.json" ]]; then
  echo "Replay ready: http://127.0.0.1:4188/?mode=replay&run=showcase-v2"
else
  echo "Replay ready: http://127.0.0.1:4188/?mode=replay&run=1"
fi
