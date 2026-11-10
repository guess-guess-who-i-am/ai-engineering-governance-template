#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { routingQuery } from '../codex-profile/.codex/hooks/skill-router.mjs';

const task='我们正在用 GraphToolCall 改进全局 Skill、专家和 MCP 检索，比较推荐准确率、误召回并做评测。';
const reply='方案一是增加图边；方案二是修复对话查询解析与会话历史传递，再测试召回质量。';
const history=[{role:'user',content:task},{role:'assistant',content:reply}];
const envelope=messages=>({session_id:'session-a',cwd:'/workspace-a',routing_context:{schemaVersion:'routing-context/1',sessionId:'session-a',cwd:'/workspace-a',messages}});
const followups=['现在是推荐变得更好了吗？','效果怎么样？','准确了吗？','那为什么还是这样？','这样会不会更慢？','还有没有遗漏？','第二个吧','按你说的修好吧','那就继续','能再快点吗？','现在准确率怎么样？','这个够用了吗？','还有什么能改进？','How about the second option?','Is it better now?','Does that actually work?','What about performance?','Why is it still slow?'];
for(const prompt of followups)test(`resolve reference: ${prompt}`,async()=>{
 const q=await routingQuery(envelope(history),prompt);assert(q.includes('GraphToolCall'),q);assert(!q.includes('FUTURE_TASK'),q);
});
test('assistant-proposed referent is available',async()=>{
 const q=await routingQuery(envelope(history),'第二个方案有风险吗？');assert(q.includes('会话历史传递'),q);
});
for(const prompt of ['请审查这个第三方 MCP 插件的供应链风险','请解释这个 JavaScript 函数的参数含义：foo(a,b)','现在东京的天气怎么样？','请推荐几个保险产品','写一个 PostgreSQL 索引优化方案','换个话题，请帮我做旅行预算','这个问题：为什么 Redis 连接超时？','Create a React counter component','New topic: create a PDF invoice'])test(`standalone stays unchanged: ${prompt}`,async()=>{
 assert.equal(await routingQuery(envelope(history),prompt),prompt);
});
for(const prompt of ['现在是推荐变得更好了吗？','效果怎么样？','第二个吧','Is it better now?'])test(`unresolved reference abstains: ${prompt}`,async()=>assert.equal(await routingQuery({},prompt),''));
test('latest explicit topic boundary replaces old project',async()=>{
 const h=[...history,{role:'user',content:'换个话题，优化 PostgreSQL 的索引构建与锁等待。'},{role:'assistant',content:'使用 CREATE INDEX CONCURRENTLY，并检查无效索引。'}];
 const q=await routingQuery(envelope(h),'这个方案有风险吗？');assert(q.includes('PostgreSQL'));assert(!q.includes('GraphToolCall'));
});
test('matching scope is mandatory for supplied IDE history',async()=>{
 for(const patch of [{sessionId:'session-b'},{cwd:'/workspace-b'}]){
  const input=envelope(history);Object.assign(input.routing_context,patch);await assert.rejects(routingQuery(input,'第二个吧'),/scope|session|workspace/i);
 }
});
test('long sequence keeps task anchor and current constraints',async()=>{
 const h=[...history,...Array.from({length:80},(_,i)=>({role:'user',content:i%2?'继续':'那就继续'})),{role:'user',content:'这个方案不要调用付费API。'}];
 const q=await routingQuery(envelope(h),'效果怎么样？');assert(q.includes('GraphToolCall'));assert(q.includes('不要调用付费API'));assert(!q.includes('无关历史'));assert(q.length<5000);
});
test('question-reply transport resolves question and answer',async()=>{
 const p='<send_user_message_question_reply>[{"question":"Which database index strategy?","answer":"PostgreSQL concurrent index"}]</send_user_message_question_reply>';
 const q=await routingQuery({},p);assert(q.includes('PostgreSQL'));assert(!q.includes('send_user_message'));
});
test('transcript adapter reads user and final assistant; ignores tools, commentary and future records',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'routing-context-'));
 try{
  const file=path.join(root,'transcript.jsonl');
  const record=(role,text,phase)=>({type:'response_item',payload:{type:'message',role,phase,content:[{type:role==='user'?'input_text':'output_text',text}]}});
  await writeFile(file,[{type:'session_meta',payload:{id:'session-a',cwd:'/workspace-a'}},record('user',task),record('assistant','IGNORE_COMMENTARY','commentary'),{type:'response_item',payload:{type:'function_call_output',output:'IGNORE_TOOL'}},record('assistant',reply,'final_answer'),record('user','现在是推荐变得更好了吗？'),record('assistant','FUTURE_REPLY','final_answer'),record('user','FUTURE_TASK')].map(JSON.stringify).join('\n')+'\n');
  const q=await routingQuery({session_id:'session-a',transcript_path:file},'现在是推荐变得更好了吗？');assert(q.includes('GraphToolCall'));assert(!q.includes('IGNORE_COMMENTARY'));assert(!/IGNORE_|FUTURE/.test(q),q);
  await assert.rejects(routingQuery({session_id:'session-b',transcript_path:file},'效果怎么样？'),/session|scope/i);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('credentials in history are excluded, adjacent task survives',async()=>{
 const h=[...history,{role:'user',content:'token='+('private'.repeat(9))},{role:'assistant',content:'password: never-copy-me'}];
 const q=await routingQuery(envelope(h),'效果怎么样？');assert(q.includes('GraphToolCall'));assert(!/private|never-copy-me/.test(q));
});
test('100 independent conversation inputs do not share task state',async()=>{
 const out=await Promise.all(Array.from({length:100},(_,i)=>routingQuery(envelope([{role:'user',content:`Investigate PostgreSQL index workload tenant_${i}.`}]),'这个方案有风险吗？')));
 out.forEach((q,i)=>{assert(q.includes(`tenant_${i}.`));assert(!q.includes(`tenant_${(i+1)%100}.`));});
});

test('pure status uses the resolved capability query unchanged',async()=>assert.equal(await routingQuery(envelope(history),'效果怎么样？'),task));

test('IDE payload remains bounded after 1000 followups without losing task',async()=>{
 const {createRoutingContext}=await import('../codex-profile/.codex/hooks/routing-context.mjs');
 const input={sessionId:'session-a',cwd:'/workspace-a',prompt:'第二个方案有风险吗？',messages:[...history,...Array.from({length:1000},()=>({role:'user',content:'继续'})),{role:'assistant',content:reply}]};
 const context=createRoutingContext(input);assert(JSON.stringify(context).length<5000);
 const q=await routingQuery({session_id:input.sessionId,cwd:input.cwd,routing_context:context},input.prompt);assert(q.includes('GraphToolCall'));assert(q.includes('会话历史传递'));
});

test('unknown transcript format does not fabricate a task',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'routing-unknown-'));
 try{const file=path.join(root,'new-format.jsonl');await writeFile(file,JSON.stringify({futureFormat:{userText:task}}));assert.equal(await routingQuery({transcript_path:file},'效果怎么样？'),'');}
 finally{await rm(root,{recursive:true,force:true});}
});

test('first-turn explicit subject with a demonstrative remains routable',async()=>{const p='请审查这个第三方 MCP 插件的供应链风险';assert.equal(await routingQuery({},p),p);});

test('bounded transcript tail abstains when task anchor was evicted',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'routing-tail-'));
 try{const file=path.join(root,'large.jsonl');const user=text=>JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}]}});
 await writeFile(file,JSON.stringify({type:'session_meta',payload:{id:'session-a'}})+'\n'+user(task)+'\n'+JSON.stringify({type:'response_item',payload:{type:'function_call_output',output:'x'.repeat(8*1024*1024)}})+'\n'+user('继续')+'\n');
 assert.equal(await routingQuery({session_id:'session-a',transcript_path:file},'效果怎么样？'),'');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('current operation and latest user correction survive query selection',async()=>{
 const q=await routingQuery(envelope([...history,{role:'user',content:'这个方案不要调用付费API。'}]),'那就部署并测试吧');
 assert(q.includes('GraphToolCall'));assert(q.includes('不要调用付费API'));assert(q.includes('部署并测试'));
});
