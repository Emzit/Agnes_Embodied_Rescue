#!/usr/bin/env bash
set -euo pipefail
source /data-ssd/zhongchengkai/agnes/scripts/final-rescue/env.sh
cd "$FINAL_ROOT"
ROBOT_GATEWAY=mock "$FINAL_ROOT/tools/node/bin/node" --test packages/embodied-rescue-plugin/tests/*.test.ts services/robot-mcp/tests/*.test.ts > logs/final_rescue/regression.log 2>&1
"$PIXI_BIN_DIR/pixi" run --locked -m runtime/ros2-jazzy/pixi.toml python services/robot-mcp/ros2_bridge/test_cv_detector.py > logs/final_rescue/cv-unit.log 2>&1
"$PIXI_BIN_DIR/pixi" run --locked -m runtime/ros2-jazzy/pixi.toml python services/robot-mcp/ros2_bridge/test_sensor_summary.py > logs/final_rescue/sensor-unit.log 2>&1
