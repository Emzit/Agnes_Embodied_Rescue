#!/usr/bin/env bash
source /data-ssd/zhongchengkai/agnes/scripts/use-phase9d-env.sh
PHASE9E_ROOT=/data-ssd/zhongchengkai/agnes
export HOME="$PHASE9E_ROOT/.phase9e-home" TMPDIR="$PHASE9E_ROOT/.tmp/phase9e"
export TMP_DIR="$TMPDIR" TMP="$TMPDIR" TEMP="$TMPDIR"
export XDG_CONFIG_HOME="$HOME/.config" XDG_DATA_HOME="$HOME/.local/share"
export ROS_HOME="$HOME/.ros" ROS_LOG_DIR="$PHASE9E_ROOT/logs/phase9e/ros"
export ROS_DOMAIN_ID=95 GZ_PARTITION=agnes_phase9e PHASE9_STACK=phase9e
export GZ_SIM_RESOURCE_PATH="$PHASE9E_ROOT/simulation/phase9e:$PHASE9E_ROOT/simulation/phase9d"
export GZ_LOG_PATH="$PHASE9E_ROOT/logs/phase9e/gazebo"
export MESA_SHADER_CACHE_DIR="$PHASE9E_ROOT/.cache/mesa"
mkdir -p "$HOME" "$TMPDIR" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$ROS_HOME" "$ROS_LOG_DIR" \
  "$PHASE9E_ROOT/logs/phase9e" "$PHASE9E_ROOT/artifacts/phase9e" "$MESA_SHADER_CACHE_DIR"
