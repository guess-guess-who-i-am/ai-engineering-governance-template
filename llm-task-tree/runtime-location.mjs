import {readFile,access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export async function resolveTaskTreeRuntime(projectRoot){
 const configured=process.env.TASK_TREE_KIT_DIR;
 const codexRoot=process.env.CODEX_HOME||path.join(os.homedir(),'.codex');
 const state=configured?{root:configured}:JSON.parse(await readFile(path.join(codexRoot,'skill-registry/task-tree-runtime.json'),'utf8'));
 if(!state.root||!path.isAbsolute(state.root))throw new Error('Task-tree runtime must have a registered absolute root');
 await access(path.join(state.root,'scripts/mcp-server.mjs'));
 return state.root;
}

const modules={
 'turn-tracker.js':'context/turn-tracker.js',
 'turn-context.js':'context/turn-context.js',
 'execution-scope.js':'platform/execution-scope.js',
 'tree-quality.js':'task-tree/tree-quality.js',
 'maintenance.js':'task-tree/maintenance.js'
};
export async function loadTaskTreeModule(projectRoot,name){
 if(!modules[name])throw new Error('Unknown task-tree module: '+name);
 const root=await resolveTaskTreeRuntime(projectRoot);
 const file=path.join(root,'ide/backend',modules[name]);
 await access(file);
 return import(pathToFileURL(file).href);
}
