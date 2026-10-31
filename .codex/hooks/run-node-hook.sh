#!/bin/sh
set -eu

case "${1:-}" in
  turn-start.mjs|stop-postflight.mjs) hook_name=$1 ;;
  *) printf '%s\n' 'Unsupported project Hook entry' >&2; exit 64 ;;
esac
hook_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if [ -n "${CODEX_NODE:-}" ] && [ -x "$CODEX_NODE" ]; then
  node_bin=$CODEX_NODE
elif command -v node >/dev/null 2>&1; then
  node_bin=$(command -v node)
else
  node_bin=
  for candidate in \
    "${CODEX_HOME:-$HOME/.codex}/tools/node/bin/node" \
    /Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node \
    /Applications/Codex.app/Contents/Resources/cua_node/bin/node \
    /opt/homebrew/bin/node \
    /usr/local/bin/node; do
    if [ -x "$candidate" ]; then node_bin=$candidate; break; fi
  done
fi

if [ -z "$node_bin" ]; then
  printf '%s\n' 'Node.js runtime not found; set CODEX_NODE or install Node.js 20+.' >&2
  exit 127
fi
if [ "${2:-}" = "--resolve-node" ]; then
  printf '%s\n' "$node_bin"
  exit 0
fi
exec "$node_bin" "$hook_dir/$hook_name"
