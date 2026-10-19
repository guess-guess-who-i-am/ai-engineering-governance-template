import {readFile} from 'node:fs/promises';
import {existsSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {codexRoot,graphRequest} from './graph-client.mjs';
import {projectMetadata,withAliases,userMetadata} from './skill-metadata.mjs';

export function selectCandidates(results,query){
  const normalized=query.normalize('NFKC').toLowerCase();
  const explicit=name=>(name.includes('-')||normalized.includes('$'+name)||normalized.includes('skill:'+name))&&new RegExp(`(^|[^a-z0-9_-])${name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}([^a-z0-9_-]|$)`,'i').test(normalized);
  const byName=new Map();
  for(const item of results){
    if(item.kind==='mcp'||!item.path||!existsSync(item.path))continue;
    const previous=byName.get(item.name);
    if(!previous||Number(item.rank??50)<Number(previous.rank??50))byName.set(item.name,item);
  }
  const ranked=[...byName.values()].map(item=>{
    const aliases=(item.aliases||[]).filter(a=>a.length>=4&&normalized.includes(a.toLowerCase()));
    const direct=explicit(item.name);
    const specificity=Math.max(0,...aliases.map(a=>a.length));
    return {...item,direct,specificity,priority:direct?1000:specificity?10+specificity/100:Number(item.semanticScore||0)};
  }).filter(item=>item.direct||item.specificity||Number(item.semanticScore)>=0.30)
    .sort((a,b)=>b.priority-a.priority||Number(a.rank??50)-Number(b.rank??50)||Number(b.semanticScore)-Number(a.semanticScore));
  const explicitMatches=ranked.filter(item=>item.direct||item.specificity);
  const relevant=ranked.filter(item=>Number(item.semanticScore)>=Math.max(0.30,Number(ranked[0]?.semanticScore||0)*0.80));
  if(explicitMatches.length)return explicitMatches.slice(0,4);
  const scoped=relevant.find(item=>Number(item.rank??50)<50&&Number(item.semanticScore)>=Number(ranked[0]?.semanticScore||0)*0.85);
  return (scoped?[scoped,...relevant.filter(item=>item!==scoped)]:relevant).slice(0,4);
}
async function main(){
  let raw='';for await(const chunk of process.stdin)raw+=chunk;const input=JSON.parse(raw||'{}');
  const query=String(input.prompt||input.user_prompt||'').trim();
  if(input.hook_event_name!=='UserPromptSubmit'||!query)return {};
  if(/^(你好[！!。]?|您好[！!。]?|hello[!.]?|hi[!.]?|计算\s*\d+\s*[乘以×*+减去-]+\s*\d+|把这一句话精简一下)$/i.test(query))return {};
  const root=codexRoot();
  const [registry,aliases,project,user]=await Promise.all([
    readFile(path.join(root,'skill-registry/skills-index.json'),'utf8').then(JSON.parse),
    readFile(path.join(root,'skill-registry/routing-rules.json'),'utf8').then(JSON.parse),
    projectMetadata(input.cwd||process.cwd()),userMetadata(root)
  ]);
  const records=withAliases([...user,...project],aliases);
  const response=await graphRequest({query,candidates:records},{root});
  const selected=selectCandidates(response.results,query);
  if(!selected.length)return {};
  return {hookSpecificOutput:{hookEventName:'UserPromptSubmit',additionalContext:['[CODEX_SKILL_ROUTER_V5]',...selected.flatMap(item=>[`- ${item.name} [source=${item.source||'graph-tool-call'}; semantic=${Number(item.semanticScore).toFixed(3)}]`,`  Read: ${item.path}`])].join('\n')}};
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
  try{process.stdout.write(JSON.stringify(await main()));}catch(error){process.stderr.write(`Unified graph routing failed; no substitute ranking used: ${error.message}\n`);process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'UserPromptSubmit',additionalContext:'[SKILL_ROUTER_ERROR] Unified graph retrieval failed. Inspect the error, repair the runtime/index, and rerun before claiming a Skill was loaded.'}}));process.exitCode=1;}
}
