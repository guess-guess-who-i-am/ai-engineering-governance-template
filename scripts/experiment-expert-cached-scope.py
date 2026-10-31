#!/usr/bin/env python3
"""Two-view ranking using source-scope vectors and existing cached query vectors."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import time

for key in ('HF_HUB_OFFLINE','TRANSFORMERS_OFFLINE'):
    os.environ[key]='1'
for key in ('OMP_NUM_THREADS','MKL_NUM_THREADS','OPENBLAS_NUM_THREADS'):
    os.environ[key]='1'
os.environ['TOKENIZERS_PARALLELISM']='false'


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--traces',nargs='+',type=Path,required=True)
    ap.add_argument('--scope-graphs',nargs='+',type=Path,required=True)
    ap.add_argument('--report',type=Path,required=True)
    args=ap.parse_args()
    import numpy as np
    root=Path(__file__).resolve().parents[1]
    spec=importlib.util.spec_from_file_location('cached_scope_indexer',root/'codex-profile/mac/hooks/graph_skill_index.py')
    indexer=importlib.util.module_from_spec(spec);spec.loader.exec_module(indexer)
    worker=indexer._GraphWorker(Path.home()/'.codex/skill-registry/skills.graph.json');worker._load_if_stale()
    corpus=worker._graph.tools
    channels=[]
    for path in args.scope_graphs:
        graph=json.loads(path.read_text());names=[n for n,t in graph['tools'].items() if t['metadata'].get('kind')=='expert']
        for language in ('zh','en'):
            config=graph['metadata']['description_embeddings'][language]
            with np.load(path.parent/config['file']) as d:cache=dict(zip(d['texts'],d['vectors']))
            def description(n):
                t=graph['tools'][n]
                return t['metadata'].get('retrieval_original_description',t['description']) if language=='en' else t['description']
            matrix=np.asarray([cache[description(n)] for n in names],dtype=np.float32)
            matrix/=np.maximum(np.linalg.norm(matrix,axis=1,keepdims=True),1e-12)
            channels.append((path.parent.name,language,names,matrix))
    rows=[]
    for file in args.traces:
        for case in json.loads(file.read_text())['rows']:
            if case['kind']!='expert':continue
            engine=(worker._graph if case['language']=='zh' else worker._english_graph)._get_retrieval_engine()
            original=engine._build_candidates;captured={}
            def capture(scores,*a,**kw):
                captured.update({n:v for n,v in scores.items() if corpus[n].metadata.get('kind')=='expert'})
                return original(scores,*a,**kw)
            engine._build_candidates=capture
            try:worker.query({'query':case['query'],'top_k':8,'category_slots':{'expert':2,'skill':4,'mcp':2}})
            finally:engine._build_candidates=original
            q=np.asarray(engine._embedding_index.encode(case['query']),dtype=np.float32);q/=max(np.linalg.norm(q),1e-12)
            targets={t['id'] for t in case['raw']['dense']['targets']}
            for variant,language,names,matrix in channels:
                if language!=case['language']:continue
                start=time.perf_counter();dense=dict(zip(names,map(float,matrix@q)))
                def rank(scores):return sorted(scores,key=lambda n:(-scores[n],n))
                for mode in ('scope','rrf','product','scope-global'):
                    scope={n:dense[n] for n in captured}
                    if mode=='scope-global':scores=dense
                    elif mode=='scope':scores=scope
                    elif mode=='product':scores={n:v*max(dense[n],0) for n,v in captured.items()}
                    else:
                        scores={}
                        for values in (captured,scope):
                            for i,n in enumerate(rank(values),1):scores[n]=scores.get(n,0)+1/(60+i)
                    ordered=rank(scores)
                    rows.append({'case':case['case'],'set':case['set'],'query':case['query'],'language':language,
                        'variant':variant,'mode':mode,'hit':any(n in targets for n in ordered[:2]),
                        'baselineHit':case['rank'] is not None,'ms':(time.perf_counter()-start)*1000,
                        'returned':[{'id':n,'name':corpus[n].metadata['skill_name'],'score':scores[n]} for n in ordered[:8]]})
    summary=[]
    for variant in {r['variant'] for r in rows}:
        for mode in ('scope','rrf','product','scope-global'):
            for group in ('development','heldout'):
                chosen=[r for r in rows if r['variant']==variant and r['mode']==mode and (('heldout' in r['set'])==(group=='heldout'))]
                summary.append({'variant':variant,'mode':mode,'split':group,'n':len(chosen),'hits':sum(r['hit'] for r in chosen),'baselineHits':sum(r['baselineHit'] for r in chosen)})
    args.report.write_text(json.dumps({'rows':rows,'summary':summary,'productionChanged':False,
        'limitations':['Observed query development diagnostics, not task success.','scope-global is category-local retrieval; other modes retain the existing pool.']},ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(summary),flush=True)


if __name__=='__main__':main()
