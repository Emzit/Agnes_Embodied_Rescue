#!/usr/bin/env bash
set -euo pipefail
ROOT=/data-ssd/zhongchengkai/agnes
if ! curl -fsS http://127.0.0.1:4188/api/system/preflight >"$ROOT/artifacts/demo-rescue/status-preflight.json"; then
  echo "DEMO NOT READY: dashboard/preflight unavailable" >&2; exit 1
fi
if ! grep -q '"pass": true' "$ROOT/artifacts/demo-rescue/status-preflight.json"; then
  echo "DEMO DEGRADED: preflight failed" >&2; cat "$ROOT/artifacts/demo-rescue/status-preflight.json"; exit 1
fi
curl -fsS http://127.0.0.1:4188/api/mission/current >"$ROOT/artifacts/demo-rescue/status-mission.json"
curl -fsS http://127.0.0.1:4188/api/camera/latest-meta >"$ROOT/artifacts/demo-rescue/status-camera.json"
if [[ ! -s "$ROOT/artifacts/interactive-live/provider-runtime-status.json" ]]; then echo 'DEMO DEGRADED: MCP round-trip artifact missing' >&2; exit 1; fi
python3 - "$ROOT/artifacts/demo-rescue/status-preflight.json" "$ROOT/artifacts/demo-rescue/status-mission.json" "$ROOT/artifacts/demo-rescue/status-camera.json" "$ROOT/artifacts/interactive-live/provider-runtime-status.json" <<'PY'
import json,sys
p,m,c,r=[json.load(open(x)) for x in sys.argv[1:]]
tools=(r.get('mcp') or {}).get('tools',[])
rt=r.get('managed_mcp_roundtrip') or {}
print('DEMO READY')
print('preflight_pass=',p.get('pass'),'robot_tools=',len(tools),'camera_fresh=',c.get('available',False),'mission=',m.get('status'),'roundtrip=',rt.get('pass'))
if r.get('pass') is not True or len(tools)!=8 or rt.get('pass') is not True: raise SystemExit('real MCP round-trip readiness failed')
PY
