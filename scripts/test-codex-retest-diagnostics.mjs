import assert from 'node:assert/strict';
import { retestDiagnostics, retestFailures } from './codex-retest-diagnostics.mjs';
const events=[
 {at:1,method:'mcpServer/startupStatus/updated',params:{name:'technical_research',status:'ready'}},
 {at:2,method:'item/completed',params:{item:{type:'agentMessage',phase:'commentary',text:'I will search'}}},
 {at:3,method:'error',params:{willRetry:true,error:{message:'Reconnecting... 1/5',additionalDetails:'stream disconnected before completion: Request timed out.',codexErrorInfo:{responseStreamDisconnected:{httpStatusCode:null}}}}}
];
const result=retestDiagnostics(events);
assert.equal(result.observedFailureBoundary,'model-response-stream');
assert.equal(result.commentaryOnly,true);assert.equal(result.finalMessageCount,0);
assert.equal(result.technicalResearchCalls,0);assert.equal(result.retryEvents.length,1);
assert.equal(result.routeAdoption,'no-search-call-observed');
assert.equal(result.mcpStartup[0].status,'ready');
assert.equal(retestDiagnostics([...events,{method:'item/completed',params:{item:{type:'agentMessage',phase:'final_answer',text:'Done'}}}]).commentaryOnly,false);
assert.equal(retestDiagnostics([{method:'mcpServer/startupStatus/updated',params:{name:'technical_research',status:'failed'}}]).observedFailureBoundary,'mcp-startup');
assert.equal(retestDiagnostics([]).observedFailureBoundary,'not-established');
assert.equal(retestDiagnostics([{method:'item/completed',params:{item:{type:'webSearch'}}}]).routeAdoption,'web-search-used-without-technical-research');
assert.equal(retestDiagnostics([{method:'item/completed',params:{item:{type:'mcpToolCall',server:'technical_research',status:'failed'}}}]).technicalResearchErrors.length,1);
const valid = {markers:{ADAPTIVE_TOOL_SCHEDULING_CONTRACT_V4:true,GLOBAL_ALWAYS_ON_ORIGINAL_EN_V3:true,CODEX_SKILL_ROUTER_V2:false},
 final:'连接正常',hooks:['sessionStart','userPromptSubmit'].map(eventName=>({eventName,source:'user',status:'completed'}))};
assert.deepEqual(retestFailures(valid),[],'no suitable Skill is a valid routing result');
assert(retestFailures({...valid,requireTechnicalResearch:true}).some(message=>message.includes('technical-research')));
assert(retestFailures({...valid,final:''}).includes('No final answer'));
assert.deepEqual(retestFailures({...valid,requireTechnicalResearch:true,technicalResearchCalls:[{status:'completed',returnedCount:6}]}),[]);
console.log('PASS: retries, ready MCP, absent search and commentary-only output remain distinct failure evidence.');
