#!/usr/bin/env bash
set -euo pipefail
source /data-ssd/zhongchengkai/agnes/scripts/final-rescue/env.sh
exec /usr/bin/python3 "$FINAL_ROOT/scripts/phase9d/stack.py" stop
