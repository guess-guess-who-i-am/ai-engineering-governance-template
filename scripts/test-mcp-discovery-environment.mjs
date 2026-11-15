import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {discover} from '../codex-profile/mac/hooks/mcp-catalog.mjs';
const root=await mkdtemp(path.join(os.tmpdir(),'mcp-discovery-env-'));
const variables=['TASK_TREE_QUALITY_MODE','TASK_TREE_EXECUTION_SCOPE','TASK_TREE_CONTEXT_TREE_FILE','TASK_TREE_PROJECT_ROOT'];
const previous=Object.fromEntries(variables.map(k=>[k,process.env[k]]));
try {
 const file=path.join(root,'server.mjs');
 await writeFile(file,`import readline from 'node:readline';
 for await(const line of readline.createInterface({input:process.stdin})) {
  const r=JSON.parse(line);
  if(r.id===1)console.log(JSON.stringify({jsonrpc:'2.0',id:1,result:{capabilities:{}}}));
  if(r.id===2)console.log(JSON.stringify({jsonrpc:'2.0',id:2,result:{tools:[{name:'fixture',description:JSON.stringify(Object.fromEntries(${JSON.stringify(variables)}.map(k=>[k,process.env[k]||'absent']))),inputSchema:{type:'object'}}]}}));
 }`);
 for(const key of variables)process.env[key]='caller-specific';
 const server={name:'fixture',command:process.execPath,args:[file]};
 const [tool]=await discover(server,{cwd:root});
 assert.deepEqual(JSON.parse(tool.description),Object.fromEntries(variables.map(k=>[k,'absent'])),'caller task state must not change the global tool catalog');
 const [configured]=await discover({...server,env:{TASK_TREE_QUALITY_MODE:'advisory'}},{cwd:root});
 assert.equal(JSON.parse(configured.description).TASK_TREE_QUALITY_MODE,'advisory','explicit MCP configuration owns global behavior');
 assert.equal(process.env.TASK_TREE_QUALITY_MODE,'caller-specific','discovery must not mutate the calling process');
 console.log('PASS: transient task context isolated; explicit MCP configuration preserved');
} finally {
 for(const key of variables)if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];
 await rm(root,{recursive:true,force:true});
}
