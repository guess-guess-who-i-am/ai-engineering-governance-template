#!/usr/bin/env python3
"""Measure actual pool membership and outputs at the graph boundary."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import statistics
import time

for key in ('HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE'):
    os.environ[key] = '1'
for key in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS'):
    os.environ[key] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--indexer',type=Path,required=True)
p.add_argument('--cases',type=Path,required=True)
p.add_argument('--report',type=Path,required=True)
a = p.parse_args()
spec=importlib.util.spec_from_file_location('pool_benchmark',a.indexer)
i=importlib.util.module_from_spec(spec);spec.loader.exec_module(i)
graph=Path.home()/'.codex/skill-registry/skills.graph.json'
frozen={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in (graph,a.indexer,a.cases)}
w=i._GraphWorker(graph);w._load_if_stale()
rows=[]
for case in json.loads(a.cases.read_text())['rows']:
    query=case.get('candidateQuery',case.get('query'))
    engine=(w._graph if any('\u3400'<=c<='\u9fff' for c in query) else w._english_graph)._get_retrieval_engine()
    saved=engine._maybe_prefilter
    pools=[]
    def capture(*args,**kwargs):
        pool=saved(*args,**kwargs)
        names=engine._tools if pool is None else pool
        pools.append({'size':len(names),'unrestricted':pool is None,
            'experts':sum(engine._tools[n].metadata.get('kind')=='expert' for n in names)})
        return pool
    engine._maybe_prefilter=capture
    try:
        for trial in range(4):
            w._results.clear();began=time.perf_counter()
            result=w.query({'query':query,'top_k':8,'category_slots':{'expert':2,'skill':4,'mcp':2}})
            rows.append({'case':case['id'],'trial':trial,'ms':(time.perf_counter()-began)*1000,
                'pool':pools[-1], 'returned':result})
    finally:engine._maybe_prefilter=saved
assert all(hashlib.sha256(Path(p).read_bytes()).hexdigest()==h for p,h in frozen.items())
warm=[r for r in rows if r['trial']>0]
report={'schema':'expert-semantic-pool-benchmark/v1','frozen':frozen,'rows':rows,
    'summary':{'cases':len(rows)//4,'measuredWarmRequests':len(warm),
        'medianWarmMs':statistics.median(r['ms'] for r in warm),
        'maxPool':max(r['pool']['size'] for r in rows),
        'unrestrictedCases':sorted({r['case'] for r in rows if r['pool']['unrestricted']})},
    'productionChanged':False,'limitations':['Directed cases, not population accuracy.',
        'Separate-process before/after measurements; machine load can affect timing.',
        'Warm reruns bypass only the final result cache; query-vector caches remain active.']}
a.report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report['summary']),flush=True)
