import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,stat,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {publishMcpCatalog} from '../codex-profile/mac/hooks/registry-inputs.mjs';
test('unchanged MCP discovery retains exact bytes, timestamp and graph build input identity',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'mcp-inventory-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const file=path.join(root,'mcp-tools.json'),original={schemaVersion:'codex-mcp-tool-catalog/1',generatedAt:'old',tools:[{name:'a',inputSchema:{type:'object',properties:{}}},{name:'b'}]};
 await writeFile(file,JSON.stringify(original));const before=await readFile(file),mtime=(await stat(file)).mtimeMs;
 const result=await publishMcpCatalog(file,{...original,generatedAt:'new',tools:[{name:'b'},{inputSchema:{properties:{},type:'object'},name:'a'}]});
 assert.deepEqual(result,original);assert.deepEqual(await readFile(file),before);assert.equal((await stat(file)).mtimeMs,mtime);
 await publishMcpCatalog(file,{...original,generatedAt:'changed',tools:[{name:'a',description:'new capability'}]});
 assert.equal(JSON.parse(await readFile(file)).generatedAt,'changed');
});
