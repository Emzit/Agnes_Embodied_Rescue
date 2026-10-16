#!/usr/bin/env bash
source /data-ssd/zhongchengkai/agnes/scripts/use-phase9a-env.sh
PHASE9C_ROOT=/data-ssd/zhongchengkai/agnes
export HOME="$PHASE9C_ROOT/.phase9c-home" TMPDIR="$PHASE9C_ROOT/.tmp/phase9c"
export TMP_DIR="$TMPDIR"
export TMP="$TMPDIR" TEMP="$TMPDIR"
export XDG_CONFIG_HOME="$HOME/.config" XDG_DATA_HOME="$HOME/.local/share"
export ROS_LOG_DIR="$PHASE9C_ROOT/logs/phase9c/ros" ROS_HOME="$HOME/.ros"
export ROS_DOMAIN_ID=93 RMW_IMPLEMENTATION=rmw_cyclonedds_cpp
export CYCLONEDDS_URI="$PHASE9C_ROOT/runtime/ros2-jazzy/cyclonedds.xml"
export ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST
export GZ_PARTITION=agnes_phase9c GZ_IP=127.0.0.1
export GZ_SIM_RESOURCE_PATH="$PHASE9C_ROOT/simulation/phase9c"
export GZ_LOG_PATH="$PHASE9C_ROOT/logs/phase9c/gazebo"
unset DISPLAY WAYLAND_DISPLAY
mkdir -p "$HOME" "$TMPDIR" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$ROS_LOG_DIR" "$ROS_HOME" \
  "$PHASE9C_ROOT/logs/phase9c" "$PHASE9C_ROOT/artifacts/phase9c"
