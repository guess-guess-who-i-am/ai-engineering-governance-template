#!/usr/bin/env python3
"""Opt-in live Unix worker verification; writes no configuration or credentials."""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import socket
import time

p = argparse.ArgumentParser()
p.add_argument('--codex-home', default=str(Path.home() / '.codex'))
p.add_argument('--output', required=True)
p.add_argument('--distinct', action='store_true', help='Also measure 100 uncached distinct queries')
a = p.parse_args()
graph = (Path(a.codex_home) / 'skill-registry/skills.graph.json').resolve(strict=True)
digest = hashlib.sha256(str(graph).encode()).hexdigest()[:24]
endpoint = str(Path('/tmp') / f'codex-graph-{os.getuid()}' / f'{digest}.sock')
queries = ['desktop artifact report deliverable workflow',
           'third party skill plugin supply chain security review',
           'resolve git merge conflicts safely', 'diagnose regression root cause evidence',
           'design acceptance verification functional test strategy',
           'review code diff defects', 'research scientific paper evidence',
           'parallel agent worktree execution']

def request(index, delay=0, distinct=False):
    time.sleep(delay)
    start = time.time()
    try:
        with socket.socket(socket.AF_UNIX) as s:
            s.settimeout(60)
            s.connect(endpoint)
            query = queries[index % len(queries)]
            if distinct:
                query += f' verification case {time.time_ns()} {index}'
            s.sendall((json.dumps({'query': query, 'top_k': 8,
                                  'deadline': start * 1000 + 55000}) + '\n').encode())
            result = json.loads(s.makefile('rb').readline())
        assert result.get('ok') and result.get('results') and result.get('prefilter'), 'worker returned no usable results'
        return {'index': index, 'started': start, 'ended': time.time(), 'ok': True,
                **{k: result.get(k) for k in ['pid', 'queryPid', 'loads']},
                'names': [r['name'] for r in result['results']]}
    except Exception as error:
        return {'index': index, 'started': start, 'ended': time.time(), 'ok': False,
                'error': str(error)}

with concurrent.futures.ThreadPoolExecutor(max_workers=len(queries)) as pool:
    warm = list(pool.map(request, range(len(queries))))
new_skills_indexed = all(name in warm[i].get('names', []) for i, name in enumerate(
    ['desktop-task-workflow', 'skill-supply-chain-review']))
waves = []
for name in ['burst', 'staggered'] + (['distinct-burst'] if a.distinct else []):
    with concurrent.futures.ThreadPoolExecutor(max_workers=100) as pool:
        rows = list(pool.map(lambda i: request(i, (i // 20) * .2 if name == 'staggered' else 0,
                                              name == 'distinct-burst'), range(100)))
    latency = sorted((r['ended'] - r['started']) * 1000 for r in rows)
    events = sorted([(r['started'], 1) for r in rows] + [(r['ended'], -1) for r in rows])
    active = peak = 0
    for _, change in events:
        active += change
        peak = max(peak, active)
    waves.append({'name': name, 'requests': 100, 'successes': sum(r['ok'] for r in rows),
                  'peakOverlappingRequests': peak, 'p50Ms': round(latency[49], 1),
                  'p95Ms': round(latency[94], 1), 'maxMs': round(latency[-1], 1), 'rows': rows})
report = {'status': 'PASS' if new_skills_indexed and all(r['ok'] for r in warm) and all(w['successes'] == 100 for w in waves) else 'FAIL',
          'newSkillsRetrievedThroughGraph': new_skills_indexed,
          'warmup': warm, 'waves': waves, 'retries': 0, 'modelQualityMeasured': False}
out = Path(a.output)
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({**report, 'warmup': [{'ok': r['ok'], 'seconds': round(r['ended']-r['started'], 3)} for r in warm],
                  'waves': [{k: v for k, v in w.items() if k != 'rows'} for w in waves]}))
raise SystemExit(0 if report['status'] == 'PASS' else 1)
