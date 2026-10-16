#!/usr/bin/env bash
set -euo pipefail
ROOT=/data-ssd/zhongchengkai/agnes
PID_FILE="$ROOT/artifacts/demo/dashboard.pid"
if [[ ! -f "$PID_FILE" ]]; then
  echo "Dashboard stopped (no pid file)"
  exit 0
fi
pid=$(cat "$PID_FILE" 2>/dev/null || true)
if [[ -n "$pid" && -r "/proc/$pid/cmdline" ]] && tr '\0' ' ' < "/proc/$pid/cmdline" | grep -Fq "$ROOT/demo/final-dashboard/server.mjs"; then
  kill "$pid" 2>/dev/null || true
  for _ in {1..20}; do
    [[ ! -e "/proc/$pid" ]] && break
    sleep 0.1
  done
fi
rm -f "$PID_FILE"
echo "Dashboard stopped"
