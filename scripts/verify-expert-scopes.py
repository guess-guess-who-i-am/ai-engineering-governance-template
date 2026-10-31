#!/usr/bin/env python3
"""Verify natural-query identities and honest primary-role scopes, optionally live."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import statistics
import time

for key in ('HF_HUB_OFFLINE','TRANSFORMERS_OFFLINE'):
    os.environ[key]='1'
for key in ('OMP_NUM_THREADS','MKL_NUM_THREADS','OPENBLAS_NUM_THREADS'):
    os.environ[key]='1'
os.environ['TOKENIZERS_PARALLELISM']='false'


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--graph',type=Path,required=True)
    parser.add_argument('--catalog',type=Path,required=True)
    parser.add_argument('--trace',type=Path,required=True)
    parser.add_argument('--report',type=Path,required=True)
    parser.add_argument('--live',action='store_true')
    args=parser.parse_args()
    modules=json.loads(args.catalog.read_text())['modules']
    experts={m['name']:m for m in modules if m['kind']=='expert'}
    for module in experts.values():
        p=module['retrieval_provenance']
        if p['state']=='source-grounded':
            role=Path(module['package_root'])/p['primary_path']
            assert hashlib.sha256(role.read_bytes()).hexdigest()==p['primary_sha256']
            assert module['original_description'] in role.read_text(encoding='utf-8-sig') or p['field']=='frontmatter.description'
    cases=json.loads(args.trace.read_text())['rows']
    graph_data=json.loads(args.graph.read_text())
    canonical={name:tool['metadata'].get('skill_name',tool['metadata'].get('mcp_original_name',name))
        for name,tool in graph_data['tools'].items()}
    del graph_data
    worker=None
    if not args.live:
        root=Path(__file__).resolve().parents[1]
        spec=importlib.util.spec_from_file_location('scope_indexer',root/'codex-profile/mac/hooks/graph_skill_index.py')
        indexer=importlib.util.module_from_spec(spec);spec.loader.exec_module(indexer)
        worker=indexer._GraphWorker(args.graph);worker._load_if_stale()
    endpoint='/tmp/codex-graph-'+str(os.getuid())+'/'+hashlib.sha256(str(args.graph.resolve()).encode()).hexdigest()[:24]+'.sock'
    def run(case):
        started=time.time()
        payload={'query':case['query'],'top_k':8,'category_slots':{'expert':2,'skill':4,'mcp':2},'deadline':time.time()*1000+50000}
        if args.live:
            with socket.socket(socket.AF_UNIX) as connection:
                connection.settimeout(50);connection.connect(endpoint)
                connection.sendall((json.dumps(payload)+'\n').encode())
                response=json.loads(connection.makefile('rb').readline())
        else:
            response={'ok':True,'results':worker.query(payload)}
        assert response.get('ok'),response
        actual=response['results']
        observed=[(r['kind'],r['name']) for r in actual]
        expected=[(r['kind'],canonical[r['id']]) for r in case['returned']]
        assert observed==expected,(case['case'],case['language'],observed,expected)
        for result,expected in zip(actual,case['returned']):
            assert abs(result['score']-expected['score'])<1e-12
            if result['kind']=='expert':
                assert result['description']==experts[result['name']]['description']
                assert result['retrieval_provenance']==experts[result['name']]['retrieval_provenance']
        return {'case':case['case'],'language':case['language'],'start':started,'end':time.time(),
            'queryPid':response.get('queryPid'),'scopes':[{'name':r['name'],'description':r['description']}
                for r in actual if r['kind']=='expert']}
    began=time.perf_counter()
    if args.live:
        with ThreadPoolExecutor(max_workers=8) as pool:
            rows=list(pool.map(run,cases))
    else:
        rows=[run(case) for case in cases]
    events=sorted([(r['start'],1) for r in rows]+[(r['end'],-1) for r in rows])
    current=peak=0
    for _,delta in events:
        current+=delta;peak=max(peak,current)
    summary={'requests':len(rows),'success':len(rows),'failures':0,'timeouts':0,'retries':0,
        'allIdentitiesAndScoresUnchanged':True,'allExpertScopesMatchOriginalRole':True,
        'experts':len(experts),'sourceGrounded':sum(m['retrieval_provenance']['state']=='source-grounded' for m in experts.values()),
        'wallSeconds':time.perf_counter()-began,'clientPeakOverlapping':peak,
        'queryProcesses':len({r['queryPid'] for r in rows if r['queryPid']}),
        'medianClientMs':statistics.median((r['end']-r['start'])*1000 for r in rows)}
    args.report.write_text(json.dumps({'schema':'expert-source-scope-verification/1','live':args.live,
        'summary':summary,'rows':rows,'limitations':['Preserving identity does not establish relevance or executing the expert.',
            'Client overlap and distinct PIDs, not CPU-span concurrency instrumentation.']},ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(summary))


if __name__=='__main__':
    main()
