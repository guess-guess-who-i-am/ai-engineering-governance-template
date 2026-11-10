// Streamable HTTP MCP client. Credentials, cost and read/write authorization are
// the caller's responsibility; discovering a tool does not authorize executing it.
const redact = value => String(value || '').replace(/https?:\/\/[^\s)"<>\\]+/g, raw => { try { const u = new URL(raw); u.username = ''; u.password = ''; u.search = ''; u.hash = ''; return u.toString(); } catch { return '[url]'; } }).replace(/\b(?:sk|ghp|github_pat)-[A-Za-z0-9_-]{12,}\b/g, '[redacted]');

export function decodeMcpHttpResponse(text, id) {
  try { return JSON.parse(text); } catch {}
  const messages = text.split(/\r?\n\r?\n/).flatMap(block => {
    const data = block.split(/\r?\n/).filter(x => x.startsWith('data:')).map(x => x.slice(5).trimStart()).join('\n');
    try { return [JSON.parse(data)]; } catch { return []; }
  });
  return messages.find(x => x.id === id);
}

export function createMcpHttpClient(endpoint, { timeoutMs = 15000, headers = {}, fetchImpl = fetch, maxPages = 100, maxResponseBytes = 16 * 1024 * 1024 } = {}) {
  const url = new URL(endpoint);
  if (url.username || url.password) throw new Error('MCP endpoint must not contain userinfo');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Use HTTPS or localhost HTTP');
  let sessionId, protocol = '2025-06-18', seq = 0, ready = false, pendingInitialize;
  const trace = [];
  async function request(method, params, notification = false) {
    const id = notification ? undefined : ++seq;
    const start = performance.now();
    const entry = { method };
    try {
      const response = await fetchImpl(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': protocol, ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', ...(id ? { id } : {}), method, ...(params ? { params } : {}) }), signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
      entry.httpStatus = response.status;
      if (response.headers.has('mcp-session-id')) sessionId = response.headers.get('mcp-session-id');
      const chunks = [];
      let bytes = 0;
      let decoded;
      if (response.body) for await (const chunk of response.body) {
        bytes += chunk.byteLength;
        if (bytes > maxResponseBytes) throw new Error('MCP response exceeds size limit');
        chunks.push(chunk);
        if (!notification && response.ok && response.headers.get('content-type')?.includes('text/event-stream')) {
          decoded = decodeMcpHttpResponse(Buffer.concat(chunks).toString('utf8'), id);
          // Servers may keep SSE alive after the matching result. End this
          // response stream without waiting for unrelated future notifications.
          if (decoded?.id === id) break;
        }
      }
      const body = Buffer.concat(chunks).toString('utf8');
      entry.bytes = bytes;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (notification) return;
      const message = decoded || decodeMcpHttpResponse(body, id);
      if (!message || message.id !== id) throw new Error('No matching JSON-RPC response');
      if (message.error) throw new Error(`RPC ${message.error.code}: ${redact(message.error.message)}`);
      return message.result;
    } catch (error) { entry.error = redact(error.message); throw error; }
    finally { entry.ms = Math.round(performance.now() - start); trace.push(entry); }
  }
  async function initialize() {
    if (ready) return { protocolVersion: protocol };
    if (pendingInitialize) return pendingInitialize;
    pendingInitialize = (async () => {
      const result = await request('initialize', { protocolVersion: protocol, capabilities: {}, clientInfo: { name: 'global-resource-router', version: '1' } });
      if (!result?.protocolVersion) throw new Error('No protocolVersion');
      protocol = result.protocolVersion;
      await request('notifications/initialized', undefined, true);
      ready = true;
      return { protocolVersion: protocol, serverInfo: result.serverInfo };
    })();
    try { return await pendingInitialize; } finally { pendingInitialize = undefined; }
  }
  const requireReady = () => { if (!ready) throw new Error('MCP initialize must complete first'); };
  return {
    trace, initialize,
    async listTools() {
      requireReady();
      const tools = [], cursors = new Set();
      let cursor;
      do {
        const result = await request('tools/list', cursor ? { cursor } : {});
        if (!Array.isArray(result?.tools)) throw new Error('No tools array');
        tools.push(...result.tools);
        cursor = result.nextCursor;
        if (cursor && cursors.has(cursor)) throw new Error('Pagination cycle');
        if (cursor) cursors.add(cursor);
        if (cursors.size >= maxPages) throw new Error('Pagination limit');
      } while (cursor);
      return tools;
    },
    async callTool(name, args) {
      requireReady();
      if (typeof name !== 'string' || !name || !args || Array.isArray(args) || typeof args !== 'object') throw new Error('Tool name and argument object required');
      return request('tools/call', { name, arguments: args });
    },
    async close() {
      if (!sessionId) { ready = false; return; }
      // Optional session termination; never retry a tool invocation automatically.
      const response = await fetchImpl(url, { method: 'DELETE', headers: { ...headers, 'MCP-Protocol-Version': protocol, 'Mcp-Session-Id': sessionId }, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
      if (!response.ok && response.status !== 405 && response.status !== 404) throw new Error(`MCP close HTTP ${response.status}`);
      sessionId = undefined; ready = false;
    }
  };
}
