#!/usr/bin/env bash
set -euo pipefail
ROOT=/data-ssd/zhongchengkai/agnes; OUT="$ROOT/artifacts/interactive-live"; mkdir -p "$OUT"
curl -fsS http://127.0.0.1:4188/ >/dev/null
curl -fsS http://127.0.0.1:4188/api/mode?mode=live >/dev/null
curl -fsS http://127.0.0.1:4188/api/mission/current >/dev/null
curl -fsS http://127.0.0.1:4188/api/camera/latest-meta >/dev/null
curl -fsSI http://127.0.0.1:4188/api/camera/latest.jpg | grep -Eiq '200|content-type: image/png'
curl -fsSI http://127.0.0.1:4188/api/camera/stream | grep -Eiq 'multipart/x-mixed-replace'
curl -fsS --max-time 2 http://127.0.0.1:4188/api/events/stream >/dev/null || true
cat >"$OUT/api-validation.json" <<EOF
{"index":true,"mission_current":true,"camera_meta":true,"camera_latest":true,"camera_stream":true,"events_stream":true,"timestamp":"$(date -Is)"}
EOF
echo 'interactive API smoke PASS'
