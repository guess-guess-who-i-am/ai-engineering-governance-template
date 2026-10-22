import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {TechnicalResearch} from './technical-research.mjs';

export const SEARCH_SOURCES=['web','github','stackoverflow','papers','openalex','crossref'];
const hash=value=>createHash('sha256').update(value).digest('hex');
const han=value=>/\p{Script=Han}/u.test(value);
const normalized=value=>String(value||'').replace(/<[^>]*>/g,' ').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function canonical(value){try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol))return '';u.hash='';for(const k of [...u.searchParams.keys()])if(/^utm_|^(gclid|fbclid)$/i.test(k))u.searchParams.delete(k);return u.href.replace(/\/$/,'');}catch{return '';}}
export async function atomicJson(file,value){await mkdir(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(value)+'\n',{mode:0o600});await rename(tmp,file);}
function bound(name,value,min,max){if(!Number.isInteger(value)||value<min||value>max)throw Object.assign(new RangeError(`${name} must be an integer in [${min}, ${max}]`),{code:'INVALID_ARGUMENT',field:name,minimum:min,maximum:max});}
function loopback(value){const u=new URL(value);if(u.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new Error('Web base URL must be an HTTP loopback origin without credentials');return u.origin;}
function targetMissing(operation,results){
  if(!operation.expectedTitle&&!operation.expectedUrl)return false;
  return !results.some(item=>(operation.expectedTitle&&normalized(item.title)===normalized(operation.expectedTitle))||(operation.expectedUrl&&canonical(item.url)===canonical(operation.expectedUrl)));
}
function plan(operation){
  const apiQuery=operation.apiQuery||operation.query;
  if(operation.source==='web')return {api:false,web:true,reason:'general-web'};
  if(han(apiQuery))return {api:false,web:true,reason:'chinese-web-first'};
  if(['papers','openalex','crossref'].includes(operation.source))return {api:true,web:true,reason:'scholarly-complement',apiSource:operation.source==='papers'?'crossref':operation.source,apiQuery};
  return {api:true,web:false,reason:'technical-api-first',apiSource:operation.source,apiQuery};
}
function webQuery(op){return op.source==='github'?`${op.query} site:github.com`:op.source==='stackoverflow'?`${op.query} site:stackoverflow.com`:op.query;}
function errorOperation(query,error){return {query,status:'error',results:[],error:error.message};}

export class FreeWebSearch {
  constructor({baseUrl=process.env.CODEX_SEARCH_WEB_BASE_URL||'http://127.0.0.1:5505',cacheDirectory,fetchImpl=fetch}={}){
    this.baseUrl=loopback(baseUrl);this.cacheDirectory=cacheDirectory;this.fetch=fetchImpl;this.inflight=new Map();
  }
  async batch({queries,topK,cacheMode,maxAgeSeconds,concurrency,timeoutMs}){
    const start=performance.now(),deadline=start+timeoutMs,unique=[...new Set(queries)],output=new Map();
    const file=q=>path.join(this.cacheDirectory,'web',hash(JSON.stringify([this.baseUrl,q,topK]))+'.json');
    await Promise.all(unique.map(async query=>{
      if(cacheMode==='refresh')return;
      try{const saved=JSON.parse(await readFile(file(query),'utf8'));const ageMs=Date.now()-saved.fetchedAt;
        if(ageMs>=0&&ageMs<=maxAgeSeconds*1000&&Array.isArray(saved.result?.results))output.set(query,{...saved.result,cache:'hit',ageMs});
      }catch(error){if(error.code!=='ENOENT')output.set(query,errorOperation(query,new Error('Web cache unreadable: '+error.message)));}
      if(cacheMode==='only'&&!output.has(query))output.set(query,{query,status:'cache-miss',cache:'miss',results:[]});
    }));
    const misses=unique.filter(query=>!output.has(query));
    if(misses.length){
      const key=JSON.stringify([misses,topK,cacheMode,timeoutMs]);let work=this.inflight.get(key);
      if(!work){work=this.#request(misses,{topK,cacheMode,concurrency,deadline});this.inflight.set(key,work);work.finally(()=>this.inflight.delete(key)).catch(()=>{});}
      try{for(const item of await work){output.set(item.query,item);if(item.status==='ok'&&item.results.length&&!item.warnings?.length&&!item.failures?.length)await atomicJson(file(item.query),{fetchedAt:Date.now(),result:item});}}
      catch(error){for(const query of misses)output.set(query,errorOperation(query,error));}
    }
    return {operations:unique.map(query=>output.get(query)),elapsedMs:performance.now()-start};
  }
  async #request(queries,{topK,cacheMode,concurrency,deadline}){
    const remaining=()=>{const value=Math.floor(deadline-performance.now());if(value<=0)throw new Error('Shared search deadline exceeded');return value;};
    const configResponse=await this.fetch(this.baseUrl+'/api/web-search/config',{signal:AbortSignal.timeout(remaining()),redirect:'error'});
    if(!configResponse.ok)throw new Error('Cannot verify free web provider: HTTP '+configResponse.status);
    const configured=(await configResponse.json()).config;
    if(configured?.provider!=='openwebsearch'||configured.enabled!==true||configured.requiresApiKey!==false)throw new Error('Web provider must be enabled keyless Open-WebSearch; paid or unknown providers are not called');
    const response=await this.fetch(this.baseUrl+'/api/web-search/batch',{method:'POST',headers:{'content-type':'application/json'},redirect:'error',
      body:JSON.stringify({queries,topK,concurrency,refresh:cacheMode==='refresh'}),signal:AbortSignal.timeout(remaining())});
    if(!response.ok)throw new Error('Web service HTTP '+response.status);
    const body=await response.json();if(!Array.isArray(body.queries)||!Array.isArray(body.results))throw new Error('Invalid web batch result contract');
    return queries.map(query=>{
      const record=body.queries.find(item=>item.query===query);
      if(!record)return errorOperation(query,new Error('Missing web query result'));
      const results=body.results.flatMap(item=>{const match=item.matches?.find(m=>m.query===query);return match?[{source:'web',title:match.title||item.title,url:item.url,summary:match.content||item.content||'',rank:match.rank,engine:match.engine||item.engine}]:[];}).sort((a,b)=>a.rank-b.rank);
      return {query,status:record.status==='failed'?'error':'ok',results,cache:record.cache?.hit?'upstream-hit':'miss',fetchedAt:new Date().toISOString(),
        ...(record.error?{error:record.error}:{}),warnings:record.warnings||[],failures:record.failures||[],elapsedMs:record.elapsedMs};
    });
  }
}

export class ComplementarySearch {
  constructor({cacheDirectory=path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'technical-research-cache'),technical,web,webBaseUrl,fetchImpl=fetch}={}){
    this.cacheDirectory=cacheDirectory;this.technical=technical||new TechnicalResearch({cacheDirectory,fetchImpl});
    this.web=web||new FreeWebSearch({cacheDirectory,baseUrl:webBaseUrl,fetchImpl});
  }
  async batch(args={}){
    if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('Arguments must be an object');
    for(const key of Object.keys(args))if(!['queries','topK','selectedCount','cacheMode','maxAgeSeconds','concurrency','timeoutMs'].includes(key))throw new Error('Unknown argument: '+key);
    const {queries,topK=10,selectedCount=16,cacheMode='prefer',maxAgeSeconds=300,concurrency=8,timeoutMs=12000}=args;
    if(!Array.isArray(queries)||queries.length<1||queries.length>20)throw new Error('queries must contain 1–20 operations');
    for(const [name,value,min,max]of [['topK',topK,1,15],['selectedCount',selectedCount,1,100],['maxAgeSeconds',maxAgeSeconds,0,86400],['concurrency',concurrency,1,20],['timeoutMs',timeoutMs,100,30000]])bound(name,value,min,max);
    if(!['prefer','refresh','only'].includes(cacheMode))throw new Error('Invalid cacheMode');
    const unique=new Map();
    for(const item of queries){
      if(!item||!SEARCH_SOURCES.includes(item.source)||typeof item.query!=='string'||!item.query.trim())throw new Error('Each query requires supported source and non-empty query');
      for(const key of Object.keys(item))if(!['source','query','apiQuery','expectedTitle','expectedUrl'].includes(key))throw new Error('Unknown query field: '+key);
      for(const key of ['apiQuery','expectedTitle','expectedUrl'])if(item[key]!==undefined&&(typeof item[key]!=='string'||!item[key].trim()))throw new Error(key+' must be a non-empty string');
      if(item.expectedUrl&&!canonical(item.expectedUrl))throw new Error('expectedUrl must be HTTP(S)');
      const operation={source:item.source,query:item.query.trim()};
      for(const key of ['apiQuery','expectedTitle','expectedUrl'])if(item[key]!==undefined)operation[key]=item[key].trim();
      unique.set(JSON.stringify(operation),operation);
    }
    const began=performance.now(),deadline=began+timeoutMs,startedAt=new Date().toISOString();
    const operations=[...unique.values()].map((op,index)=>({...op,index,route:plan(op),branches:{},reasons:[]}));
    const common={topK,cacheMode,maxAgeSeconds,concurrency};
    const primaryApi=operations.filter(op=>op.route.api),primaryWeb=operations.filter(op=>op.route.web);
    const attachWeb=async(list,reason)=>{
      if(!list.length)return;
      const remaining=Math.floor(deadline-performance.now());
      let result;
      try{if(remaining<=0)throw new Error('Shared search deadline exceeded before web supplement');result=await this.web.batch({...common,queries:list.map(webQuery),timeoutMs:remaining});}
      catch(error){result={operations:list.map(op=>errorOperation(webQuery(op),error))};}
      for(const op of list){op.branches.web=result.operations.find(item=>item.query===webQuery(op))||errorOperation(webQuery(op),new Error('Missing web operation'));op.reasons.push(reason);}
    };
    await Promise.all([
      (async()=>{
        if(!primaryApi.length)return;
        let result;
        try{if(timeoutMs<200)throw new Error('Insufficient budget for the minimum 100ms API phase');result=await this.technical.batch({...common,queries:primaryApi.map(op=>({source:op.route.apiSource,query:op.route.apiQuery})),selectedCount:100,timeoutMs:Math.floor(timeoutMs/2)});}
        catch(error){result={operations:primaryApi.map(op=>({source:op.route.apiSource,...errorOperation(op.route.apiQuery,error)}))};}
        for(const op of primaryApi)op.branches.api=result.operations.find(item=>item.source===op.route.apiSource&&item.query===op.route.apiQuery)||errorOperation(op.route.apiQuery,new Error('Missing API operation'));
      })(),attachWeb(primaryWeb,'primary-web'),
    ]);
    const supplements=[];
    for(const op of primaryApi.filter(op=>!op.route.web)){
      const api=op.branches.api;
      const reason=api.status!=='ok'?'api-'+api.status:!api.results.length?'api-empty':targetMissing(op,api.results)?'explicit-target-missing':null;
      if(reason){op.reasons.push(reason);supplements.push(op);}
    }
    await attachWeb(supplements,'web-supplement');
    const all=new Map();
    for(const op of operations){
      const candidates=new Map();
      for(const [branch,data]of Object.entries(op.branches))for(const card of data.results){const url=canonical(card.url);if(!url)continue;
        const match={operation:op.index,branch,source:card.source,query:data.query,rank:card.rank};
        if(candidates.has(url))candidates.get(url).provenance.push(match);else candidates.set(url,{...card,url,provenance:[match]});
      }
      op.results=[...candidates.values()].sort((a,b)=>a.rank-b.rank);op.targetMissing=targetMissing(op,op.results);
      const branches=Object.values(op.branches);const failed=branches.some(b=>b.status==='error'||b.status==='cache-miss'||b.failures?.length);
      op.status=op.results.length?(failed||op.targetMissing?'partial':'completed'):branches.some(b=>b.status==='error')?'error':branches.some(b=>b.status==='cache-miss')?'cache-miss':'empty';
    }
    // Fair interleaving preserves early evidence for each input; unlike provider
    // scores are not treated as comparable semantic relevance scores.
    for(let rank=0;operations.some(op=>op.results.length>rank);rank++)for(const op of operations){const card=op.results[rank];if(!card)continue;
      if(all.has(card.url))all.get(card.url).provenance.push(...card.provenance);else all.set(card.url,{...card,provenance:[...card.provenance]});}
    const pool=[...all.values()],partial=operations.some(op=>!['completed','empty'].includes(op.status));
    const report={schemaVersion:'complementary-search/1',startedAt,status:pool.length?(partial?'partial':'ok'):operations.every(op=>op.status==='empty')?'empty':'error',
      elapsedMs:performance.now()-began,requestedOperations:queries.length,uniqueOperations:operations.length,returnedCount:pool.length,selected:pool.slice(0,selectedCount),selectionOmitted:Math.max(0,pool.length-selectedCount),operations,
      relevanceVerified:false,fullDocumentsFetched:0,limitations:'Candidates, metadata and explicit-target matches are not verified answers. Read decisive original pages. No paid provider or translation fallback; original source failures remain visible.'};
    const artifact=path.join(this.cacheDirectory,'complementary-batches',Date.now()+'-'+randomUUID()+'.json');await atomicJson(artifact,report);
    return {...report,artifact,elapsedMs:performance.now()-began};
  }
}
