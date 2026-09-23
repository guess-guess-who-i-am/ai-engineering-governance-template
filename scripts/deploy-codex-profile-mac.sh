#!/usr/bin/env sh
set -eu

if [ "$(uname -s)" != "Darwin" ]; then
  printf '%s\n' "This deployment supports macOS only." >&2
  exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

# The sibling private mirror stays outside the public template repository.
if [ -z "${CODEX_PROFILE_SKILL_SOURCE:-}" ] && [ -f "$script_dir/../../skills/_catalog_cn.json" ]; then
  export CODEX_PROFILE_SKILL_SOURCE=$(CDPATH= cd -- "$script_dir/../../skills" && pwd)
fi

if [ -z "${CODEX_PROFILE_SKILL_SOURCE:-}" ]; then
  printf '%s\n' "Warning: sibling Skill library was not found; only the 22 owned global Skills will be deployed." >&2
fi

"$script_dir/install-codex-profile-mac.sh" "$@"
if [ -x "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node" ]; then
  node_bin="/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node"
elif command -v node >/dev/null 2>&1; then
  node_bin=$(command -v node)
else
  printf '%s\n' "Codex bundled Node.js was not found. Install ChatGPT/Codex or add Node.js to PATH." >&2
  exit 1
fi
"$node_bin" "$script_dir/install-task-tree-mcp-mac.mjs" "$@"
"$script_dir/install-codex-profile-service-mac.sh" "$@"
"$script_dir/install-codex-profile-mac.sh" "$@" --check
"$node_bin" "$script_dir/install-task-tree-mcp-mac.mjs" "$@" --check
"$script_dir/install-codex-profile-service-mac.sh" "$@" --check

printf '%s\n' "Global Codex profile deployment passed and is available to every Codex workspace for this user."
printf '%s\n' "Restart Codex if this installation changed Hooks or AGENTS.md."
