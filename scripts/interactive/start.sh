#!/usr/bin/env bash
set -euo pipefail
ROOT=/data-ssd/zhongchengkai/agnes
OUT="$ROOT/artifacts/interactive-live"
PID="$OUT/pids"
mkdir -p "$OUT/full-mission" "$OUT/camera" "$OUT/logs" "$PID"
source "$ROOT/scripts/final-rescue/env.sh"
export INTERACTIVE_LIVE_ROOT="$OUT" FINAL_RUN_DIR="$OUT/full-mission" ROBOT_TRACE_DIR="$OUT/full-mission"
STACK_REGISTRY="$ROOT/.runtime-final_rescue/processes.json"
touch "$OUT/debug-attempts.json"
[[ -s "$OUT/debug-attempts.json" ]] || echo '[]' > "$OUT/debug-attempts.json"
STACK_OWNER_PID=""
if [[ -f "$STACK_REGISTRY" ]]; then
  STACK_OWNER_PID=$(python3 - "$STACK_REGISTRY" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1]))
    for item in data.get('entries', []):
        if item.get('name') == 'supervisor':
            print(item.get('pid', ''))
            break
except Exception:
    pass
PY
  )
fi
if [[ -n "$STACK_OWNER_PID" ]] && kill -0 "$STACK_OWNER_PID" 2>/dev/null; then
  echo "$STACK_OWNER_PID" >"$PID/stack.pid"
  echo "final_rescue stack already running (pid $STACK_OWNER_PID)"
else
  setsid "$ROOT/scripts/final-rescue/start-stack.sh" >"$OUT/logs/stack.log" 2>&1 & echo $! >"$PID/stack.pid"
fi
for _ in {1..180}; do grep -q FINAL_RESCUE_STACK_STARTED "$OUT/logs/stack.log" 2>/dev/null && break; sleep 1; done
grep -q FINAL_RESCUE_STACK_STARTED "$OUT/logs/stack.log" 2>/dev/null || { echo 'stack not ready; see artifacts/interactive-live/logs/stack.log' >&2; exit 1; }
DAEMON_CLI="$ROOT/third_party/agnes-harness/packages/cli/dist/local/agnes.mjs"
daemon_status() {
  "$ROOT/tools/node/bin/node" "$DAEMON_CLI" daemon status >/dev/null 2>&1
}
# Always admit the project-local proxy daemon through its own entry point.
# Calling the packaged CLI's daemon start here silently bypassed the proxy
# wrapper after a cold stop, leaving the worker's fetch on a direct route.
# The wrapper remains a normal Agnes daemon and uses the same project socket;
# only its worker bootstrap is project-local.
if ! daemon_status; then
  DAEMON_LOG="$OUT/logs/project-daemon-start.log"
  setsid "$ROOT/tools/node/bin/node" "$ROOT/scripts/agnes-proxy/daemon.mjs" \
    --profile local-dev --workspace "$ROOT" \
    --data-dir "$ROOT/.agh-home-step7/data" \
    --local-web-addr 127.0.0.1:0 --local-web-origin http://127.0.0.1:4177 \
    >"$DAEMON_LOG" 2>&1 &
  echo $! >"$PID/daemon.pid"
  daemon_ready=false
  for _ in {1..90}; do
    if daemon_status; then daemon_ready=true; break; fi
    sleep 1
  done
  if [[ "$daemon_ready" != true ]]; then
    echo 'project proxy daemon did not become ready; see artifacts/interactive-live/logs/project-daemon-start.log' >&2
    exit 1
  fi
fi
provider_ready=false
# A freshly admitted worker may still be completing its MCP child attach.  Use
# bounded backoff for this read-only admission probe; never replay a mission or
# destructive tool here.
for provider_attempt in 1 2 3 4; do
  if "$ROOT/tools/node/bin/node" "$ROOT/third_party/agnes-harness/node_modules/tsx/dist/cli.mjs" "$ROOT/scripts/interactive/ensure-real-runtime.mjs" >"$OUT/logs/provider-runtime.log" 2>&1; then
    provider_ready=true
    break
  fi
  echo "Provider/session readiness attempt ${provider_attempt}/4 failed; retrying with the same real provider/session path" >>"$OUT/logs/provider-runtime.log"
  if [[ "$provider_attempt" -lt 4 ]]; then sleep $((2 ** (provider_attempt - 1))); fi
done
if [[ "$provider_ready" != true ]]; then
  echo "Provider/session runtime not ready after bounded retries; see artifacts/interactive-live/logs/provider-runtime.log" >&2
  exit 1
fi
if [[ -f "$PID/camera.pid" ]] && kill -0 "$(cat "$PID/camera.pid")" 2>/dev/null; then echo "camera adapter already running (pid $(cat "$PID/camera.pid"))"; else setsid "$ROOT/tools/node/bin/node" "$ROOT/third_party/agnes-harness/node_modules/tsx/dist/cli.mjs" "$ROOT/scripts/interactive/live-camera-adapter.mjs" >"$OUT/logs/camera.log" 2>&1 & echo $! >"$PID/camera.pid"; fi
for _ in {1..60}; do [[ -s "$OUT/camera/latest-meta.json" ]] && break; sleep .5; done
"$ROOT/scripts/demo/start-dashboard.sh" >/dev/null
echo "Interactive Demo: http://127.0.0.1:4188"
PREFLIGHT=$(curl -fsS http://127.0.0.1:4188/api/system/preflight 2>/dev/null || true)
for _ in {1..60}; do
  if echo "$PREFLIGHT" | grep -q '"pass": true'; then break; fi
  sleep 1
  PREFLIGHT=$(curl -fsS http://127.0.0.1:4188/api/system/preflight 2>/dev/null || true)
done
if echo "$PREFLIGHT" | grep -q '"pass": true'; then
  "$ROOT/tools/node/bin/node" -e "const fs=require('fs'),path=require('path'),file=path.join(process.env.INTERACTIVE_LIVE_ROOT,'current.json');let prior={};try{prior=JSON.parse(fs.readFileSync(file,'utf8'))}catch{};fs.writeFileSync(file,JSON.stringify({mission_id:null,status:'IDLE',task:'进入实验室寻找失联研究员，并报告环境风险。',current_stage:'等待任务',current_plan:'输入自然语言任务后开始执行',current_location:null,scenario_seed:process.env.SCENARIO_SEED||null,last_mission_id:prior.mission_id||null,scene_reset_at:new Date().toISOString()},null,2)+'\n')"
  cat >"$OUT/checkpoint.json" <<EOF
{"phase":"interactive_stack_ready","camera_live":true,"mission_input":true,"agnes_real":true,"map_live":true,"preflight_pass":true,"last_successful_test":"real system preflight","next_action":"run natural-language mission tests"}
EOF
  echo "Mode: LIVE READY"
else
  REASONS=$(echo "$PREFLIGHT" | grep -o '"failure_reasons"[^]]*]' || true)
  cat >"$OUT/checkpoint.json" <<EOF
{"phase":"interactive_stack_degraded","camera_live":$([[ -s "$OUT/camera/latest-meta.json" ]] && echo true || echo false),"preflight_pass":false,"failure_reasons":"$REASONS","next_action":"repair stack and rerun preflight"}
EOF
  echo "Mode: DEGRADED / NOT READY ${REASONS}"
  exit 1
fi
