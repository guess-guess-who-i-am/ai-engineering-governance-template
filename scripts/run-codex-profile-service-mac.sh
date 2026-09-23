#!/usr/bin/env sh
set -u

home_root=${HOME:-$(/usr/bin/dscl . -read /Users/$(/usr/bin/whoami) NFSHomeDirectory | /usr/bin/awk '{print $2}')}
profile_root=${CODEX_PROFILE_SOURCE:-$home_root/.codex/tools/ai-engineering-governance-template}
skill_source=${CODEX_PROFILE_SKILL_SOURCE:-$home_root/.codex/tools/skills}
deploy="$profile_root/scripts/deploy-codex-profile-mac.sh"
runtime_root="$home_root/.codex/tools/llm-task-tree/llm-task-tree-kit"
catalog_source=${CODEX_PROFILE_SKILL_CATALOG:-$home_root/.codex/tools/skills/_catalog_cn.json}
if [ -f "$skill_source/_catalog_cn.json" ]; then
  export CODEX_PROFILE_SKILL_SOURCE="$skill_source"
fi
if [ -f "$catalog_source" ]; then
  export CODEX_PROFILE_SKILL_CATALOG="$catalog_source"
fi

if [ ! -x "$deploy" ]; then
  title="Codex 全局配置部署失败"
  message="找不到已安装的全局部署源，请先从治理仓库执行一次部署。"
  exit_code=1
else
  set +e
  if [ -f "$runtime_root/scripts/mcp-server.mjs" ]; then
    export TASK_TREE_RUNTIME_ROOT="$runtime_root"
  fi
  message=$("$deploy" --home "$home_root" 2>&1)
  exit_code=$?
  set -e
  if [ "$exit_code" -eq 0 ]; then
    title="Codex 全局配置已部署"
  else
    title="Codex 全局配置部署失败"
  fi
fi

message=$(printf '%s\n' "$message" | /usr/bin/tail -c 1200)
/usr/bin/osascript - "$title" "$message" <<'APPLESCRIPT' >/dev/null 2>&1 || true
on run argv
  display notification (item 2 of argv) with title (item 1 of argv)
end run
APPLESCRIPT

exit "$exit_code"
