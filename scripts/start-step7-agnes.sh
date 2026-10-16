#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
AGNES_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
source "$AGNES_ROOT/scripts/use-local-toolchain.sh"

export AGH_HOME="$AGNES_ROOT/.agh-home-step7"
export TMPDIR="$AGNES_ROOT/.tmp"
export XDG_CACHE_HOME="$AGNES_ROOT/.cache"
proxy_is_listening() {
  local value="$1" host port
  [[ "$value" =~ ^https?://([^:/]+):([0-9]+)$ ]] || return 1
  host="${BASH_REMATCH[1]}"; port="${BASH_REMATCH[2]}"
  [[ "$host" == "127.0.0.1" || "$host" == "localhost" ]] || return 1
  (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null
}
proxy_candidates=("${AGNES_PROXY_URL:-}" "${ALL_PROXY:-}" "${HTTP_PROXY:-}"
  "http://127.0.0.1:8118" "http://127.0.0.1:7898" "http://127.0.0.1:7899")
ACTIVE_PROXY=""
for candidate in "${proxy_candidates[@]}"; do
  [[ -n "$candidate" ]] || continue
  if proxy_is_listening "$candidate"; then ACTIVE_PROXY="$candidate"; break; fi
done
if [[ -n "$ACTIVE_PROXY" ]]; then
  export HTTP_PROXY="$ACTIVE_PROXY" HTTPS_PROXY="$ACTIVE_PROXY"
  export http_proxy="$ACTIVE_PROXY" https_proxy="$ACTIVE_PROXY"
fi
export NO_PROXY="127.0.0.1,localhost"
export no_proxy="127.0.0.1,localhost"
export NODE_USE_ENV_PROXY="1"
export XDG_CONFIG_HOME="$AGNES_ROOT/.runtime-step7/config"
export XDG_DATA_HOME="$AGNES_ROOT/.runtime-step7/data"
export HOME="$AGNES_ROOT/.runtime-step7/home"
export AGNES_PROFILE="local-dev"
export AGNES_MCP_STDIO_ALLOWLIST="$AGNES_ROOT/tools/node/bin/node"

mkdir -p "$AGH_HOME/profiles/local-dev" "$TMPDIR" "$XDG_CACHE_HOME" \
  "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$HOME" "$AGNES_ROOT/logs/step7"

exec node "$AGNES_ROOT/scripts/agnes-proxy/web.mjs" \
  serve --port "${AGNES_STEP7_PORT:-4177}"
