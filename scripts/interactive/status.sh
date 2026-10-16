#!/usr/bin/env bash
set -euo pipefail
ROOT=/data-ssd/zhongchengkai/agnes; OUT="$ROOT/artifacts/interactive-live"
echo "Dashboard: $(curl -fsS 'http://127.0.0.1:4188/api/mode?mode=live' 2>/dev/null || echo unavailable)"
echo "Mission: $(curl -fsS http://127.0.0.1:4188/api/mission/current 2>/dev/null || echo unavailable)"
echo "Camera: $(curl -fsS http://127.0.0.1:4188/api/camera/latest-meta 2>/dev/null || echo unavailable)"
echo "Stack status:"
if [[ -f "$ROOT/artifacts/final_rescue/stack-status.json" ]]; then cat "$ROOT/artifacts/final_rescue/stack-status.json"; else echo unavailable; fi
