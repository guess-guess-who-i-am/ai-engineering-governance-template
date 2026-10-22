import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

export const PROVIDERS = ['stackoverflow', 'github', 'openalex', 'crossref'];
const endpoints = { stackoverflow: 'https://api.stackexchange.com/2.3/search/advanced', github: 'https://api.github.com/search/repositories',
  openalex: 'https://api.openalex.org/works', crossref: 'https://api.crossref.org/works' };
const hash = value => createHash('sha256').update(value).digest('hex');
const plain = text => String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
function canonicalUrl(text) {
  try { const url = new URL(text);url.hash='';for(const key of [...url.searchParams.keys()])if(/^utm_/.test(key))url.searchParams.delete(key);return url.href; }
  catch { return String(text); }
}
function prepare(operation, topK, providerEndpoints) {
  if (!PROVIDERS.includes(operation?.source) || typeof operation.query !== 'string' || !operation.query.trim()) throw new Error('Each query requires a supported source and non-empty query');
  const query = operation.query.trim();
  const url = new URL(providerEndpoints[operation.source]);
  if (operation.source === 'stackoverflow') for(const [key,value] of Object.entries({site:'stackoverflow',q:query,pagesize:String(topK),sort:'relevance',filter:'withbody'}))url.searchParams.set(key,value);
  if (operation.source === 'github') for(const [key,value] of Object.entries({q:query,per_page:String(topK)}))url.searchParams.set(key,value);
  if (operation.source === 'openalex') {url.searchParams.set('search',query);url.searchParams.set('per-page',String(topK));}
  if (operation.source === 'crossref') {url.searchParams.set('query.bibliographic',query);url.searchParams.set('rows',String(topK));}
  return {source:operation.source,query,url:url.href,key:hash(JSON.stringify({version:1,source:operation.source,query,topK,endpoint:url.origin+url.pathname}))};
}
function cards(source, data) {
  const rows = source === 'openalex' ? data.results : source === 'crossref' ? data.message?.items : data.items;
  if (!Array.isArray(rows)) throw new Error('Provider returned no recognized result array');
  return rows.map((item,index) => {
    const common={source,rank:index+1};
    if(source==='github')return {...common,title:item.full_name,url:item.html_url,summary:item.description||'',stars:item.stargazers_count,archived:item.archived,updatedAt:item.updated_at};
    if(source==='stackoverflow')return {...common,title:plain(item.title),url:item.link,summary:plain(item.body).slice(0,500),summaryIsExcerpt:true,score:item.score,answerCount:item.answer_count,acceptedAnswerId:item.accepted_answer_id,kind:'question-not-answer'};
    if(source==='openalex')return {...common,title:item.display_name,url:item.doi||item.primary_location?.landing_page_url||item.id,summary:'',year:item.publication_year,citationCount:item.cited_by_count,venue:item.primary_location?.source?.display_name||null,ccfRank:'not-verified'};
    return {...common,title:item.title?.[0]||'',url:item.URL||('https://doi.org/'+item.DOI),summary:plain(item.abstract).slice(0,500),summaryIsExcerpt:true,doi:item.DOI,year:item.published?.['date-parts']?.[0]?.[0],citationCount:item['is-referenced-by-count'],venue:item['container-title']?.[0]||null,ccfRank:'not-verified'};
  });
}

