import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {graphInputsHash} from '../codex-profile/mac/hooks/registry-inputs.mjs';

const root=await mkdtemp(path.join(os.tmpdir(),'graph-identity-'));
try {
 const tool={name:'open',tool_name:'mcp_tree_open',server:'tree',description:'Open graph',inputSchema:{type:'object'},_meta:{ui:{resourceUri:'ui://graph?projectRoot=/first'}}};
 const hash=tools=>graphInputsHash(root,tools);
 const original=await hash([tool]);
 const moved={...tool,_meta:{ui:{resourceUri:'ui://graph?projectRoot=/second'}}};
 assert.equal(await hash([moved]),original,'workspace UI bindings must not trigger graph rebuilds');
 for(const [field,value] of Object.entries({description:'Changed capability',name:'renamed',server:'other',tool_name:'different',inputSchema:{type:'string'},outputSchema:{type:'array'},annotations:{readOnlyHint:true}})) {
  assert.notEqual(await hash([{...tool,[field]:value}]),original,field+' must still invalidate the graph');
 }
 assert.equal(await hash([tool,moved]),await hash([moved,tool]));
 console.log('PASS: workspace metadata stable; all 7 consumed MCP fields invalidate');
} finally {await rm(root,{recursive:true,force:true});}
