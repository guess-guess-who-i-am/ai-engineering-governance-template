#!/usr/bin/env python3
"""Paired warm full-graph comparison of the repaired scoring boundary."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import random
import statistics
import time

for key in ('HF_HUB_OFFLINE','TRANSFORMERS_OFFLINE'):os.environ[key]='1'
for key in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS'):os.environ[key]='1'
os.environ['TOKENIZERS_PARALLELISM']='false'
ROOT=Path(__file__).resolve().parents[1]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cases',type=Path,required=True)
    parser.add_argument('--report',type=Path,required=True)
    args=parser.parse_args()
    import numpy as np
    spec=importlib.util.spec_from_file_location('boundary_benchmark_indexer',ROOT/'codex-profile/mac/hooks/graph_skill_index.py')
    indexer=importlib.util.module_from_spec(spec);spec.loader.exec_module(indexer)
    worker=indexer._GraphWorker(Path.home()/'.codex/skill-registry/skills.graph.json')
    worker._load_if_stale()
    rng=random.Random(20261030)
    rows=[]
    cases=json.loads(args.cases.read_text())['cases']
    for case in cases:
        for language in ('zh','en'):
            query=case[language]
            graph=worker._graph if language=='zh' else worker._english_graph
            engine=graph._get_retrieval_engine()
            after=engine._compute_embedding_scores
            def before(query,top_k,restrict=None):
                state=engine._codex_category_embedding_scores_context.get()
                _,names,similarities,category_scores=state
                depth=top_k*3 if restrict is None else max(top_k*3,len(restrict))
                take=min(depth,len(names))
                if take<len(names):
                    positions=np.argpartition(-similarities,take-1)[:take].tolist()
                    positions.sort(key=lambda i:(-float(similarities[i]),names[i].casefold(),names[i]))
                else:
                    positions=sorted(range(len(names)),key=lambda i:(-float(similarities[i]),names[i].casefold(),names[i]))
                scores={names[i]:float(similarities[i]) for i in positions if restrict is None or names[i] in restrict}
                for name,score in category_scores.items():
                    if restrict is None or name in restrict:scores[name]=score
                return scores
            def run(mode):
                token=engine._codex_category_slots.set({'expert':2,'skill':4,'mcp':2})
                context=engine._codex_category_embedding_scores_context.set(None)
                engine._compute_embedding_scores=before if mode=='before' else after
                start=time.perf_counter()
                try:results=graph.retrieve_with_scores(query,top_k=8,max_graph_depth=2)
                finally:
                    engine._compute_embedding_scores=after
                    engine._codex_category_slots.reset(token)
                    engine._codex_category_embedding_scores_context.reset(context)
                return (time.perf_counter()-start)*1000,indexer.result_records(results)
            # Warm both paths and all query-specific interpretation/encode caches.
            run('before');run('after')
            identities={}
            for trial in range(3):
                order=['before','after'];rng.shuffle(order)
                for mode in order:
                    ms,result=run(mode)
                    current=[(r['kind'],r['name']) for r in result]
                    if mode in identities:assert identities[mode]==current,'Non-deterministic repeated result'
                    identities[mode]=current
                    experts=[r['name'] for r in result if r['kind']=='expert']
                    rows.append({'case':case['id'],'language':language,'trial':trial,'mode':mode,'ms':ms,
                        'hit':any(n in case['targets'] for n in experts),'experts':experts,
                        'returned':current})
    summary={}
    for mode in ('before','after'):
        chosen=[r for r in rows if r['mode']==mode];timings=sorted(r['ms'] for r in chosen)
        summary[mode]={'queries':len(chosen),'medianMs':statistics.median(timings),
                       'p95Ms':float(np.percentile(timings,95)),
                       'uniqueTaskHits':sum(r['hit'] for r in chosen if r['trial']==0)}
    args.report.write_text(json.dumps({'schema':'paired-semantic-boundary/v1','summary':summary,'rows':rows,
        'resultCacheUsed':False,'productionChanged':False,
        'limitations':['Single-process warm experiment; no end-to-end task-speed or token claim.',
                      'Paired randomized order, three repeats, twenty bilingual queries.']},ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(summary))


if __name__=='__main__':main()
