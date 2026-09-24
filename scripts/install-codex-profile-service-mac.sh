#!/usr/bin/env sh
set -eu

if [ "$(uname -s)" != "Darwin" ]; then
  printf '%s\n' "The Finder Quick Action supports macOS only." >&2
  exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repository_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
source_workflow="$repository_root/codex-profile/mac/quick-actions/部署 Codex 全局配置.workflow"
home_root=${HOME:-$(/usr/bin/dscl . -read /Users/$(/usr/bin/whoami) NFSHomeDirectory | /usr/bin/awk '{print $2}')}
check=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --home)
      [ "$#" -ge 2 ] || { printf '%s\n' "--home requires a path" >&2; exit 2; }
      home_root=$2
      shift 2
      ;;
    --check)
      check=1
      shift
      ;;
    --json)
      shift
      ;;
    *)
      printf '%s\n' "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

source_destination="$home_root/.codex/tools/ai-engineering-governance-template"
source_temporary="$home_root/.codex/tools/.ai-engineering-governance-template.install-$$"
skills_destination="$home_root/.codex/tools/skills"
skills_source=${CODEX_PROFILE_SKILL_SOURCE:-}
skills_catalog=${CODEX_PROFILE_SKILL_CATALOG:-}
if [ -n "$skills_source" ] && [ ! -d "$skills_source" ]; then
  printf '%s\n' "Skill source directory does not exist: $skills_source" >&2
  exit 1
fi
if [ -z "$skills_source" ] && [ -f "$repository_root/../../skills/_catalog_cn.json" ]; then
  skills_source=$(CDPATH= cd -- "$repository_root/../../skills" && pwd)
fi
if [ -z "$skills_source" ] && [ -d "$home_root/.codex/tools/skills" ]; then
  skills_source="$home_root/.codex/tools/skills"
fi
if [ -n "$skills_source" ] && [ -z "$skills_catalog" ]; then
  skills_catalog="$skills_source/_catalog_cn.json"
fi
runtime_destination="$home_root/.codex/tools/llm-task-tree/llm-task-tree-kit"
runtime_source=${TASK_TREE_RUNTIME_ROOT:-}
if [ -z "$runtime_source" ] && [ -d "$repository_root/../llm-task-tree-macos/llm-task-tree-kit" ]; then
  runtime_source="$repository_root/../llm-task-tree-macos/llm-task-tree-kit"
fi
if [ -z "$runtime_source" ] && [ -d "$runtime_destination" ]; then
  runtime_source="$runtime_destination"
fi
destination="$home_root/Library/Services/部署 Codex 全局配置.workflow"
if [ ! -f "$source_workflow/Contents/document.wflow" ]; then
  printf '%s\n' "Finder Quick Action source is missing: $source_workflow" >&2
  exit 1
fi

if [ "$check" -eq 1 ]; then
  source_current=0
  if [ -d "$source_destination" ] && [ -x "$source_destination/scripts/run-codex-profile-service-mac.sh" ] && [ -d "$source_destination/codex-profile" ] && /usr/bin/diff -qr "$repository_root/codex-profile" "$source_destination/codex-profile" >/dev/null 2>&1; then
    source_current=1
    for script in \
      deploy-codex-profile-mac.sh \
      install-codex-profile-mac.sh \
      install-codex-profile-mac.mjs \
      install-task-tree-mcp-mac.mjs \
      install-codex-profile-service-mac.sh \
    run-codex-profile-service-mac.sh \
      test-codex-profile-mac.mjs \
      parallel-run.mjs
    do
      if ! /usr/bin/cmp -s "$repository_root/scripts/$script" "$source_destination/scripts/$script"; then
        source_current=0
        break
      fi
    done
    if [ -n "$skills_source" ] && [ -d "$skills_source" ] && [ -d "$skills_destination" ]; then
      if ! /usr/bin/diff -qr --exclude='.git' --exclude='_catalog_cn.json' "$skills_source" "$skills_destination" >/dev/null 2>&1; then
        source_current=0
      fi
    fi
    if [ -n "$skills_catalog" ] && [ -f "$skills_catalog" ] && [ -f "$skills_destination/_catalog_cn.json" ] && ! /usr/bin/cmp -s "$skills_catalog" "$skills_destination/_catalog_cn.json"; then
      source_current=0
    fi
  fi
  skills_current=1
  if [ -n "$skills_source" ] && [ -d "$skills_destination" ] && ! /usr/bin/diff -qr --exclude='.git' --exclude='_catalog_cn.json' "$skills_source" "$skills_destination" >/dev/null 2>&1; then
    skills_current=0
  fi
  if [ -n "$skills_catalog" ] && [ -f "$skills_catalog" ] && [ -f "$skills_destination/_catalog_cn.json" ] && ! /usr/bin/cmp -s "$skills_catalog" "$skills_destination/_catalog_cn.json"; then
    skills_current=0
  fi
  if [ "$source_current" -eq 1 ] && [ "$skills_current" -eq 1 ] && [ -f "$runtime_destination/scripts/mcp-server.mjs" ] && [ -d "$destination" ] && /usr/bin/diff -qr "$source_workflow" "$destination" >/dev/null 2>&1; then
    printf '%s\n' "Finder Quick Action: current"
    exit 0
  fi
  printf '%s\n' "Finder Quick Action: missing or stale" >&2
  exit 1
