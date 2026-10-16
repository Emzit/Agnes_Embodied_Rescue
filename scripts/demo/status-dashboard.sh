#!/usr/bin/env bash
set -euo pipefail
ROOT=/data-ssd/zhongchengkai/agnes
PID_FILE="$ROOT/artifacts/demo/dashboard.pid"
if [[ -f "$PID_FILE" ]]; then
  pid=$(cat "$PID_FILE" 2>/dev/null || true)
  if [[ -n "$pid" && -r "/proc/$pid/cmdline" ]] && tr '\0' ' ' < "/proc/$pid/cmdline" | grep -Fq "$ROOT/demo/final-dashboard/server.mjs"; then
    curl -fsS http://127.0.0.1:4188/api/mode
    echo "pid=$pid url=http://127.0.0.1:4188"
    exit 0
  fi
fi
echo "Dashboard stopped"
exit 1
