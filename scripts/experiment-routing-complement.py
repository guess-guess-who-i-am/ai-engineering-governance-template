#!/usr/bin/env python3
"""Test real local cross-encoder on unchanged worker/usage candidate unions.

Does not rerun or change live retrieval. All candidates come from a frozen
mechanism report. Scoring is pointwise cross-encoding, NOT ToolRefiner.
"""
import argparse
from collections import defaultdict
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import statistics
import time
from types import SimpleNamespace

for key in ['HF_HUB_OFFLINE','TRANSFORMERS_OFFLINE']:os.environ[key]='1'
for key in ['OMP_NUM_THREADS','MKL_NUM_THREADS','OPENBLAS_NUM_THREADS']:os.environ[key]='1'
os.environ['TOKENIZERS_PARALLELISM']='false'
ROOT=Path(__file__).resolve().parents[1]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,default=ROOT/'.reports/routing-mechanisms.json')
    parser.add_argument('--report',type=Path,default=ROOT/'.reports/routing-complement.json')
    args=parser.parse_args()
    from sentence_transformers import CrossEncoder
    import numpy as np
    import torch
    torch.set_num_threads(1)
    source=json.loads(args.input.read_text())
    graph=Path.home()/'.codex/skill-registry/skills.graph.json'
    assert hashlib.sha256(graph.read_bytes()).hexdigest()==source['frozenSha256'][str(graph)]
    data=json.loads(graph.read_text())
    tools=data['tools']
    names=sorted(tools)
    spec=importlib.util.spec_from_file_location('complement_fields',ROOT/'scripts/experiment-routing-mechanisms.py')
    methods=importlib.util.module_from_spec(spec);spec.loader.exec_module(methods)
    nodes=[SimpleNamespace(**{k:tools[n][k] for k in ['name','description','metadata']}) for n in names]
    docs,_,_=methods.read_fields(nodes,json.loads((Path.home()/'.codex/tools/skills/_catalog_cn.json').read_text()))
    docs=dict(zip(names,docs))
    from huggingface_hub.constants import HF_HUB_CACHE
    model_path=str(Path(HF_HUB_CACHE)/'models--cross-encoder--mmarco-mMiniLMv2-L12-H384-v1'/
        'snapshots/1427fd652930e4ba29e8149678df786c240d8825')
    # The complete PyTorch model is cached; snapshot_download incorrectly
    # requires unused ONNX/OpenVINO exports as well. Never download them.
    for required in ['config.json','model.safetensors','tokenizer.json']:
        if not (Path(model_path)/required).is_file():
            raise FileNotFoundError(f'Missing cached inference file: {required}')
    started=time.perf_counter()
    model=CrossEncoder(model_path,device='cpu',max_length=256,local_files_only=True)
    model.predict([['search documents','Find a document.']],show_progress_bar=False)
    startup=time.perf_counter()-started
    tasks=defaultdict(dict)
    for row in source['rows']:tasks[row['set'],row['case'],row['language']][row['method']]=row
    rows=[]
    for number,groups in enumerate(tasks.values()):
        base=groups['worker']
        usage=groups['usage_prototypes']
        field=groups['bm25f_dense']
        def union(extra):
            return list(dict.fromkeys([r['id'] for r in base['returned']+extra['returned']]))
        base_ids=[r['id'] for r in base['returned']]
        cache={}
        variants=[('ce_worker8',base_ids,'raw'),('ce_worker_usage16',union(usage),'raw'),
                  ('ce_worker_usage16_clean',union(usage),'clean'),
                  ('ce_worker_fields16_clean',union(field),'clean')]
        # Shared pairs encoded once; separate online-equivalent batch time
        # still measured per variant with no query-dependent model cache.
        for variant,pool,representation in variants:
            pairs=[[base['query'], (docs[n]['name']+'. '+docs[n]['capability']+'. '+docs[n]['examples'])[:2400]
                if representation=='clean' else tools[n]['description'][:2400]] for n in pool]
            started=time.perf_counter()
            scores=model.predict(pairs,batch_size=16,show_progress_bar=False)
            ms=(time.perf_counter()-started)*1000
            ranking=sorted(zip(pool,map(float,scores)),key=lambda r:(-r[1],r[0]))
            def identity(n):
                m=tools[n]['metadata'];return {'id':n,'name':m.get('skill_name',m.get('mcp_original_name',n)),
                    'kind':m.get('kind','skill')}
            def hit(n):
                x=identity(n);return x['kind']==base['kind'] and x['name'] in base['targets']
            rank=next((i+1 for i,(n,_) in enumerate(ranking) if hit(n)),None)
            inputs=model.tokenizer([p[0] for p in pairs],[p[1] for p in pairs],truncation=True,
                max_length=256,padding=False)['input_ids']
            rows.append({k:base[k] for k in ['set','case','language','query','kind','targets']}|
                {'variant':variant,'candidateCount':len(pool),'candidateHit':any(hit(n) for n in pool),
                 'rank':rank,'rerankMs':ms,'crossEncoderInputTokens':sum(map(len,inputs)),
                 'returned':[identity(n)|{'score':s} for n,s in ranking[:8]]})
        if (number+1)%10==0:print(json.dumps({'phase':'rerank','completed':number+1,'total':len(tasks)}),flush=True)
    summary=[]
    for variant in [v[0] for v in variants]:
        selected=[r for r in rows if r['variant']==variant];lat=sorted(r['rerankMs'] for r in selected)
        summary.append({'variant':variant,'n':len(selected),'hit4':sum(r['rank'] is not None and r['rank']<=4 for r in selected),
            'hit8':sum(r['rank'] is not None and r['rank']<=8 for r in selected),'poolHits':sum(r['candidateHit'] for r in selected),
            'p50RerankMs':statistics.median(lat),'p95RerankMs':lat[math.ceil(.95*len(lat))-1],
            'medianCrossEncoderTokens':statistics.median(r['crossEncoderInputTokens'] for r in selected)})
    report={'schemaVersion':'routing-complement/1','inputSha256':hashlib.sha256(args.input.read_bytes()).hexdigest(),
        'graphSha256':source['frozenSha256'][str(graph)],'model':model_path,'maxLength':256,'startupSeconds':startup,
        'paidCalls':0,'productionChanged':False,'summary':summary,'rows':rows,'limitations':[
            'One pass; identity labels are incomplete and not task-success ground truth.',
            'Rerank time excludes candidate generation and additional query encoding.',
            'Cross-encoder tokens are actual encoder inputs, not LLM context or billing.',
            'Union may increase candidate budget from eight to at most sixteen.',
            'This is an existing multilingual cross-encoder, not trained ToolRefiner/ToolRerank.']}
    args.report.parent.mkdir(parents=True,exist_ok=True)
    args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'report':str(args.report),'summary':summary}),flush=True)


if __name__=='__main__':main()
