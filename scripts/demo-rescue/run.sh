#!/usr/bin/env bash
set -euo pipefail
ROOT=/data-ssd/zhongchengkai/agnes
DASH=http://127.0.0.1:4188
"$ROOT/scripts/demo-rescue/status.sh" >/dev/null
curl -fsS -X POST "$DASH/api/scene/reset" -H 'content-type: application/json' -d '{}' >"$ROOT/artifacts/demo-rescue/last-reset.json"
TASK="进入当前真实场景寻找失联研究员；如果实时路径受阻，请依据 Camera、LiDAR 和 Nav2 自主绕行；必要时检查并打开可交互的门；用 Camera 搜索并复检人员，完成后返回起点并报告观察到的环境风险。只能使用当前真实 Gazebo、Nav2、Robot MCP 和 Environment Interaction MCP。"
START=$(curl -fsS -X POST "$DASH/api/mission/start" -H 'content-type: application/json' --data-binary "$(python3 -c 'import json,sys; print(json.dumps({"task":sys.argv[1]},ensure_ascii=False))' "$TASK")")
printf '%s\n' "$START" >"$ROOT/artifacts/demo-rescue/last-start.json"
MID=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["mission_id"])' <<<"$START")
printf '%s\n' "$MID" >"$ROOT/artifacts/demo-rescue/last-mission-id"
DEADLINE=$((SECONDS+${DEMO_TIMEOUT_SEC:-1200}))
while (( SECONDS < DEADLINE )); do
  curl -fsS "$DASH/api/mission/current" >"$ROOT/artifacts/demo-rescue/last-current.json" || true
  STATUS=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("status",""))' "$ROOT/artifacts/demo-rescue/last-current.json" 2>/dev/null || true)
  case "$STATUS" in SUCCEEDED|PARTIAL|FAILED|FAILED_PRECHECK|CANCELED) break;; esac
  sleep 2
done
curl -fsS "$DASH/api/mission/current" >"$ROOT/artifacts/demo-rescue/last-current.json"
python3 - "$ROOT/artifacts/demo-rescue/last-current.json" "$MID" <<'PY'
import json,sys
m=json.load(open(sys.argv[1])); print(json.dumps({'mission_id':sys.argv[2],'status':m.get('status'),'stage':m.get('current_stage')},ensure_ascii=False))
PY
