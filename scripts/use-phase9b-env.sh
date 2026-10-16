#!/usr/bin/env bash
source /data-ssd/zhongchengkai/agnes/scripts/use-phase9a-env.sh
PHASE9B_ROOT=/data-ssd/zhongchengkai/agnes
export HOME="$PHASE9B_ROOT/.phase9b-home"
export TMPDIR="$PHASE9B_ROOT/.tmp/phase9b"
export TMP_DIR="$TMPDIR"
export XDG_CONFIG_HOME="$HOME/.config" XDG_DATA_HOME="$HOME/.local/share"
export ROS_LOG_DIR="$PHASE9B_ROOT/logs/phase9b/ros" ROS_HOME="$HOME/.ros"
export ROS_DOMAIN_ID=92
export RMW_IMPLEMENTATION=rmw_cyclonedds_cpp
export CYCLONEDDS_URI="$PHASE9B_ROOT/runtime/ros2-jazzy/cyclonedds.xml"
export ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST
mkdir -p "$HOME" "$TMPDIR" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$ROS_LOG_DIR" "$ROS_HOME" "$PHASE9B_ROOT/artifacts/phase9b"
