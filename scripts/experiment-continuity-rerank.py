#!/usr/bin/env python3
"""Offline cross-encoder probe on actual follow-up queries and unchanged graph pools."""
import argparse, hashlib, importlib.util, json, os, re, time
from pathlib import Path
for k in ('HF_HUB_OFFLINE','TRANSFORMERS_OFFLINE'): os.environ[k]='1'
for k in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS'): os.environ[k]='1'
os.environ['TOKENIZERS_PARALLELISM']='false'
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--run', type=Path, required=True)
p.add_argument('--model', type=Path, required=True)
p.add_argument('--report', type=Path, required=True)
p.add_argument('--category-depth', type=int, default=0,
 help='Diagnostic class-local semantic recall depth; production pool cap is unchanged')
p.add_argument('--device', default='cpu')
p.add_argument('--instruction', default='')
p.add_argument('--original-role', action='store_true')
a=p.parse_args()
if a.category_depth < 0: p.error('--category-depth must be non-negative')
import torch
from sentence_transformers import CrossEncoder
torch.set_num_threads(1)
root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('probe_index',root/'codex-profile/mac/hooks/graph_skill_index.py')
i=importlib.util.module_from_spec(spec);spec.loader.exec_module(i)
graph=Path.home()/'.codex/skill-registry/skills.graph.json'
graph_sha=hashlib.sha256(graph.read_bytes()).hexdigest()
run_bytes=a.run.read_bytes(); run=json.loads(run_bytes)
start=time.perf_counter(); worker=i._GraphWorker(graph);worker._load_if_stale()
engine=worker._graph._get_retrieval_engine()
catalog={r['id']:r for r in json.loads((Path.home()/'.codex/skill-registry/resource-modules.json').read_text())['modules']}
role_cache={}
def description(identifier):
 tool=engine._tools[identifier]
 if not a.original_role:return tool.description
 module_id=tool.metadata['module_id']
 if module_id not in role_cache:
  entry=Path(catalog[module_id]['path']).read_text()
  match=re.search(r'^Original primary role: (.+)$',entry,re.M)
  if not match:raise ValueError('Original role path absent')
  role_cache[module_id]=Path(match[1]).read_bytes().decode('utf-8')
 return role_cache[module_id]
if a.category_depth:
 prefilter=engine._get_prefilter(); pool_original=prefilter.candidate_pool
 def balanced_pool(*args,**kwargs):
  quotas=engine._codex_category_slots.get()
  token=engine._codex_category_slots.set({kind:a.category_depth if count else 0 for kind,count in quotas.items()})
  try:pool=pool_original(*args,**kwargs)
  finally:engine._codex_category_slots.reset(token)
  if pool is not None and len(pool)>prefilter._max_pool:raise ValueError('Candidate pool exceeded production cap')
  return pool
 prefilter.candidate_pool=balanced_pool
options={}
if a.instruction:options.update(prompts={'applicability':a.instruction},default_prompt_name='applicability')
if a.device=='mps':options['model_kwargs']={'torch_dtype':torch.float16}
model=CrossEncoder(str(a.model),max_length=1024 if a.instruction else 512,device=a.device,local_files_only=True,**options)
model.predict([['Investigate database latency','Optimize PostgreSQL execution plans and indexes.']],show_progress_bar=False)
startup=time.perf_counter()-start
rows=[]
for case in run['rows']:
 if 'reset' in case['id']:continue
 query=case['candidateQuery'];captured={}
 original=engine._build_candidates
 def capture(final,*args,**kwargs):
  captured.update({n:s for n,s in final.items() if engine._tools[n].metadata.get('kind')=='expert'})
  return original(final,*args,**kwargs)
 engine._build_candidates=capture
 try:baseline=worker.query({'query':query,'top_k':8,'category_slots':{'expert':2,'skill':4,'mcp':2}})
 finally:engine._build_candidates=original
 if not captured:raise ValueError('No actual graph candidates captured')
 ids=sorted(captured);pairs=[[query,description(n)] for n in ids]
 start=time.perf_counter();scores=model.predict(pairs,batch_size=8,show_progress_bar=False)
 elapsed=(time.perf_counter()-start)*1000
 ordered=sorted(zip(ids,map(float,scores)),key=lambda r:(-r[1],r[0]))
 row={'case':case['id'],'query':query,'candidates':len(ids),'rerankMs':elapsed,
 'baseline':[x['name'] for x in baseline if x['kind']=='expert'],
 'returned':[{'id':n,'name':engine._tools[n].metadata['skill_name'],'score':s,'graphScore':captured[n],
 'description':description(n),'sourceSha256':hashlib.sha256(description(n).encode()).hexdigest()} for n,s in ordered]}
 rows.append(row)
 if hashlib.sha256(graph.read_bytes()).hexdigest()!=graph_sha:raise ValueError('Graph changed during experiment')
 result={'schema':'continuity-rerank-probe/v1','runSha256':hashlib.sha256(run_bytes).hexdigest(),
 'graphSha256':graph_sha,'startupSeconds':startup,
 'model':str(a.model),'device':a.device,'instruction':a.instruction,'maxLength':model.max_seq_length,
 'documents':'original-role' if a.original_role else 'indexed-description',
 'categoryRecallDepth':a.category_depth,'rows':rows,'productionChanged':False,'paidCalls':0,
 'limitations':['Directed observed cases, not independent benchmark accuracy.',
 'Output remains 2/4/2. Diagnostic recall-depth changes stay within the existing total pool cap.',
 'Combined recall and document interventions alone cannot identify their separate causal effects.',
 'Raw relevance scores and names are not semantic or task-success judgments.',
 'Descriptions exceeding model input capacity are truncated; original expert packages unchanged.']}
 a.report.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'case':row['case'],'pool':len(ids),'baseline':row['baseline'],
 'reranked':[x['name'] for x in row['returned'][:2]],'ms':elapsed},ensure_ascii=False),flush=True)
