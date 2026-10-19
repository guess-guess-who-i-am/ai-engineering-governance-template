"""Real retrieval/transport regression against an already-built Windows graph."""
import argparse
import concurrent.futures
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time

parser=argparse.ArgumentParser()
parser.add_argument('--root',required=True)
args=parser.parse_args()
root=Path(args.root)
endpoint=root/'skill-registry/private/graph-endpoint.json'
runtime=json.loads((root/'skill-registry/graph-runtime.json').read_text(encoding='utf-8'))

def request(payload,wrong_token=False):
    info=json.loads(endpoint.read_text(encoding='utf-8'))
    with socket.create_connection((info['host'],info['port']),timeout=60) as connection:
        connection.settimeout(60)
        connection.sendall((json.dumps({'deadline':time.time()*1000+55000,**payload,'token':'wrong' if wrong_token else info['token']})+'\n').encode())
        return json.loads(connection.makefile('rb').readline())

info=request({'op':'health'})
assert info['ok'] and info['processes']==2
assert not request({'op':'health'},wrong_token=True)['ok']
assert not request({'query':'expired','deadline':0})['ok']
query={'query':'Diagnose a reproducible error using falsifiable root cause hypotheses','candidates':[]}
first=request(query);assert first['ok'] and first['results']
second=request(query);assert second['ok'] and second['cacheHit']
assert first['queryPid']==second['queryPid']
started=time.time()
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    results=list(pool.map(lambda n:request({'query':f'Diagnose reproducible error case {n}','candidates':[]}),range(8)))
assert all(r['ok'] and r['results'] for r in results)
assert len({r['queryPid'] for r in results})<=2
print(json.dumps({'status':'passed','authenticationRejected':True,'persistentWorker':True,'requests':8,'computeProcesses':len({r['queryPid'] for r in results}),'elapsedSeconds':round(time.time()-started,3),'supervisorPid':info['pid']}))
