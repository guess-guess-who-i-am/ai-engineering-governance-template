#!/usr/bin/env sh
set -eu

if [ -n "${NODE_BIN:-}" ] && [ -x "$NODE_BIN" ]; then
  node_bin=$NODE_BIN
elif [ -x "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node" ]; then
  node_bin="/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node"
elif command -v node >/dev/null 2>&1; then
  node_bin=$(command -v node)
else
  printf '%s\n' "Node.js was not found. Install Codex/ChatGPT or add Node.js to PATH." >&2
  exit 1
fi

exec "$node_bin" "$@"
