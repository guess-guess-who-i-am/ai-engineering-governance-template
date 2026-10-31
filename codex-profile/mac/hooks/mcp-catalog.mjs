// Complete initialize before notifications/initialized and tools/list.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

export async function configuredServers(config, python) {
  const input = await readFile(config, 'utf8');
  const code = 'import sys,json,tomllib; d=tomllib.loads(sys.stdin.read()); print(json.dumps([dict(name=n,command=s["command"],args=s.get("args",[]),env=s.get("env",{})) for n,s in d.get("mcp_servers",{}).items() if s.get("enabled",True) and "command" in s]))';
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-c', code], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', c => { output += c; }); child.stderr.on('data', () => {});
    child.once('error', reject);
    child.once('close', code => { if (code !== 0) reject(new Error('Cannot parse MCP configuration')); else { try { resolve(JSON.parse(output)); } catch (e) { reject(e); } } });
    child.stdin.end(input);
  });
}

export async function discover(server, { timeoutMs = 20000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(server.command, server.args, { cwd, env: { ...process.env, ...server.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '', settled = false, tools = [];
    const cursors = new Set();
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); child.stdin.end(); child.kill();
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error(`MCP discovery timeout: ${server.name}`)), timeoutMs);
    const send = value => child.stdin.write(JSON.stringify(value) + '\n');
    child.on('error', () => finish(new Error(`Cannot start MCP server: ${server.name}`)));
    child.stdin.on('error', () => finish(new Error(`MCP input closed: ${server.name}`)));
    child.stderr.on('data', () => {});
    child.on('close', () => { if (!settled) finish(new Error(`MCP closed before tools/list: ${server.name}`)); });
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      let boundary;
      while ((boundary = buffer.indexOf('\n')) >= 0 && !settled) {
        const line = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 1);
        let response;
        try { response = JSON.parse(line); } catch { continue; }
        if (response.id === 1) {
          if (!response.result || response.error) { finish(new Error(`MCP initialize failed: ${server.name}`)); continue; }
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
        } else if (response.id === 2) {
          if (!Array.isArray(response.result?.tools)) { finish(new Error(`MCP tools/list failed: ${server.name}`)); continue; }
          tools.push(...response.result.tools);
          const next = response.result.nextCursor;
          if (next && cursors.has(next)) { finish(new Error(`MCP pagination cycle: ${server.name}`)); continue; }
          if (next) { cursors.add(next); send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: { cursor: next } }); }
          else finish(null, tools.map(tool => ({ ...tool, tool_name: `mcp_${server.name}_${tool.name}`, server: server.name })));
        }
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codex-global-indexer', version: '2' } } });
  });
}
