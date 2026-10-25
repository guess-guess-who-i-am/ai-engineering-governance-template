#!/usr/bin/env python3
"""Recheck ECIR 2010's actual mass formula on the same frozen field pool."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import time
from types import SimpleNamespace

for key in ['HF_HUB_OFFLINE','TRANSFORMERS_OFFLINE']:os.environ[key]='1'
for key in ['OMP_NUM_THREADS','MKL_NUM_THREADS','OPENBLAS_NUM_THREADS']:os.environ[key]='1'
os.environ['TOKENIZERS_PARALLELISM']='false'
ROOT=Path(__file__).resolve().parents[1]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,default=ROOT/'.reports/routing-mechanisms.json')
    parser.add_argument('--report',type=Path,default=ROOT/'.reports/routing-diversity.json')
    args=parser.parse_args()
    import numpy as np
    import torch
    from sentence_transformers import SentenceTransformer
    from huggingface_hub import scan_cache_dir
    torch.set_num_threads(1)
    source=json.loads(args.input.read_text())
    graph=Path.home()/'.codex/skill-registry/skills.graph.json'
    assert hashlib.sha256(graph.read_bytes()).hexdigest()==source['frozenSha256'][str(graph)]
    data=json.loads(graph.read_text());names=sorted(data['tools'])
    nodes=[SimpleNamespace(**{k:data['tools'][n][k] for k in ['name','description','metadata']}) for n in names]
    spec=importlib.util.spec_from_file_location('field_methods',ROOT/'scripts/experiment-routing-mechanisms.py')
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    docs,_,_=m.read_fields(nodes,json.loads((Path.home()/'.codex/tools/skills/_catalog_cn.json').read_text()))
    keys=[(n.metadata.get('kind','skill'),n.metadata.get('skill_name',n.name),d['capability']) for n,d in zip(nodes,docs)]
    lexical=m.BM25F(docs)
    config=data['metadata']['description_embeddings']['zh'];cache_path=graph.parent/config['file']
    assert hashlib.sha256(cache_path.read_bytes()).hexdigest()==config['sha256']
    with np.load(cache_path,allow_pickle=False) as cache:
        by_text=dict(zip(map(str,cache['texts']),cache['vectors']))
    dense=m.normalized([by_text[n.description] for n in nodes])
    repo=next(r for r in scan_cache_dir().repos if r.repo_id=='sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2')
    revision=sorted(repo.revisions,key=lambda r:r.commit_hash)[0]
    model=SentenceTransformer(str(revision.snapshot_path),local_files_only=True,device='cpu')
    tasks=[x for x in source['rows'] if x['method']=='worker']
    texts=list(dict.fromkeys([t['query'] for t in tasks]+[c for t in tasks for c in m.clauses(t['query'])]))
    began=time.perf_counter();vectors=model.encode(texts,batch_size=64,show_progress_bar=False,normalize_embeddings=True)
    encoded=dict(zip(texts,vectors));encoding=time.perf_counter()-began
    rows=[]
    for task in tasks:
        scores=m.fused_scores([m.order(lexical.score(task['query']),True),m.order(dense@encoded[task['query']])],len(nodes))
        ranking=m.order(scores,True)
        aspects=np.clip(dense@m.normalized([encoded[c] for c in m.clauses(task['query'])]).T,0,1)
        for variant,fn in [('relevance_only',lambda:m.dedup(ranking,keys)),
            ('coverage_product',lambda:m.xquad(ranking,scores,aspects,keys)),
            ('ecir2010_mass',lambda:m.ecir2010_mass(ranking,scores,aspects,keys))]:
            began=time.perf_counter();out=fn();ms=(time.perf_counter()-began)*1000
            returned=[{'id':names[int(i)],'name':nodes[int(i)].metadata.get('skill_name',nodes[int(i)].name),
                'kind':nodes[int(i)].metadata.get('kind','skill')} for i in out]
            rank=next((j+1 for j,n in enumerate(returned) if n['kind']==task['kind'] and n['name'] in task['targets']),None)
            rows.append({k:task[k] for k in ['set','case','language']}|{'variant':variant,'rank':rank,'selectionMs':ms,'returned':returned})
    summary=[]
    for variant in ['relevance_only','coverage_product','ecir2010_mass']:
        selected=[r for r in rows if r['variant']==variant]
        summary.append({'variant':variant,'n':len(selected),'hit4':sum(r['rank'] is not None and r['rank']<=4 for r in selected),
            'hit8':sum(r['rank'] is not None for r in selected)})
    report={'schemaVersion':'routing-diversity/1','inputSha256':hashlib.sha256(args.input.read_bytes()).hexdigest(),
        'graphSha256':source['frozenSha256'][str(graph)],'modelRevision':revision.commit_hash,'rows':rows,'summary':summary,
        'encodingSeconds':encoding,'massPrior':1.,'omega':.3,'productionChanged':False,'paidCalls':0,'limitations':[
            'Actual ECIR2010 selection formula, but deterministic clauses, uniform aspect priors and cosine relevance proxies.',
            'Not a reproduction of paper subquery mining or its TREC results; probabilities are not calibrated.',
            'Same BM25F+dense top64 pool; tests only selection, cannot repair pool omissions.']}
    args.report.parent.mkdir(parents=True,exist_ok=True);args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'report':str(args.report),'summary':summary}))


if __name__=='__main__':main()
