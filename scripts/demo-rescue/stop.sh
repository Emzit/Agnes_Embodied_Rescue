#!/usr/bin/env bash
set -euo pipefail
ROOT=/data-ssd/zhongchengkai/agnes
DASH=http://127.0.0.1:4188
if curl -fsS "$DASH/api/mission/current" >"$ROOT/artifacts/demo-rescue/stop-current.json" 2>/dev/null; then
  status=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("status",""))' "$ROOT/artifacts/demo-rescue/stop-current.json" || true)
  case "$status" in PRECHECK_RUNNING|READY|STARTING|RUNNING|CANCELING) curl -fsS -X POST "$DASH/api/mission/stop" -H 'content-type: application/json' -d '{}' >"$ROOT/artifacts/demo-rescue/stop-result.json" || true; sleep 2;; esac
fi
"$ROOT/scripts/interactive/stop.sh" >/dev/null 2>&1 || true
STATE="$ROOT/artifacts/demo-rescue/runtime-state"
IMPORTED="$ROOT/artifacts/interactive-live/imported-map.env"
if [[ -f "$STATE/imported-map.env" && ! -f "$IMPORTED" ]]; then mv "$STATE/imported-map.env" "$IMPORTED"; fi
rm -f "$STATE/active.json"
echo DEMO STOPPED
