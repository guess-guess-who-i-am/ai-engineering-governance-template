#!/usr/bin/env python3
"""Exercise brand-free requests through the installed worker and real Hook."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import math
import os
from pathlib import Path
import socket
import statistics
import subprocess
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def request(endpoint, query):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(60)
        connection.connect(str(endpoint))
        connection.sendall((json.dumps({'query': query, 'top_k': 8,
            'deadline': (time.time() + 60) * 1000}) + '\n').encode())
        data = b''
        while b'\n' not in data:
            chunk = connection.recv(65536)
            if not chunk:
                raise RuntimeError('Worker closed before response')
            data += chunk
    body = json.loads(data.split(b'\n')[0])
    assert body.get('ok'), body.get('error')
    assert body.get('results') and len(body['results']) <= 8
    return body


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--codex-root', type=Path, default=Path.home() / '.codex')
    parser.add_argument('--node', type=Path, required=True)
    parser.add_argument('--cases', type=Path, default=ROOT / 'scripts/resource-intent-routing-cases.json')
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--load-test', action='store_true', help='Also test 100 simultaneous distinct requests')
    args = parser.parse_args()
    graph = (args.codex_root / 'skill-registry/skills.graph.json').resolve()
    router = args.codex_root / 'hooks/skill-router.mjs'
    indexer = args.codex_root / 'hooks/graph_skill_index.py'
    endpoint = Path(f'/tmp/codex-graph-{os.getuid()}') / (hashlib.sha256(str(graph).encode()).hexdigest()[:24] + '.sock')
    frozen = {str(p): digest(p) for p in [graph, router, indexer, args.cases]}
    cases = json.loads(args.cases.read_text())['cases']
    assert cases, 'Empty case list must not pass'
    env = {**os.environ, 'CODEX_HOME': str(args.codex_root)}
    with tempfile.TemporaryDirectory(prefix='task-content-global-') as directory:
        spaces = [Path(directory) / f'workspace-{i}' for i in range(2)]
        for workspace in spaces:
            workspace.mkdir()
        def one(task):
            case, language, workspace = task
            query = case[language]
            started = time.perf_counter()
            body = request(endpoint, query)
            records = body['results']
            assert records and len(records) <= 8
            for row in records:
                if row.get('path'):
                    location = Path(row['path']).resolve()
                    assert location.is_relative_to(args.codex_root.resolve()) or location.is_relative_to(Path.home() / '.agents/skills'), location
                    assert location.is_file(), location
            worker_ms = (time.perf_counter() - started) * 1000
            started = time.perf_counter()
            hook = subprocess.run([str(args.node), str(router)], input=json.dumps({
                'hook_event_name': 'UserPromptSubmit', 'prompt': query}), cwd=workspace,
                env=env, capture_output=True, text=True, check=True, timeout=65)
            context = json.loads(hook.stdout).get('hookSpecificOutput', {}).get('additionalContext', '')
            assert '[CODEX_SKILL_ROUTER_V2]' in context, 'Missing actual Hook recommendation context'
            count = sum(line.startswith('- ') for line in context.splitlines())
            assert 1 <= count <= 4, count
            return {'case': case['id'], 'language': language, 'workspace': workspace.name,
                'query': query, 'pid': body.get('pid'), 'queryPid': body.get('queryPid'),
                'loads': body.get('loads'), 'readyLanguages': body.get('readyLanguages'),
                'workerMs': worker_ms, 'hookMs': (time.perf_counter() - started) * 1000,
                'names': [r['name'] for r in records], 'targetTop4': any(r['name'] in case['targets'] for r in records[:4]),
                'hookTargetVisible': any('- ' + name + ' [' in context for name in case['targets']),
                'hookCandidateCount': count, 'hookContextCharacters': len(context), 'context': context}
        tasks = [(case, lang, space) for case in cases for lang in ['zh', 'en'] for space in spaces]
        began = time.perf_counter()
        with ThreadPoolExecutor(max_workers=8) as pool:
            rows = list(pool.map(one, tasks))
        elapsed = time.perf_counter() - began
    load = None
    if args.load_test:
        run_id = uuid.uuid4().hex[:10]
        def cold(number):
            case, language = cases[number % len(cases)], 'zh' if number % 2 else 'en'
            query = case[language] + f' [request {run_id}-{number}]'
            start = time.perf_counter()
            body = request(endpoint, query)
            end = time.perf_counter()
            assert body.get('loads') == 1
            assert body.get('readyLanguages') == ['en', 'zh']
            return {'number': number, 'query': query, 'start': start, 'end': end,
                'ms': (end - start) * 1000, 'pid': body.get('pid'), 'queryPid': body.get('queryPid')}
        began = time.perf_counter()
        with ThreadPoolExecutor(max_workers=100) as pool:
            requests = list(pool.map(cold, range(100)))
        events = sorted([(r['start'], 1) for r in requests] + [(r['end'], -1) for r in requests])
        active = peak = 0
        for _, delta in events:
            active += delta
            peak = max(peak, active)
        assert peak > 1
        times = sorted(r['ms'] for r in requests)
        load = {'succeeded': len(requests), 'total': 100, 'clientConcurrency': 100,
            'peakOutstanding': peak, 'wallSeconds': time.perf_counter() - began,
            'p50Ms': statistics.median(times), 'p95Ms': times[94],
            'queryPids': sorted({r['queryPid'] for r in requests}), 'rows': requests,
            'limitation': '100 distinct nonce-suffixed retrieval requests; checks transport, not identity accuracy or 100 heavy LLM jobs.'}
    assert all(digest(Path(p)) == value for p, value in frozen.items())
    summaries = []
    for lang in ['zh', 'en']:
        chosen = [r for r in rows if r['language'] == lang]
        times = sorted(r['hookMs'] for r in chosen)
        summaries.append({'language': lang, 'n': len(chosen),
            'workerTargetTop4': sum(r['targetTop4'] for r in chosen),
            'hookTargetVisible': sum(r['hookTargetVisible'] for r in chosen),
            'hookP50Ms': statistics.median(times), 'hookP95Ms': times[math.ceil(.95 * len(times)) - 1]})
    report = {'schemaVersion': 'task-content-global-e2e/1', 'frozenInputSha256': frozen,
        'passedTransport': True, 'requests': len(rows), 'workspaces': 2, 'concurrency': 8,
        'elapsedSeconds': elapsed, 'summary': summaries, 'rows': rows,
        **({'load': load} if load is not None else {}),
        'limitations': ['Real installed worker/Hook with global entries; temporary empty workspaces.',
            'Each Hook follows the same direct worker prompt, so its result cache is primed; Hook times are not cold-request latency.',
            'Identity labels undercount equivalent modules, and missing target names do not establish total functional failure.',
            'Transport success does not establish module readiness, task accuracy or business execution.',
            'Context characters are not actual LLM tokens; no paid API or business tools executed.',
            'Wall times include queueing across eight callers; this is not a controlled speedup comparison.']}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: report[k] for k in ['passedTransport', 'requests', 'elapsedSeconds', 'summary']}))
    if load is not None:
        print(json.dumps({'load': {k: v for k, v in load.items() if k != 'rows'}}))


if __name__ == '__main__':
    main()
