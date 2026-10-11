#!/usr/bin/env sh
set -eu

stub_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_root=$(
  "$stub_dir/run-node.sh" --input-type=module - "$stub_dir/task-tree.config.json" "$stub_dir" <<'NODE'
import { readFile } from "node:fs/promises";
import path from "node:path";
const [configFile, stubDir] = process.argv.slice(2);
const config = JSON.parse((await readFile(configFile, "utf8")).replace(/^\uFEFF/, ""));
process.stdout.write(path.resolve(stubDir, String(config.projectRoot || "..")));
NODE
)
kit_dir=$(
  TASK_TREE_KIT_DIR="${TASK_TREE_KIT_DIR:-}" "$stub_dir/run-node.sh" --input-type=module - "$stub_dir/task-tree.config.json" "$project_root" <<'NODE'
import { readFile } from "node:fs/promises";
import path from "node:path";
const [configFile, projectRoot] = process.argv.slice(2);
const config = JSON.parse((await readFile(configFile, "utf8")).replace(/^\uFEFF/, ""));
process.stdout.write(path.resolve(projectRoot, process.env.TASK_TREE_KIT_DIR || String(config.sharedKitDir || "")));
NODE
)

exec env NODE_BIN="${NODE_BIN:-/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node}" "$kit_dir/open-task-tree-macos.sh" "$stub_dir" "$@"
