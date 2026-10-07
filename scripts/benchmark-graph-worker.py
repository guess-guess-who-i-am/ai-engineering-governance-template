#!/usr/bin/env python3
"""Measure deployed Hook + worker identity on the user's existing global graph."""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import socket
import signal
import subprocess
import time

parser = argparse.ArgumentParser()
parser.add_argument('--node', required=True)
parser.add_argument('--codex-home', required=True)
parser.add_argument('--restart-worker', action='store_true')
args = parser.parse_args()
root = Path(args.codex_home)
registry = json.loads((root / 'skill-registry/skills-index.json').read_text())
graph = Path(registry['externalGraphPath']).resolve()
digest = hashlib.sha256(str(graph).encode()).hexdigest()[:24]
sock = Path('/tmp') / f'codex-graph-{os.getuid()}' / f'{digest}.sock'
query = 'resolve a git merge conflict safely'
env = {**os.environ, 'CODEX_HOME': str(root)}


def route(cwd):
    start = time.perf_counter()
    result = subprocess.run([args.node, str(root / 'hooks/hook-dispatch.mjs')],
                            input=json.dumps({'hook_event_name': 'UserPromptSubmit',
                                              'prompt': query, 'cwd': cwd}),
                            capture_output=True, text=True, env=env, timeout=65)
    context = json.loads(result.stdout).get('hookSpecificOutput', {}).get('additionalContext', '')
    assert result.returncode == 0 and 'resolving-merge-conflicts' in context, result.stderr
    assert 'GraphToolCall routing failed' not in result.stderr, result.stderr
    return round(time.perf_counter() - start, 3)


def identity(_=None):
    start = time.perf_counter()
    with socket.socket(socket.AF_UNIX) as s:
        s.settimeout(55)
        s.connect(str(sock))
        s.sendall((json.dumps({'query': query, 'top_k': 8,
                              'deadline': time.time()*1000+55000})+'\n').encode())
        response = json.loads(s.makefile('rb').readline())
    assert response['ok'] and response['prefilter'], response
    assert response['results'][0]['name'] == 'resolving-merge-conflicts', response
    return {k: response[k] for k in ('pid', 'loads', 'prefilter')} | {
        'seconds': round(time.perf_counter()-start, 3)}


if args.restart_worker:
    previous = identity()
    command = subprocess.check_output(['ps', '-o', 'command=', '-p', str(previous['pid'])], text=True)
    assert str(root / 'hooks/graph_skill_index.py') in command and str(graph) in command
    os.kill(previous['pid'], signal.SIGTERM)
    time.sleep(.2)
timings = [route(str(Path.cwd())), route('/tmp'), route(str(Path.home()))]
first = identity()
with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
    wave = list(pool.map(identity, range(20)))
assert {r['pid'] for r in wave} == {first['pid']}
assert all(r['loads'] == first['loads'] for r in wave)
rss_kib = int(subprocess.check_output(['ps', '-o', 'rss=', '-p', str(first['pid'])], text=True).strip())
report = {'graphBytes': graph.stat().st_size, 'hookSeconds': timings,
          'worker': first, 'concurrentRequests': 20, 'workerProcesses': 1,
          'waveSlowestSeconds': max(r['seconds'] for r in wave),
          'residentMiB': round(rss_kib/1024, 1)}
print(json.dumps(report, ensure_ascii=False, indent=2))
