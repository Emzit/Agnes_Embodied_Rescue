#!/usr/bin/env bash
set -euo pipefail

ROOT="/data-ssd/zhongchengkai/agnes"
cd "$ROOT"

source ./scripts/use-local-toolchain.sh

export AGH_HOME="$ROOT/.agh-home-step7"
export TMPDIR="$ROOT/.tmp"
export XDG_CACHE_HOME="$ROOT/.cache"
export HTTP_PROXY="http://127.0.0.1:7898"
export HTTPS_PROXY="http://127.0.0.1:7898"
export http_proxy="http://127.0.0.1:7898"
export https_proxy="http://127.0.0.1:7898"
export NO_PROXY="127.0.0.1,localhost"
export no_proxy="127.0.0.1,localhost"
export NODE_USE_ENV_PROXY="1"
export XDG_CONFIG_HOME="$ROOT/.runtime-step7/config"
export XDG_DATA_HOME="$ROOT/.runtime-step7/data"
export HOME="$ROOT/.runtime-step7/home"
export AGNES_PROFILE="local-dev"
export AGNES_MCP_STDIO_ALLOWLIST="$ROOT/tools/node/bin/node"

mkdir -p "$ROOT/.tmp" "$ROOT/.cache" "$ROOT/logs/step7" "$ROOT/.runtime-step7"

cleanup() {
  unset AGNES_STEP7_API_KEY
}
trap cleanup EXIT

HARNESS="$ROOT/third_party/agnes-harness"
CLI="$HARNESS/packages/cli/dist/local/agnes.mjs"

if [ -f "$AGH_HOME/data/daemon/owner.json" ]; then
  if (cd "$HARNESS" && node "$CLI" daemon status >/dev/null 2>&1); then
    (cd "$HARNESS" && node "$CLI" daemon stop) || true
  fi
fi

WEB_PID_FILE="$ROOT/.runtime-step7/step7-web.pid"
if [ -f "$WEB_PID_FILE" ]; then
  web_pid="$(sed -n '1p' "$WEB_PID_FILE")"
  if [[ "$web_pid" =~ ^[0-9]+$ ]] && [ -r "/proc/$web_pid/cmdline" ]; then
    cmdline="$(tr '\0' ' ' < "/proc/$web_pid/cmdline")"
    case "$cmdline" in
      *"$HARNESS/packages/cli/dist/local/agnes.mjs serve --port 4177"*)
        kill -TERM "$web_pid" 2>/dev/null || true
        ;;
    esac
  fi
fi

read -r -s -p "Agnes API Key: " AGNES_STEP7_API_KEY
echo
export AGNES_STEP7_API_KEY

node --import "$HARNESS/node_modules/tsx/dist/loader.mjs" \
  "$ROOT/scripts/configure-step7-agnes-provider.ts"

nohup bash "$ROOT/scripts/start-step7-agnes.sh" \
  > "$ROOT/logs/step7/agnes-web-provider-config.log" 2>&1 &
web_pid=$!
printf '%s\n' "$web_pid" > "$WEB_PID_FILE"

daemon_running=false
for _ in $(seq 1 100); do
  status_json="$(cd "$HARNESS" && node "$CLI" daemon status 2>/dev/null || true)"
  if [[ "$status_json" == *'"running":true'* ]]; then
    daemon_running=true
    break
  fi
  sleep 0.2
done

web_ready=false
ws_port=""
for _ in $(seq 1 100); do
  html="$(curl --noproxy '*' -fsS http://127.0.0.1:4177/ 2>/dev/null || true)"
  ws_url="$(printf '%s\n' "$html" | sed -n 's/.*data-ws="\([^"]*\)".*/\1/p' | head -n 1)"
  ws_port="$(printf '%s' "$ws_url" | sed -n 's#.*:\([0-9][0-9]*\)/.*#\1#p')"
  if [ -n "$ws_port" ] && (ss -ltn 2>/dev/null || true) | awk -v p=":$ws_port" '$4 ~ p"$" {found=1} END {exit(found ? 0 : 1)}'; then
    web_ready=true
    break
  fi
  sleep 0.2
done

printf 'DAEMON_RUNNING=%s\n' "$daemon_running"
printf 'WEB_PORT=4177\n'
printf 'WEBSOCKET_PORT=%s\n' "$ws_port"

if [ "$daemon_running" != true ] || [ "$web_ready" != true ]; then
  exit 1
fi
