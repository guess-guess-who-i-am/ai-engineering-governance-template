#!/usr/bin/env python3
"""Frozen holdout retrieval snapshots, keeping main and assisted hits separate."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
import os
from pathlib import Path
import sys
import time

for k in ('HF_HUB_OFFLINE','TRANSFORMERS_OFFLINE'):os.environ[k]='1'
for k in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS'):os.environ[k]='1'
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('semantic_eval_indexer',ROOT/'codex-profile/mac/hooks/graph_skill_index.py')
indexer=importlib.util.module_from_spec(spec);spec.loader.exec_module(indexer)


def main():
    p=argparse.ArgumentParser();p.add_argument('--graph',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True);p.add_argument('--baseline',type=Path)
    a=p.parse_args();cases=json.loads((ROOT/'scripts/resource-retrieval-holdout.json').read_text())['cases']
    worker=indexer._GraphWorker(a.graph);start=time.monotonic();worker._load_if_stale();loaded=time.monotonic()-start
    rows=[]
    for case in cases:
        for language in ('en','zh'):
            prompt=case[language];start=time.monotonic()
            results=worker.query({'query':prompt,'top_k':8,'category_slots':{'expert':3,'skill':3,'mcp':2}})
            elapsed=time.monotonic()-start;names=[r['name'] for r in results]
            links=[link['name'] for row in results for link in row.get('semantic_links',[])]
            rows.append({'id':case['id'],'language':language,'query':prompt,'targets':case['targets'],
                         'primaryHit':any(t in names for t in case['targets']),
                         'assistedHit':any(t in names+links for t in case['targets']),
                         'seconds':round(elapsed,4),'names':names,'links':links,
                         'results':results})
    # Cached query fan-in is measured separately from cold unique queries.
    def query(i):
        start=time.monotonic();case=cases[i%len(cases)]
        result=worker.query({'query':case['en' if i%2 else 'zh'],'top_k':8,
                             'category_slots':{'expert':3,'skill':3,'mcp':2}})
        return {'start':start,'end':time.monotonic(),'count':len(result)}
    with ThreadPoolExecutor(max_workers=8) as pool:wave=list(pool.map(query,range(16)))
    worker.close();report={'schemaVersion':'semantic-retrieval-eval/1','graph':str(a.graph),
        'loadSeconds':round(loaded,3),'rows':rows,'primaryHits':sum(r['primaryHit'] for r in rows),
        'assistedHits':sum(r['assistedHit'] for r in rows),'cachedQueryWave':wave,
        'limitations':['28 pre-existing diagnostic holdouts; cannot estimate all task success.',
                       'Assisted hit includes conditional hints, not automatic execution.',
                       'One load/query pass; cached wave is not a cold 100-query throughput benchmark.']}
    if a.baseline:
        baseline=json.loads(a.baseline.read_text())
        if [(r['id'],r['language'],r['query']) for r in baseline['rows']]!=[(r['id'],r['language'],r['query']) for r in rows]:
            raise ValueError('Baseline queries differ')
        report['regressions']=[{'id':b['id'],'language':b['language']} for b,c in zip(baseline['rows'],rows) if b['primaryHit'] and not c['primaryHit']]
        report['improvements']=[{'id':b['id'],'language':b['language']} for b,c in zip(baseline['rows'],rows) if not b['primaryHit'] and c['primaryHit']]
    a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k not in ('rows','cachedQueryWave')},ensure_ascii=False))
    if report.get('regressions'):raise SystemExit(1)


if __name__=='__main__':main()
