#!/usr/bin/env bash
set -euo pipefail
ROOT=/data-ssd/zhongchengkai/agnes
NODE="$ROOT/tools/node/bin/node"
STATE="$ROOT/artifacts/demo-rescue/runtime-state"
mkdir -p "$STATE" "$ROOT/artifacts/demo-rescue/logs"
# Stop only the current interactive runtime before selecting the demo scenario.
"$ROOT/scripts/interactive/stop.sh" >/dev/null 2>&1 || true
# The imported-map activation has precedence over reviewed scenario layouts.
# Preserve it inside the project and restore it in stop.sh.
IMPORTED="$ROOT/artifacts/interactive-live/imported-map.env"
if [[ -f "$IMPORTED" && ! -f "$STATE/imported-map.env" ]]; then
  mv "$IMPORTED" "$STATE/imported-map.env"
  echo moved >"$STATE/imported-map.state"
fi
SEED="${DEMO_SCENARIO_SEED:-1185}"
if ! [[ "$SEED" =~ ^[1-9][0-9]*$ ]]; then echo "invalid DEMO_SCENARIO_SEED" >&2; exit 2; fi
"$NODE" "$ROOT/scripts/interactive/scenario-manager.mjs" "$SEED" >"$ROOT/artifacts/demo-rescue/scenario-selection.json"
"$NODE" "$ROOT/scripts/interactive/solvability-gate.mjs" >"$ROOT/artifacts/demo-rescue/solvability-validation.json"
# The stack and dashboard remain on the real ROS2/Gazebo/MCP path.
"$ROOT/scripts/interactive/start.sh" >"$ROOT/artifacts/demo-rescue/logs/start.log" 2>&1
PREFLIGHT=$(curl -fsS http://127.0.0.1:4188/api/system/preflight)
if ! grep -q '"pass": true' <<<"$PREFLIGHT"; then
  echo "$PREFLIGHT" >"$ROOT/artifacts/demo-rescue/logs/preflight-failure.json"
  echo "demo preflight failed" >&2
  exit 1
fi
printf '%s\n' "$PREFLIGHT" >"$ROOT/artifacts/demo-rescue/logs/preflight.json"
cat >"$ROOT/artifacts/demo-rescue/runtime-state/active.json" <<EOF
{"started_at":"$(date -Is)","seed":$SEED,"layout":"$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["layout_id"])' "$ROOT/artifacts/interactive-live/current-scenario.json")","real_runtime":true,"mcp_round_trip":true,"robot_mcp_tools":8}
EOF
echo "DEMO LIVE READY seed=$SEED http://127.0.0.1:4188"
