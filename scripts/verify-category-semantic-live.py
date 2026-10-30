#!/usr/bin/env python3
"""Check the deployed socket against frozen full-pool experimental predictions."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import socket
import statistics
import time


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--traces',type=Path,nargs='+',required=True)
    parser.add_argument('--report',type=Path,required=True)
    args=parser.parse_args()
    graph=Path.home()/'.codex/skill-registry/skills.graph.json'
    digest=hashlib.sha256(str(graph.resolve()).encode()).hexdigest()[:24]
    endpoint=f'/tmp/codex-graph-{os.getuid()}/{digest}.sock'
    tasks=[row for p in args.traces for row in json.loads(p.read_text())['rows'] if row['mode']=='fullpool']
    data=json.loads(graph.read_text())
    canonical={n:t['metadata'].get('skill_name',t['metadata'].get('mcp_original_name',n))
               for n,t in data['tools'].items()}
    del data
    def request(row):
        started=time.time()
        with socket.socket(socket.AF_UNIX) as connection:
            connection.settimeout(50);connection.connect(endpoint)
            payload={'query':row['query'],'top_k':8,'category_slots':{'expert':2,'skill':4,'mcp':2},'deadline':time.time()*1000+50000}
            connection.sendall((json.dumps(payload)+'\n').encode())
            response=json.loads(connection.makefile('rb').readline())
        assert response.get('ok'),response.get('error')
        actual=response['results']
        observed=[(x['kind'],x['name']) for x in actual]
        expected=[(x['kind'],canonical[x['id']]) for x in row['returned']]
        assert observed==expected,(row['case'],row['language'],observed,expected)
        assert len([x for x in actual if x['kind']=='expert'])==2
        assert response['readyLanguages']==['en','zh']
        assert response['loads']==1
        return {'case':row['case'],'language':row['language'],'kind':row['kind'],
            'start':started,'end':time.time(),'queryPid':response['queryPid'],
            'matchesFrozenExperiment':True,'targetHit':row['rank'] is not None,
            'experts':[x['name'] for x in actual if x['kind']=='expert']}
    begun=time.perf_counter()
    with ThreadPoolExecutor(max_workers=8) as pool:rows=list(pool.map(request,tasks))
    events=sorted([(r['start'],1) for r in rows]+[(r['end'],-1) for r in rows])
    current=peak=0
    for _,change in events:current+=change;peak=max(current,peak)
    summary={'requests':len(rows),'success':len(rows),'failures':0,'retries':0,'timeouts':0,
        'wallSeconds':time.perf_counter()-begun,'queryProcesses':len({r['queryPid'] for r in rows}),
        'clientPeakOverlapping':peak,'allPredictionsMatched':True,
        'medianClientMs':statistics.median((r['end']-r['start'])*1000 for r in rows)}
    args.report.write_text(json.dumps({'schema':'category-semantic-live/v1','summary':summary,'rows':rows,
        'workerSha256':hashlib.sha256((Path.home()/'.codex/hooks/graph_skill_index.py').read_bytes()).hexdigest(),
        'graphSha256':hashlib.sha256(graph.read_bytes()).hexdigest(),
        'limitations':['Client overlap and multiple query PIDs verify deployed concurrency, not CPU span instrumentation.',
                      'Retrieval predictions only; no claim of executing the recommended experts.']},ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(summary))


if __name__=='__main__':main()
