#!/usr/bin/env bash
source /data-ssd/zhongchengkai/agnes/scripts/use-phase9f-env.sh
PHASE10_ROOT=/data-ssd/zhongchengkai/agnes
export HOME="$PHASE10_ROOT/.phase10-home" TMPDIR="$PHASE10_ROOT/.tmp/phase10"
export TMP_DIR="$TMPDIR" TMP="$TMPDIR" TEMP="$TMPDIR"
export XDG_CONFIG_HOME="$HOME/.config" XDG_DATA_HOME="$HOME/.local/share"
export ROS_HOME="$HOME/.ros" ROS_LOG_DIR="$PHASE10_ROOT/logs/phase10/ros"
export ROS_DOMAIN_ID=100 GZ_PARTITION=agnes_phase10 PHASE9_STACK=phase10
export ROBOT_PERCEPTION=cv
export GZ_SIM_RESOURCE_PATH="$PHASE10_ROOT/simulation/phase10:$PHASE10_ROOT/simulation/phase9f"
export GZ_LOG_PATH="$PHASE10_ROOT/logs/phase10/gazebo"
mkdir -p "$HOME" "$TMPDIR" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$ROS_HOME" "$ROS_LOG_DIR" \
  "$PHASE10_ROOT/logs/phase10" "$PHASE10_ROOT/artifacts/phase10"
