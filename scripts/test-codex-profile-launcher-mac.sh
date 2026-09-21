#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -x "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node" ]; then
  node_bin="/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node"
elif command -v node >/dev/null 2>&1; then
  node_bin=$(command -v node)
else
  printf '%s\n' "Codex bundled Node.js was not found. Install ChatGPT/Codex or add Node.js to PATH." >&2
  exit 1
fi
exec "$node_bin" "$script_dir/test-codex-profile-launcher-mac.mjs"