export class TechnicalResearch {
  constructor({ cacheDirectory = path.join(process.env.CODEX_HOME || path.join(os.homedir(),'.codex'),'technical-research-cache'), fetchImpl=fetch, providerEndpoints=endpoints }={}) {
    this.cacheDirectory=cacheDirectory;this.fetch=fetchImpl;this.endpoints=providerEndpoints;this.inflight=new Map();this.cooldown=new Map();
    this.githubTail=Promise.resolve();
  }
  async #write(file,data) {
    await mkdir(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+randomUUID()+'.tmp';
    await writeFile(tmp,JSON.stringify(data)+'\n',{mode:0o600});await rename(tmp,file);
  }
  async #cached(task,{cacheMode,maxAgeSeconds}) {
    const began=performance.now(),file=path.join(this.cacheDirectory,'requests',task.key+'.json');
    if(cacheMode!=='refresh') {
      let saved=null;try{saved=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw new Error('Cache unreadable/corrupt: '+error.message);}
      if(saved&&(!saved.result||!Array.isArray(saved.result.results)))throw new Error('Cache has an invalid result contract');
      if(saved&&saved.key===task.key&&Number.isFinite(saved.fetchedAt)&&saved.fetchedAt<=Date.now()&&Date.now()-saved.fetchedAt<=maxAgeSeconds*1000)
        return {...saved.result,cache:'hit',ageMs:Date.now()-saved.fetchedAt,elapsedMs:performance.now()-began,artifact:file,network:null};
      if(cacheMode==='only')return {source:task.source,query:task.query,status:'cache-miss',cache:'miss',results:[],elapsedMs:performance.now()-began};
    }
    return null;
  }
  async #one(task,{timeoutMs,topK}) {
    const began=performance.now(),file=path.join(this.cacheDirectory,'requests',task.key+'.json');
    if((this.cooldown.get(task.source)||0)>Date.now())throw new Error('Provider backoff active until '+new Date(this.cooldown.get(task.source)).toISOString());
    const requestStartedAt=Date.now(),networkBegan=performance.now(),requestId=randomUUID();
    let response,rawText,headersReceivedAt,network;
    try {
      response=await this.fetch(task.url,{signal:AbortSignal.timeout(timeoutMs),headers:{'User-Agent':'AI-engineering-technical-research/1.0','Accept':'application/json'}});
      headersReceivedAt=Date.now();rawText=await response.text();
      network={requestId,requestStartedAt,headersReceivedAt,bodyReceivedAt:Date.now(),elapsedMs:performance.now()-networkBegan};
    } catch(error) {
      throw Object.assign(error,{network:{requestId,requestStartedAt,headersReceivedAt:headersReceivedAt??null,bodyReceivedAt:Date.now(),elapsedMs:performance.now()-networkBegan}});
    }
    let data;
    const rejectResponse=async message=>{
      const artifact=path.join(this.cacheDirectory,'errors',task.key+'-'+randomUUID()+'.json');
      await this.#write(artifact,{source:task.source,query:task.query,httpStatus:response.status,fetchedAt:new Date().toISOString(),rawText});
      throw Object.assign(new Error(message),{artifact,httpStatus:response.status,network});
    };
    const retryAfter=response.headers.get('retry-after');
    const headerPause=retryAfter?Number(retryAfter)||Math.max(0,(Date.parse(retryAfter)-Date.now())/1000):0;
    if(headerPause>0)this.cooldown.set(task.source,Date.now()+headerPause*1000);
    try{data=JSON.parse(rawText);}catch{return rejectResponse('Provider did not return JSON (HTTP '+response.status+')');}
    const pause=Number(data.backoff)||headerPause;
    if(pause>0)this.cooldown.set(task.source,Date.now()+pause*1000);
    if(response.headers.get('x-ratelimit-remaining')==='0')this.cooldown.set(task.source,Math.max(this.cooldown.get(task.source)||0,Number(response.headers.get('x-ratelimit-reset'))*1000||Date.now()+60000));
    if(!response.ok||data.error_id||data.error)return rejectResponse('Provider HTTP '+response.status+': '+String(data.error_message||data.message||data.error||response.statusText).slice(0,300));
    const results=cards(task.source,data);
    const fetchedAt=Date.now();
    const result={source:task.source,query:task.query,status:'ok',cache:'miss',ageMs:0,fetchedAt:new Date(fetchedAt).toISOString(),httpStatus:response.status,
      results,network,totalReported:data.total_count??data.meta?.count??data.message?.['total-results']??null,returnedCount:results.length,
      providerHasMore:data.has_more??null,requestedCount:topK,rawSha256:hash(rawText),rawUtf8Bytes:Buffer.byteLength(rawText),elapsedMs:performance.now()-began};
    await this.#write(file,{key:task.key,fetchedAt,result,rawText});
    return {...result,artifact:file,elapsedMs:performance.now()-began};
  }
  async batch({queries,topK=10,selectedCount=16,cacheMode='prefer',maxAgeSeconds=300,concurrency=4,timeoutMs=8000}) {
    if(!Array.isArray(queries)||queries.length<1||queries.length>20)throw new Error('queries must contain 1–20 operations');
    for(const [key,value,min,max]of [['topK',topK,1,50],['selectedCount',selectedCount,1,100],['maxAgeSeconds',maxAgeSeconds,0,86400],['concurrency',concurrency,1,20],['timeoutMs',timeoutMs,100,30000]])if(!Number.isInteger(value)||value<min||value>max)throw new Error(key+' is outside its supported range');
    if(!['prefer','refresh','only'].includes(cacheMode))throw new Error('cacheMode must be prefer, refresh or only');
    const startedAt=Date.now(),began=performance.now(),deadline=began+timeoutMs;
    const prepared=queries.map(query=>prepare(query,topK,this.endpoints));
    const tasks=[...new Map(prepared.map(task=>[task.key,task])).values()];
    const output=new Map(),busy=new Map();let running=0,peak=0;
    // A local cache lookup must never wait behind an origin quota/connection
    // queue. Only cache misses consume network concurrency or GitHub slots.
    await Promise.all(tasks.map(async task=>{
      try {
        const cached=await this.#cached(task,{cacheMode,maxAgeSeconds});
        if(cached)output.set(task.key,cached);
      } catch(error) {
        output.set(task.key,{source:task.source,query:task.query,status:'error',error:error.message,cache:'none',results:[]});
      }
    }));
    const cachePhaseMs=performance.now()-began,queue=tasks.filter(task=>!output.has(task.key));
    const queueError=(task,error)=>({source:task.source,query:task.query,status:'error',error:error.message,cache:'none',results:[],
      ...(error.artifact?{artifact:error.artifact,httpStatus:error.httpStatus}:{}),...(error.network?{network:error.network}:{})});
    if(queue.length) {
    await new Promise(resolve=>{
      const dispatch=()=>{
        while(running<concurrency&&queue.length){
          if(performance.now()>=deadline){
            for(const task of queue.splice(0))output.set(task.key,{source:task.source,query:task.query,status:'error',error:'Batch deadline exceeded before dispatch',cache:'none',results:[]});
            if(!running)resolve();
            break;
          }
          const index=queue.findIndex(task=>(busy.get(task.source)||0)<(task.source==='github'?1:2));
          if(index<0)break;
          const [task]=queue.splice(index,1);running++;peak=Math.max(peak,running);busy.set(task.source,(busy.get(task.source)||0)+1);
          const key=task.key+':'+cacheMode+':'+maxAgeSeconds+':'+timeoutMs;
          let work=this.inflight.get(key);
          if(!work){
            const execute=()=>{
              const remaining=Math.floor(deadline-performance.now());
              if(remaining<=0)throw new Error('Batch deadline exceeded before HTTP dispatch');
              return this.#one(task,{timeoutMs:remaining,topK});
            };
            if(task.source==='github'){work=this.githubTail.then(execute);this.githubTail=work.catch(()=>{});}else work=Promise.resolve().then(execute);
            this.inflight.set(key,work);work.finally(()=>this.inflight.delete(key)).catch(()=>{});
          }
          work.then(result=>output.set(task.key,result),error=>output.set(task.key,queueError(task,error)))
            .finally(()=>{running--;busy.set(task.source,busy.get(task.source)-1);if(!queue.length&&!running)resolve();else dispatch();});
        }
      };dispatch();
    });
    }
    const operations=tasks.map(task=>output.get(task.key));
    const networkSpans=operations.filter(op=>op.cache!=='hit'&&op.network).map(op=>op.network);
    const timeline=networkSpans.filter(span=>span.bodyReceivedAt>span.requestStartedAt).flatMap(span=>[[span.requestStartedAt,1],[span.bodyReceivedAt,-1]])
      .sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    let activeHttp=0,peakHttpRequests=0;
    for(const [,delta]of timeline){activeHttp+=delta;peakHttpRequests=Math.max(peakHttpRequests,activeHttp);}
    const unique=new Map();
    for(const op of operations)for(const result of op.results){const key=canonicalUrl(result.url);const item=unique.get(key);if(item)item.matchedQueries.push(op.query);else unique.set(key,{...result,matchedQueries:[op.query]});}
    // Round-robin the provider's relevance ranks; do not add unlike star/citation scores.
    const ranked=[...unique.values()].sort((a,b)=>a.rank-b.rank||PROVIDERS.indexOf(a.source)-PROVIDERS.indexOf(b.source));
    const report={schemaVersion:'technical-research-batch/1',startedAt:new Date(startedAt).toISOString(),retrievalMs:performance.now()-began,
      cacheMode,requestedOperations:queries.length,uniqueOperations:tasks.length,duplicateOperations:queries.length-tasks.length,peakConcurrency:peak,
      peakConcurrencyKind:'scheduled-origin-operations',cachePhaseMs,httpRequests:networkSpans.length,peakHttpRequests,
      successfulOperations:operations.filter(op=>op.status==='ok').length,failedOperations:operations.filter(op=>op.status==='error').length,
      cacheHits:operations.filter(op=>op.cache==='hit').length,returnedCount:operations.reduce((sum,op)=>sum+op.results.length,0),uniqueCount:ranked.length,
      selected:ranked.slice(0,selectedCount),selectionOmitted:Math.max(0,ranked.length-selectedCount),operations,
      limitations:'Technical-source APIs, not a replacement for general web search. Cached data is explicitly dated, not real-time. Metadata is not full-page verification. Stars/citations are context, not correctness. CCF rank is unverified. Partial failures are retained; no provider fallback.'};
    report.status=report.failedOperations?'partial':operations.some(op=>op.status==='cache-miss')?'cache-miss':'ok';
    const artifact=path.join(this.cacheDirectory,'batches',Date.now()+'-'+randomUUID()+'.json');
    await this.#write(artifact,report);
    return {...report,artifact,elapsedMs:performance.now()-began};
  }
}
