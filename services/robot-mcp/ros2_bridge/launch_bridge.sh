#!/usr/bin/env bash
set -euo pipefail
case "${ROBOT_ROS2_ENV:-phase9b}" in
  phase9b) source /data-ssd/zhongchengkai/agnes/scripts/use-phase9b-env.sh ;;
  phase9c) source /data-ssd/zhongchengkai/agnes/scripts/use-phase9c-env.sh ;;
  phase9d) source /data-ssd/zhongchengkai/agnes/scripts/use-phase9d-env.sh ;;
  phase9e) source /data-ssd/zhongchengkai/agnes/scripts/use-phase9e-env.sh ;;
  phase9f) source /data-ssd/zhongchengkai/agnes/scripts/use-phase9f-env.sh ;;
  phase10) source /data-ssd/zhongchengkai/agnes/scripts/use-phase10-env.sh ;;
  final_rescue) source /data-ssd/zhongchengkai/agnes/scripts/final-rescue/env.sh ;;
  *) exit 2 ;;
esac
export RCUTILS_LOGGING_USE_STDOUT=0
exec "$PIXI_BIN_DIR/pixi" run --manifest-path /data-ssd/zhongchengkai/agnes/runtime/ros2-jazzy/pixi.toml \
  python /data-ssd/zhongchengkai/agnes/services/robot-mcp/ros2_bridge/bridge.py
