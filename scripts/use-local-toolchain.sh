#!/usr/bin/env bash

# Source this file; it intentionally does not edit shell startup files.
_AGNES_TOOLCHAIN_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
_AGNES_TOOLCHAIN_ROOT="$(cd -- "${_AGNES_TOOLCHAIN_SCRIPT_DIR}/.." && pwd)"

export PATH="${_AGNES_TOOLCHAIN_ROOT}/tools/node/bin:${PATH}"
export COREPACK_HOME="${_AGNES_TOOLCHAIN_ROOT}/.corepack"
export XDG_CACHE_HOME="${_AGNES_TOOLCHAIN_ROOT}/.cache"
export npm_config_cache="${_AGNES_TOOLCHAIN_ROOT}/.cache/npm"
export PNPM_HOME="${_AGNES_TOOLCHAIN_ROOT}/.pnpm-home"
export pnpm_config_store_dir="${_AGNES_TOOLCHAIN_ROOT}/.pnpm-store"
export TMPDIR="${_AGNES_TOOLCHAIN_ROOT}/.tmp"

mkdir -p \
  "${COREPACK_HOME}" \
  "${npm_config_cache}" \
  "${PNPM_HOME}" \
  "${pnpm_config_store_dir}" \
  "${TMPDIR}"

unset _AGNES_TOOLCHAIN_SCRIPT_DIR
unset _AGNES_TOOLCHAIN_ROOT
