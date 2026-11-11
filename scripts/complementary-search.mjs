import {randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {TechnicalResearch} from './technical-research.mjs';

export const SEARCH_SOURCES=['github','stackoverflow','papers','openalex','crossref'];
const normalized=value=>String(value||'').replace(/<[^>]*>/g,' ').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function canonical(value){try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol))return '';u.hash='';for(const k of [...u.searchParams.keys()])if(/^utm_|^(gclid|fbclid)$/i.test(k))u.searchParams.delete(k);return u.href.replace(/\/$/,'');}catch{return '';}}
export async function atomicJson(file,value){await mkdir(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(value)+'\n',{mode:0o600});await rename(tmp,file);}
function bound(name,value,min,max){if(!Number.isInteger(value)||value<min||value>max)throw Object.assign(new RangeError(`${name} must be an integer in [${min}, ${max}]`),{code:'INVALID_ARGUMENT',field:name,minimum:min,maximum:max});}
function matchesTarget(operation,item){return Boolean((operation.expectedTitle&&normalized(item.title)===normalized(operation.expectedTitle))||(operation.expectedUrl&&canonical(item.url)===canonical(operation.expectedUrl)));}
function targetMissing(operation,results){
  if(!operation.expectedTitle&&!operation.expectedUrl)return false;
  return !results.some(item=>matchesTarget(operation,item));
}
function plan(operation){
  return {api:true,web:false,reason:'official-api-only',apiSource:operation.source==='papers'?'crossref':operation.source,apiQuery:operation.apiQuery||operation.query};
}
function errorOperation(query,error){return {query,status:'error',results:[],error:error.message};}

export class ComplementarySearch {
  constructor({cacheDirectory=path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'technical-research-cache'),technical,fetchImpl=fetch}={}){
    this.cacheDirectory=cacheDirectory;this.technical=technical||new TechnicalResearch({cacheDirectory,fetchImpl});
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
      if(!item||!SEARCH_SOURCES.includes(item.source)||typeof item.query!=='string'||!item.query.trim())throw new Error('Each query requires a supported official API source and non-empty query; general web is not configured');
      for(const key of Object.keys(item))if(!['source','query','apiQuery','expectedTitle','expectedUrl'].includes(key))throw new Error('Unknown query field: '+key);
      for(const key of ['apiQuery','expectedTitle','expectedUrl'])if(item[key]!==undefined&&(typeof item[key]!=='string'||!item[key].trim()))throw new Error(key+' must be a non-empty string');
      if(item.expectedUrl&&!canonical(item.expectedUrl))throw new Error('expectedUrl must be HTTP(S)');
      const operation={source:item.source,query:item.query.trim()};
      for(const key of ['apiQuery','expectedTitle','expectedUrl'])if(item[key]!==undefined)operation[key]=item[key].trim();
      unique.set(JSON.stringify(operation),operation);
    }
    const began=performance.now(),startedAt=new Date().toISOString();
    const operations=[...unique.values()].map((op,index)=>({...op,index,route:plan(op),branches:{},reasons:[]}));
    const common={topK,cacheMode,maxAgeSeconds,concurrency};
    let result;
    try{result=await this.technical.batch({...common,queries:operations.map(op=>({source:op.route.apiSource,query:op.route.apiQuery})),selectedCount:100,timeoutMs});}
    catch(error){result={operations:operations.map(op=>({source:op.route.apiSource,...errorOperation(op.route.apiQuery,error)}))};}
    for(const op of operations){
      op.branches.api=result.operations.find(item=>item.source===op.route.apiSource&&item.query===op.route.apiQuery)||errorOperation(op.route.apiQuery,new Error('Missing API operation'));
      op.reasons.push('official-api-only');
    }
    const all=new Map();
    for(const op of operations){
      const candidates=new Map();
      for(const [branch,data]of Object.entries(op.branches))for(const card of data.results){const url=canonical(card.url);if(!url)continue;
        const match={operation:op.index,branch,source:card.source,query:data.query,rank:card.rank};
        if(candidates.has(url))candidates.get(url).provenance.push(match);else candidates.set(url,{...card,url,provenance:[match]});
      }
      op.results=[...candidates.values()].sort((a,b)=>Number(matchesTarget(op,b))-Number(matchesTarget(op,a))||a.rank-b.rank);op.targetMissing=targetMissing(op,op.results);
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
      relevanceVerified:false,fullDocumentsFetched:0,limitations:'Official API candidates and metadata are not verified answers. No general web search, scraping or local corpus. papers uses Crossref; use OpenAlex separately for coverage gaps. Official quotas still apply; retry times and failures remain visible.'};
    const artifact=path.join(this.cacheDirectory,'complementary-batches',Date.now()+'-'+randomUUID()+'.json');await atomicJson(artifact,report);
    return {...report,artifact,elapsedMs:performance.now()-began};
  }
}