fi

if [ -n "$skills_source" ] && [ "$skills_source" != "$skills_destination" ]; then
  /bin/mkdir -p "$home_root/.codex/tools"
  /bin/mkdir -p "$skills_destination"
  previous_manifest="$home_root/.codex/skill-registry/external-library-manifest.json"
  if [ -f "$previous_manifest" ]; then
    while IFS= read -r relative_path; do
      case "$relative_path" in
        ""|/*|*../*|../*|*/..|..|_catalog_cn.json) continue ;;
      esac
      destination_file="$skills_destination/$relative_path"
      source_file="$skills_source/$relative_path"
      if [ ! -f "$source_file" ] && [ -f "$destination_file" ]; then
        expected_hash=$(/usr/bin/awk -v key="\"$relative_path\"" '$0 ~ key {getline; gsub(/[", ]/, "", $2); print $2; exit}' "$previous_manifest")
        actual_hash=$(/usr/bin/shasum -a 256 "$destination_file" | /usr/bin/awk '{print $1}')
        if [ -n "$expected_hash" ] && [ "$expected_hash" = "$actual_hash" ]; then
          /bin/rm -f "$destination_file"
        fi
      fi
    done <<EOF
$(/usr/bin/awk -F '"relativePath": ' '/"relativePath"/ {gsub(/[",]/, "", $2); print $2}' "$previous_manifest")
EOF
  fi
  if [ -f "$skills_catalog" ] && [ "$skills_catalog" != "$skills_source/_catalog_cn.json" ]; then
    /usr/bin/rsync -a --exclude='/.git/' --exclude='/_catalog_cn.json' "$skills_source/" "$skills_destination/"
    /usr/bin/ditto "$skills_catalog" "$skills_destination/_catalog_cn.json"
  else
    /usr/bin/rsync -a --exclude='/.git/' "$skills_source/" "$skills_destination/"
  fi
fi

if [ "$repository_root" != "$source_destination" ]; then
  /bin/mkdir -p "$home_root/.codex/tools"
  /bin/rm -rf "$source_temporary"
  /bin/mkdir -p "$source_temporary/scripts"
  /usr/bin/ditto "$repository_root/codex-profile" "$source_temporary/codex-profile"
  for script in \
    deploy-codex-profile-mac.sh \
    install-codex-profile-mac.sh \
    install-codex-profile-mac.mjs \
    install-task-tree-mcp-mac.mjs \
    install-codex-profile-service-mac.sh \
    run-codex-profile-service-mac.sh \
    test-codex-profile-mac.mjs \
    parallel-run.mjs
  do
    /usr/bin/ditto "$repository_root/scripts/$script" "$source_temporary/scripts/$script"
  done
  /bin/chmod 700 "$source_temporary/scripts"/*.sh "$source_temporary/scripts"/*.mjs
  /bin/rm -rf "$source_destination"
  /bin/mv "$source_temporary" "$source_destination"
fi

if [ -n "$runtime_source" ] && [ "$runtime_source" != "$runtime_destination" ] && [ -f "$runtime_source/scripts/mcp-server.mjs" ]; then
  runtime_temporary="$home_root/.codex/tools/.llm-task-tree.install-$$"
  /bin/rm -rf "$runtime_temporary"
  /bin/mkdir -p "$(/usr/bin/dirname "$runtime_temporary")"
  /usr/bin/ditto "$runtime_source" "$runtime_temporary"
  /bin/rm -rf "$runtime_destination"
  /bin/mkdir -p "$(/usr/bin/dirname "$runtime_destination")"
  /bin/mv "$runtime_temporary" "$runtime_destination"
fi

services_root="$home_root/Library/Services"
temporary="$services_root/.部署 Codex 全局配置.workflow.install-$$"
/bin/mkdir -p "$services_root"
/bin/rm -rf "$temporary"
/usr/bin/ditto "$source_workflow" "$temporary"
/bin/rm -rf "$destination"
/bin/mv "$temporary" "$destination"

printf '%s\n' "Finder Quick Action installed: $destination"
