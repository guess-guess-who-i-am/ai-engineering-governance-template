#!/usr/bin/env python3
"""Capture/compare full live records on a pinned global graph; no prompt export."""
import argparse,hashlib,importlib.util,json,os,socket,time
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--baseline');a=p.parse_args()
spec=importlib.util.spec_from_file_location('bench',Path(__file__).with_name('benchmark-graph-load.py'))
bench=importlib.util.module_from_spec(spec);spec.loader.exec_module(bench)
graph=Path.home()/'.codex/skill-registry/skills.graph.json'
def graph_digest():
 h=hashlib.sha256()
 with graph.open('rb') as stream:
  for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
 return h.hexdigest()
digest=graph_digest()
endpoint=Path('/tmp')/f'codex-graph-{os.getuid()}'/(hashlib.sha256(str(graph.resolve()).encode()).hexdigest()[:24]+'.sock')
queries=bench.PROMPTS+[q+' 保留全部要求并核验真实证据。'*80 for q in bench.PROMPTS[4:7]]
rows=[]
for query in queries:
 start=time.monotonic()
 with socket.socket(socket.AF_UNIX) as s:
  s.settimeout(65);s.connect(str(endpoint));s.sendall((json.dumps({'query':query,'top_k':8,'category_slots':{'expert':2,'skill':4,'mcp':2},'deadline':time.time()*1000+55000})+'\n').encode())
  reply=json.loads(s.makefile('rb').readline())
 assert reply.get('ok') and reply.get('results'),reply.get('error')
 rows.append({'querySha256':hashlib.sha256(query.encode()).hexdigest(),'records':reply['results'],'queryPid':reply['queryPid'],'seconds':time.monotonic()-start})
assert graph_digest()==digest,'graph changed during verification'
if a.baseline:
 old=json.loads(Path(a.baseline).read_text());assert old['graphSha256']==digest,'baseline graph changed'
 assert [(r['querySha256'],r['records']) for r in old['rows']]==[(r['querySha256'],r['records']) for r in rows],'full result records differ'
report={'graphSha256':digest,'queries':len(rows),'fullRecordsExactlyEqual':bool(a.baseline),'rows':rows}
Path(a.output).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='rows'}))
