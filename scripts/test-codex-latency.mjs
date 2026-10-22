import assert from 'node:assert/strict';
import { summarizeCodexLatency } from './codex-latency.mjs';
const item=(at,method,id,type,action)=>({at,method,params:{item:{id,type,...(action?{action:{type:action}}:{})}}});
const events=[
 {at:110,method:'hook/started',params:{run:{id:'h',eventName:'userPromptSubmit'}}},
 {at:130,method:'hook/completed',params:{run:{id:'h',eventName:'userPromptSubmit'}}},
 item(140,'item/started','a','webSearch'),item(150,'item/started','b','webSearch'),
 item(160,'item/completed','a','webSearch','search'),item(170,'item/completed','b','webSearch','openPage'),
 item(180,'item/completed','unknown','webSearch','search')];
const result=summarizeCodexLatency(events,100,200);
assert.equal(result.totalMs,100);assert.equal(result.searchMs,20);assert.equal(result.pageAndFindMs,20);
assert.equal(result.allWebMs,30,'overlapping tools must not be double-counted');
assert.equal(result.measuredToolAndHookMs,50);assert.equal(result.unattributedMs,50);
assert.deepEqual(result.missingStarts,['web:unknown']);
assert.throws(()=>summarizeCodexLatency([],10,0));
assert.equal(summarizeCodexLatency([],0,100).searchMs,0);
assert.deepEqual(summarizeCodexLatency([item(10,'item/started','a','webSearch')],0,100).unfinished,['web:a']);
const mcp=summarizeCodexLatency([item(10,'item/started','m','mcpToolCall'),item(35,'item/completed','m','mcpToolCall')],0,100);
assert.equal(mcp.mcpToolMs,25);assert.equal(mcp.unattributedMs,75,'MCP work is not hidden model latency');
console.log('PASS: latency attribution separates actual search/page/hook spans, overlap, unknown and unfinished work.');
