#!/usr/bin/env bash
set -euo pipefail
source /data-ssd/zhongchengkai/agnes/scripts/final-rescue/env.sh
exec "$PIXI_BIN_DIR/pixi" run --locked -m "$FINAL_ROOT/runtime/ros2-jazzy/pixi.toml" python "$FINAL_ROOT/scripts/phase9d/stack.py" serve
