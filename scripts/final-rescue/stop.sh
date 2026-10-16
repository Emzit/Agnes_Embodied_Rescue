#!/usr/bin/env bash
set -euo pipefail
source /data-ssd/zhongchengkai/agnes/scripts/final-rescue/env.sh
cd "$FINAL_ROOT"
exec "$FINAL_ROOT/tools/node/bin/node" "$FINAL_ROOT/third_party/agnes-harness/node_modules/tsx/dist/cli.mjs" "$FINAL_ROOT/scripts/final-rescue/mission.mts" stop
