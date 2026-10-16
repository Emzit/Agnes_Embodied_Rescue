#!/usr/bin/env bash
set -euo pipefail
ROOT=/data-ssd/zhongchengkai/agnes
NODE="$ROOT/tools/node/bin/node"
PID_FILE="$ROOT/artifacts/demo/dashboard.pid"
LOG_FILE="$ROOT/logs/demo/dashboard.log"
# Dashboard must use the same project-local daemon/profile as the interactive
# stack even when invoked directly, rather than inheriting the user's daemon.
source "$ROOT/scripts/final-rescue/env.sh"
mkdir -p "$(dirname "$PID_FILE")" "$(dirname "$LOG_FILE")"
if [[ -f "$PID_FILE" ]]; then
  pid=$(cat "$PID_FILE" 2>/dev/null || true)
  if [[ -n "$pid" && -r "/proc/$pid/cmdline" ]] && tr '\0' ' ' < "/proc/$pid/cmdline" | grep -Fq "$ROOT/demo/final-dashboard/server.mjs"; then
    echo "Dashboard already running at http://127.0.0.1:4188 (pid $pid)"
    exit 0
  fi
  rm -f "$PID_FILE"
fi
setsid "$NODE" "$ROOT/demo/final-dashboard/server.mjs" </dev/null >>"$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
sleep 0.3
if ! curl -fsS http://127.0.0.1:4188/api/mode >/dev/null; then
  echo "Dashboard failed to start; see $LOG_FILE" >&2
  rm -f "$PID_FILE"
  exit 1
fi
echo "Dashboard: http://127.0.0.1:4188 (pid $(cat "$PID_FILE"))"
