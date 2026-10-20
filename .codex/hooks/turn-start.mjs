import { loadTaskTreeModule } from "../../llm-task-tree/runtime-location.mjs";
import { snapshotWorkspace } from './workspace-snapshot.mjs';
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

async function readStdinJson() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  try { return JSON.parse(text || "{}"); } catch { return {}; }
}

function safe(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
}

function locateRoot(start) {
  let current = path.resolve(start || process.cwd());
  while (true) {
    if (existsSync(path.join(current, "task-trees.json")) || existsSync(path.join(current, "task-tree.md"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(start || process.cwd());
    current = parent;
  }
}


const input = await readStdinJson();
const root = locateRoot(input.cwd || process.cwd());
const [{ buildTaskTreeCheckpointContext }, { createExecutionScopeStore }] = await Promise.all([
  loadTaskTreeModule(root, "turn-context.js"),
  loadTaskTreeModule(root, "execution-scope.js")
]);
const dir = path.join(root, ".task-tree-maintenance", "turns");
await mkdir(dir, { recursive: true });
const baseline = await snapshotWorkspace(root);
let activeTree = { id: "method", title: "方法迭代", path: "task-tree.md" };
try {
  const registry = JSON.parse(await readFile(path.join(root, "task-trees.json"), "utf8"));
  activeTree = registry.trees?.find((tree) => tree.id === registry.activeMethod) || activeTree;
} catch {
  // Single-tree projects use task-tree.md.
}
const activeTreePath = activeTree.path || "task-tree.md";
let activeTreeMarkdown = "";
try { activeTreeMarkdown = await readFile(path.join(root, activeTreePath), "utf8"); } catch { activeTreeMarkdown = ""; }
const marker = {
  schema: "task-tree-turn/v1",
  sessionId: input.session_id || "",
  turnId: input.turn_id || "",
  cwd: input.cwd || process.cwd(),
  startedAt: new Date().toISOString(),
  startedAtMs: Date.now(),
  baseline,
  activeTreePath,
  activeTreeMarkdown
};
await writeFile(path.join(dir, `${safe(input.session_id)}-${safe(input.turn_id)}.json`), `${JSON.stringify(marker, null, 2)}\n`, "utf8");
const scopeId = String(process.env.TASK_TREE_EXECUTION_SCOPE || "").trim();
const executionScope = scopeId ? await createExecutionScopeStore({ projectRoot: root }).get(scopeId) : null;
const nodes = activeTreeMarkdown
  ? (await loadTaskTreeModule(root, "tree-quality.js")).parseTreeNodeFields(activeTreeMarkdown)
  : [];
const assignedNodes = (executionScope?.targetNodeIds || []).map((nodeId) => {
  const node = nodes.find((item) => item.id === nodeId);
  return node ? { id: node.id, title: node.title, fields: node.fields } : { id: nodeId, title: "", fields: {} };
});
const additionalContext = buildTaskTreeCheckpointContext({ activeTree, markdown: activeTreeMarkdown, executionScope, assignedNodes });
process.stdout.write(additionalContext ? JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext
  }
}) : "{}");
