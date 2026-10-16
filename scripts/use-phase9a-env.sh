#!/usr/bin/env bash
# Source for a workspace-contained Phase 9A environment.
PHASE9A_ROOT=/data-ssd/zhongchengkai/agnes
export HOME="$PHASE9A_ROOT/.phase9a-home"
export TMPDIR="$PHASE9A_ROOT/.tmp/phase9a"
export XDG_CACHE_HOME="$PHASE9A_ROOT/.cache"
export XDG_CONFIG_HOME="$PHASE9A_ROOT/.phase9a-home/.config"
export XDG_DATA_HOME="$PHASE9A_ROOT/.phase9a-home/.local/share"
export PIXI_HOME="$PHASE9A_ROOT/tools/pixi/home"
export PIXI_BIN_DIR="$PHASE9A_ROOT/tools/pixi/bin"
export PIXI_CACHE_DIR="$PHASE9A_ROOT/.cache/pixi"
export RATTLER_CACHE_DIR="$PHASE9A_ROOT/.cache/rattler"
export PIXI_NO_CONFIG=1 PIXI_NO_PATH_UPDATE=1
export PIXI_NO_TELEMETRY=1 DO_NOT_TRACK=1
export TMP_DIR="$TMPDIR"
export HTTP_PROXY=http://127.0.0.1:7898 HTTPS_PROXY=http://127.0.0.1:7898
export http_proxy="$HTTP_PROXY" https_proxy="$HTTPS_PROXY"
export NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost
export SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
export REQUESTS_CA_BUNDLE="$SSL_CERT_FILE" CURL_CA_BUNDLE="$SSL_CERT_FILE"
export PYTHONNOUSERSITE=1 PYTHONDONTWRITEBYTECODE=1
export ROS_LOG_DIR="$PHASE9A_ROOT/logs/phase9a/ros"
export ROS_HOME="$PHASE9A_ROOT/.phase9a-home/.ros"
export CUDA_CACHE_PATH="$PHASE9A_ROOT/.cache/cuda"
export PATH="/usr/bin:/bin"
unset PYTHONPATH PYTHONHOME CONDA_PREFIX CONDA_DEFAULT_ENV AMENT_PREFIX_PATH CMAKE_PREFIX_PATH NETRC
mkdir -p "$HOME" "$TMPDIR" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" \
  "$PIXI_HOME" "$PIXI_BIN_DIR" "$PIXI_CACHE_DIR" "$RATTLER_CACHE_DIR" \
  "$PHASE9A_ROOT/runtime/ros2-jazzy" "$ROS_LOG_DIR" "$ROS_HOME" "$CUDA_CACHE_PATH"
