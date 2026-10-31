#!/usr/bin/env python3
"""Test precomputed tool-trained expert vectors with category-local fusion."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import resource
import statistics
import time

for key in ('HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE'):
    os.environ[key] = '1'
for key in ('OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'OPENBLAS_NUM_THREADS'):
    os.environ[key] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--traces', type=Path, nargs='+', required=True)
    ap.add_argument('--documents', type=Path, nargs='+', required=True)
    ap.add_argument('--model', type=Path, required=True)
    ap.add_argument('--report', type=Path, required=True)
    ap.add_argument('--query-instruction')
    ap.add_argument('--expected-pooling', choices=['lasttoken', 'cls', 'mean'], default='lasttoken')
    args = ap.parse_args()
    import numpy as np
    import torch
    from sentence_transformers import SentenceTransformer
    torch.set_num_threads(1)
    cases = [r for p in args.traces for r in json.loads(p.read_text())['rows'] if r['kind']=='expert']
    queries = [r['query'] for r in cases]
    root = Path(__file__).resolve().parents[1]
    spec = importlib.util.spec_from_file_location('biencoder_probe_indexer', root/'codex-profile/mac/hooks/graph_skill_index.py')
    indexer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(indexer)
    worker = indexer._GraphWorker(Path.home()/'.codex/skill-registry/skills.graph.json')
    worker._load_if_stale()
    model = SentenceTransformer(str(args.model), device='mps', local_files_only=True,
        model_kwargs={'dtype':torch.float16, 'attn_implementation':'sdpa'})
    assert model[1].pooling_mode == args.expected_pooling
    model.max_seq_length=8192
    began=time.perf_counter()
    prompt = f'Instruct: {args.query_instruction}\nQuery: ' if args.query_instruction else ''
    q = model.encode(queries, batch_size=8, normalize_embeddings=True, prompt=prompt, show_progress_bar=False)
    rows=[];builds=[];timings=[]
    for path in args.documents:
        docs=json.loads(path.read_text()); names=[d['name'] for d in docs]
        start=time.perf_counter()
        matrix=model.encode([d['description'] for d in docs],batch_size=8,normalize_embeddings=True,prompt='',show_progress_bar=False)
        builds.append({'documents':path.name,'seconds':time.perf_counter()-start})
        cache=args.report.with_name(args.report.stem+'-'+path.stem+'-vectors.npz')
        np.savez_compressed(cache,names=np.asarray(names),queries=np.asarray(queries),matrix=matrix,query_vectors=q)
        for i,case in enumerate(cases):
            engine=(worker._graph if case['language']=='zh' else worker._english_graph)._get_retrieval_engine()
            raw=engine._get_bm25().score(case['query'])
            lexical=np.asarray([raw.get(n,0.0) for n in names]);dense=matrix@q[i]
            def rank(values):return sorted(range(len(names)),key=lambda p:(-float(values[p]),names[p]))
            def norm(values):
                lo,hi=values.min(),values.max()
                return (values-lo)/(hi-lo) if hi>lo else np.zeros(len(values))
            fused=np.zeros(len(names))
            for scores in (dense,lexical):
                for pos,p in enumerate(rank(scores),1):
                    if scores[p]>0:fused[p]+=1/(60+pos)
            modes={'dense':dense,'rrf':fused,'cc':.5*norm(dense)+.5*norm(lexical)}
            targets={t['id'] for t in case['raw']['dense']['targets']}
            for mode,scores in modes.items():
                ordered=rank(scores)
                rows.append({'documents':path.name,'case':case['case'],'set':case['set'],'query':case['query'],
                    'language':case['language'],'mode':mode,'hit':any(names[p] in targets for p in ordered[:2]),
                    'baselineHit':case['rank'] is not None,'returned':[{'id':names[p],
                        'name':docs[p]['metadata']['skill_name'],'score':float(scores[p])} for p in ordered[:8]]})
    for query in queries[:8]:
        model.encode(query,normalize_embeddings=True,prompt=prompt);start=time.perf_counter()
        model.encode(query,normalize_embeddings=True,prompt=prompt);timings.append((time.perf_counter()-start)*1000)
    summary=[]
    for path in args.documents:
        for group in ('development','heldout'):
            for mode in ('dense','rrf','cc'):
                chosen=[r for r in rows if r['documents']==path.name and r['mode']==mode and
                    (('heldout' in r['set'])==(group=='heldout'))]
                summary.append({'documents':path.name,'split':group,'mode':mode,'n':len(chosen),
                    'hits':sum(r['hit'] for r in chosen),'baselineHits':sum(r['baselineHit'] for r in chosen)})
    report={'schema':'expert-biencoder-fusion/v1','summary':summary,'rows':rows,'builds':builds,
        'queryMedianMs':statistics.median(timings),'wallSeconds':time.perf_counter()-began,
        'peakRSSMiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024/1024,
        'queryInstruction':args.query_instruction,'model':str(args.model),
        'pooling':args.expected_pooling,
        'paidCalls':0,'productionChanged':False,'limitations':['Identity coverage, not two-seat relevance or task success.',
            'Category-local expert-only scoring; integration with fixed graph pool is not yet tested.',
            'RRF k=60 and equal weights; CC minmax equal weights. No test-driven weight fitting.']}
    args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(summary),flush=True)


if __name__=='__main__':main()
