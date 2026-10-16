#!/usr/bin/env bash
set -euo pipefail
ROOT=/data-ssd/zhongchengkai/agnes
source "$ROOT/scripts/final-rescue/env.sh"
cd "$ROOT"
tmp_status="$ROOT/.tmp/demo-live-status.$$"
if ! "$ROOT/scripts/final-rescue/status.sh" >"$tmp_status" 2>&1; then
  status=$?
  cat "$tmp_status" >&2 || true
  rm -f "$tmp_status"
  echo "final_rescue stack is not ready; live data was not fabricated" >&2
  exit "$status"
fi
rm -f "$tmp_status"
out="$ROOT/artifacts/demo/live-smoke-$(date +%Y%m%d-%H%M%S)"
"$ROOT/tools/node/bin/node" "$ROOT/scripts/demo/live-smoke.mjs" "$out"
echo "Live read-only smoke evidence: $out"
echo "Live dashboard: http://127.0.0.1:4188/?mode=live"
