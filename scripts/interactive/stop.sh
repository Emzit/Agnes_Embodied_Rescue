#!/usr/bin/env bash
set -euo pipefail
ROOT=/data-ssd/zhongchengkai/agnes; OUT="$ROOT/artifacts/interactive-live"; PID="$OUT/pids"
if [[ -f "$ROOT/artifacts/demo/dashboard.pid" ]]; then "$ROOT/scripts/demo/stop-dashboard.sh" || true; fi
if [[ -f "$OUT/current.json" ]] && grep -Eq '"status": "(RUNNING|STARTING|CANCELING)"' "$OUT/current.json"; then curl -fsS -X POST http://127.0.0.1:4188/api/mission/stop >/dev/null 2>&1 || true; fi
if [[ -f "$PID/camera.pid" ]]; then p=$(cat "$PID/camera.pid" || true); if [[ -n "$p" && -r "/proc/$p/cmdline" ]] && tr '\0' ' ' <"/proc/$p/cmdline" | grep -Fq "$ROOT"; then kill "$p" 2>/dev/null || true; fi; rm -f "$PID/camera.pid"; fi
if [[ -f "$PID/stack.pid" ]]; then p=$(cat "$PID/stack.pid" || true); if [[ -n "$p" && -r "/proc/$p/cmdline" ]] && tr '\0' ' ' <"/proc/$p/cmdline" | grep -Fq "$ROOT/scripts/final-rescue/start-stack.sh"; then "$ROOT/scripts/final-rescue/stop-stack.sh" >/dev/null 2>&1 || true; fi; rm -f "$PID/stack.pid"; fi
if [[ -f "$ROOT/.runtime-final_rescue/processes.json" ]]; then "$ROOT/scripts/final-rescue/stop-stack.sh" >/dev/null 2>&1 || true; fi
# Stop only the daemon selected by this project's AGH_HOME.  This prevents a
# subsequent cold start from reusing an old worker and also guarantees that a
# packaged daemon cannot silently replace the project proxy wrapper.
source "$ROOT/scripts/final-rescue/env.sh"
DAEMON_CLI="$ROOT/third_party/agnes-harness/packages/cli/dist/local/agnes.mjs"
if "$ROOT/tools/node/bin/node" "$DAEMON_CLI" daemon status >/dev/null 2>&1; then
  "$ROOT/tools/node/bin/node" "$DAEMON_CLI" daemon stop >/dev/null 2>&1 || true
fi
cat >"$OUT/process-cleanup.json" <<EOF
{"dashboard":"stopped","camera_adapter":"stopped","stack":"stop requested","daemon":"project AGH_HOME daemon stop requested","scope":"interactive-live project-owned processes only","timestamp":"$(date -Is)"}
EOF
echo "Interactive stack stopped"
