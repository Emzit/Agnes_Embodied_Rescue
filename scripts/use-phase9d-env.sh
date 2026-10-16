#!/usr/bin/env bash
source /data-ssd/zhongchengkai/agnes/scripts/use-phase9c-env.sh
unset ROBOT_WORLD_REGISTRY ROBOT_NAV2_PARAMS PHASE9_STACK ROBOT_PERCEPTION
PHASE9D_ROOT=/data-ssd/zhongchengkai/agnes
export HOME="$PHASE9D_ROOT/.phase9d-home" TMPDIR="$PHASE9D_ROOT/.tmp/phase9d"
export TMP_DIR="$TMPDIR" TMP="$TMPDIR" TEMP="$TMPDIR"
export XDG_CONFIG_HOME="$HOME/.config" XDG_DATA_HOME="$HOME/.local/share"
export ROS_HOME="$HOME/.ros" ROS_LOG_DIR="$PHASE9D_ROOT/logs/phase9d/ros"
export ROS_DOMAIN_ID=94 GZ_PARTITION=agnes_phase9d
export ROBOT_ROS_USE_SIM_TIME=1
export GZ_SIM_RESOURCE_PATH="$PHASE9D_ROOT/simulation/phase9d:$PHASE9D_ROOT/simulation/phase9c"
export GZ_LOG_PATH="$PHASE9D_ROOT/logs/phase9d/gazebo"
mkdir -p "$HOME" "$TMPDIR" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$ROS_HOME" "$ROS_LOG_DIR" \
  "$PHASE9D_ROOT/logs/phase9d" "$PHASE9D_ROOT/artifacts/phase9d"
