#!/usr/bin/env bash
set -euo pipefail
cd /data-ssd/zhongchengkai/agnes
source scripts/use-phase10-env.sh
exec "$PIXI_BIN_DIR/pixi" run --locked -m runtime/ros2-jazzy/pixi.toml python scripts/phase9d/stack.py stop
