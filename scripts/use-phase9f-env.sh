#!/usr/bin/env bash
source /data-ssd/zhongchengkai/agnes/scripts/use-phase9e-env.sh
PHASE9F_ROOT=/data-ssd/zhongchengkai/agnes
export HOME="$PHASE9F_ROOT/.phase9f-home" TMPDIR="$PHASE9F_ROOT/.tmp/phase9f"
export TMP_DIR="$TMPDIR" TMP="$TMPDIR" TEMP="$TMPDIR"
export XDG_CONFIG_HOME="$HOME/.config" XDG_DATA_HOME="$HOME/.local/share"
export ROS_HOME="$HOME/.ros" ROS_LOG_DIR="$PHASE9F_ROOT/logs/phase9f/ros"
export ROS_DOMAIN_ID=96 GZ_PARTITION=agnes_phase9f PHASE9_STACK=phase9f
export GZ_SIM_RESOURCE_PATH="$PHASE9F_ROOT/simulation/phase9f:$PHASE9F_ROOT/simulation/phase9e"
export GZ_LOG_PATH="$PHASE9F_ROOT/logs/phase9f/gazebo"
export ROBOT_WORLD_REGISTRY="$PHASE9F_ROOT/simulation/phase9f/world_registry.json"
export ROBOT_NAV2_PARAMS="$PHASE9F_ROOT/simulation/phase9f/nav2_params.yaml"
unset ROBOT_WAYPOINTS_FILE
mkdir -p "$HOME" "$TMPDIR" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$ROS_HOME" "$ROS_LOG_DIR" \
  "$PHASE9F_ROOT/logs/phase9f" "$PHASE9F_ROOT/artifacts/phase9f"
