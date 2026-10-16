#!/usr/bin/env bash
set -euo pipefail
ROOT=/data-ssd/zhongchengkai/agnes
NODE="$ROOT/tools/node/bin/node"
SHOWCASE="${SHOWCASE_OUTPUT_ROOT:-$ROOT/artifacts/demo/showcase-live-run}"
REPLAY_NAME="${SHOWCASE_REPLAY_NAME:-showcase}"
REPLAY_OUTPUT="${SHOWCASE_REPLAY_OUTPUT:-$ROOT/artifacts/demo/replay-${REPLAY_NAME}.json}"
cd "$ROOT"
if [[ -e "$SHOWCASE" ]]; then
  echo "Refusing to overwrite existing showcase-live-run; move it under the workspace first." >&2
  exit 2
fi
mkdir -p "$SHOWCASE/run1"
export FINAL_ARTIFACTS_ROOT="$SHOWCASE"
export FINAL_RUN_DIR="$SHOWCASE/run1"
source "$ROOT/scripts/final-rescue/env.sh"
stack_log="$SHOWCASE/stack.log"
"$ROOT/scripts/final-rescue/start-stack.sh" >"$stack_log" 2>&1 &
stack_pid=$!
ready=0
for _ in {1..180}; do
  if grep -q FINAL_RESCUE_STACK_STARTED "$stack_log" 2>/dev/null; then ready=1; break; fi
  sleep 1
done
if [[ "$ready" != 1 ]]; then
  echo "ROS2/Gazebo stack did not become ready; see $stack_log" >&2
  "$ROOT/scripts/final-rescue/stop-stack.sh" || true
  exit 1
fi
"$NODE" "$ROOT/third_party/agnes-harness/packages/cli/dist/local/agnes.mjs" daemon start
"$NODE" "$ROOT/scripts/demo/showcase-camera-capture.mjs" "$SHOWCASE" >"$SHOWCASE/camera-capture.log" 2>&1 &
capture_pid=$!
set +e
"$NODE" "$ROOT/third_party/agnes-harness/node_modules/tsx/dist/cli.mjs" "$ROOT/scripts/final-rescue/mission.mts" run 1 >"$SHOWCASE/mission.log" 2>&1
mission_status=$?
set -e
touch "$SHOWCASE/.capture-stop"
wait "$capture_pid" || true
"$NODE" "$ROOT/scripts/demo/organize-showcase-evidence.mjs" "$SHOWCASE"
"$NODE" "$ROOT/third_party/agnes-harness/packages/cli/dist/local/agnes.mjs" daemon stop || true
"$ROOT/scripts/final-rescue/stop-stack.sh" || true
if [[ "$mission_status" != 0 || ! -f "$SHOWCASE/run1/final-report.txt" ]]; then
  echo "showcase mission failed; see $SHOWCASE/mission.log" >&2
  exit 1
fi
if ! "$NODE" -e "const x=require(process.argv[1]); process.exit(x.mission_success && x.scenario_coverage?.dynamic_block_triggered && x.person_observed ? 0 : 1)" "$SHOWCASE/run1/acceptance.json"; then
  echo "showcase mission produced incomplete story evidence; see $SHOWCASE/run1/acceptance.json" >&2
  exit 1
fi
REPLAY_INPUT_ROOT="$SHOWCASE" REPLAY_RUN=1 REPLAY_OUTPUT_FILE="$REPLAY_OUTPUT" "$NODE" "$ROOT/scripts/demo/build-replay-data.mjs"
"$ROOT/scripts/demo/start-dashboard.sh"
echo "Showcase replay: http://127.0.0.1:4188/?mode=replay&run=$REPLAY_NAME"
echo "Showcase evidence: $SHOWCASE"
