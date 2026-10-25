import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { configuredServers, discover } from '../codex-profile/mac/hooks/mcp-catalog.mjs';
const root = await mkdtemp(path.join(os.tmpdir(), 'catalog-contract-'));
try {
  const config = path.join(root, 'config.toml');
  const server = path.join(root, 'server.mjs');
  await writeFile(server, `import {createInterface} from 'node:readline';
let initialized=false;
for await (const line of createInterface({input:process.stdin})) {
 const q=JSON.parse(line);
 if(q.method==='notifications/initialized'){initialized=true;continue;}
 if(process.env.CASE==='timeout')continue;
 let result={protocolVersion:'2025-06-18',capabilities:{}};
 if(q.method==='tools/list') {
  if(!initialized || process.env.CHECK_ENV!=='fixture')process.exit(2);
  result={tools:[{name:q.params.cursor?'second':'first'}]};
  if(!q.params.cursor || process.env.CASE==='cycle')result.nextCursor='page2';
 }
 if(process.env.CASE==='error' && q.method==='initialize')result=null;
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n');
}`);
  await writeFile(config, `[mcp_servers.good]\ncommand=${JSON.stringify(process.execPath)}\nargs=[${JSON.stringify(server)}]\n[mcp_servers.good.env]\nCHECK_ENV="fixture"\n[mcp_servers.disabled]\ncommand="missing-disabled-server"\nenabled=false\n[mcp_servers.http]\nurl="https://example.invalid/mcp"\n[unrelated]\ncommand="not-an-mcp"\n`);
  const python = process.env.CODEX_GRAPH_TOOL_PYTHON || path.join(os.homedir(), '.codex/tools/graph-tool-call-venv/bin/python');
  const servers = await configuredServers(config, python);
  assert.equal(servers.length, 1);
  const good = servers[0];
  assert.equal(good.env.CHECK_ENV, 'fixture');
  assert.deepEqual((await discover(good)).map(t => t.name), ['first', 'second']);
  await assert.rejects(discover({...good, env:{...good.env, CASE:'cycle'}}), /pagination cycle/);
  await assert.rejects(discover({...good, env:{...good.env, CASE:'error'}}), /initialize failed/);
  await assert.rejects(discover({...good, env:{...good.env, CASE:'timeout'}}, {timeoutMs:100}), /timeout/);
  await assert.rejects(discover({...good, command:path.join(root,'missing')}), /Cannot start/);
  console.log('PASS: TOML sections/disabled/env, MCP handshake, pagination, cycle, error, timeout, missing executable');
} finally { await rm(root, {recursive:true, force:true}); }
