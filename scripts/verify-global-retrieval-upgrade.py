#!/usr/bin/env python3
"""Verify the installed global runtime, concurrent socket and two-workspace Hook."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import plistlib
import socket
import statistics
import subprocess
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
HOME = Path.home()


def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', required=True, type=Path)
    parser.add_argument('--node', type=Path, default=Path('/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node'))
    parser.add_argument('--comparison', type=Path, default=ROOT / '.reports/resource-integration/runtime-upgrade-paired.json')
    parser.add_argument('--concurrency', type=int, default=20, choices=range(1, 129))
    args = parser.parse_args()
    global_root = HOME / '.codex'
    graph = global_root / 'skill-registry/skills.graph.json'
    worker = global_root / 'hooks/graph_skill_index.py'
    source_worker = ROOT / 'codex-profile/mac/hooks/graph_skill_index.py'
    comparison = json.loads(args.comparison.read_text())
    assert comparison['passed']
    assert sha(worker) == sha(source_worker) == comparison['frozenInputSha256'][str(source_worker)]
    assert sha(graph) == comparison['frozenInputSha256'][str(graph)]
    endpoint = f'/tmp/codex-graph-{os.getuid()}/{hashlib.sha256(str(graph).encode()).hexdigest()[:24]}.sock'
    challenges = json.loads((ROOT / 'scripts/resource-retrieval-identity-challenge.json').read_text())['cases']
    cases = [case for case in challenges if case['id'] in ('disk-service', 'crm-service', 'notes-service', 'repository-service')]
    catalog = json.loads((global_root / 'skill-registry/resource-modules.json').read_text())
    modules = {}
    for case in cases:
        found = [module for module in catalog['modules'] if module['kind'] == 'mcp-service' and module['name'] in case['targets']]
        assert len(found) == 1
        modules[case['id']] = found[0]
    run_id = uuid.uuid4().hex[:10]

    def request(number):
        case = cases[number % len(cases)]
        language = 'zh' if number % 2 else 'en'
        query = case[language] + f' [verification {run_id}-{number}]'
        began = time.perf_counter()
        with socket.socket(socket.AF_UNIX) as connection:
            connection.settimeout(55)
            connection.connect(endpoint)
            connection.sendall((json.dumps({'query': query, 'top_k': 8, 'deadline': time.time() * 1000 + 55000}) + '\n').encode())
            response = json.loads(connection.makefile('rb').readline())
        ended = time.perf_counter()
        assert response.get('ok'), response.get('error')
        records = response['results']
        assert records and records[0].get('module_id') == modules[case['id']]['id']
        assert response.get('readyLanguages') == ['en', 'zh']
        assert response.get('loads') == 1
        return {'number': number, 'case': case['id'], 'language': language, 'pid': response['pid'],
            'queryPid': response['queryPid'], 'loads': response['loads'], 'readyLanguages': response['readyLanguages'],
            'start': began, 'end': ended, 'ms': (ended - began) * 1000,
            'topModuleId': records[0]['module_id'], 'passed': True}

    began = time.perf_counter()
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        requests = list(pool.map(request, range(100)))
    wall = time.perf_counter() - began
    events = sorted([(row['start'], 1) for row in requests] + [(row['end'], -1) for row in requests])
    active = peak = 0
    for _, delta in events:
        active += delta
        peak = max(active, peak)
    assert peak > 1
    pids = {row['queryPid'] for row in requests}
    assert len(pids) == 4, pids
    hook_rows = []
    with tempfile.TemporaryDirectory(prefix='retrieval-installed-') as directory:
        workspaces = [Path(directory) / name for name in ('workspace-a', 'workspace-b')]
        for workspace in workspaces:
            workspace.mkdir()
        def hook(task):
            case, cwd = task
            began = time.perf_counter()
            env = {**os.environ, 'CODEX_HOME': str(global_root)}
            for key in ('CODEX_HOOK_DISPATCH_TEST_MODE', 'CODEX_HOOK_DISPATCH_HANDLERS_JSON',
                        'CODEX_SKILL_INDEX_PATH', 'CODEX_RESOURCE_CATALOG', 'CODEX_SKILL_GRAPH_PATH'):
                env.pop(key, None)
            result = subprocess.run([str(args.node), str(global_root / 'hooks/hook-dispatch.mjs')],
                input=json.dumps({'hook_event_name': 'UserPromptSubmit', 'prompt': case['zh'], 'cwd': str(cwd),
                    'session_id': 'retrieval-' + uuid.uuid4().hex, 'turn_id': '1'}),
                cwd=cwd, env=env, capture_output=True, text=True, timeout=65)
            context = json.loads(result.stdout).get('hookSpecificOutput', {}).get('additionalContext', '')
            target = modules[case['id']]
            passed = result.returncode == 0 and '[CODEX_SKILL_ROUTER_V2]' in context \
                and f'Module: {target["id"]};' in context and f'Read: {target["path"]}' in context \
                and not any(word in result.stderr.lower() for word in ('routing failed', 'skipped', 'timed out'))
            assert passed, (case['id'], result.stderr, context)
            return {'case': case['id'], 'workspace': cwd.name, 'ms': (time.perf_counter() - began) * 1000,
                'moduleId': target['id'], 'entryPath': target['path'], 'entrySha256': sha(Path(target['path'])),
                'context': context, 'stderr': result.stderr, 'passed': passed}
        with ThreadPoolExecutor(max_workers=8) as pool:
            hook_rows = list(pool.map(hook, [(case, cwd) for cwd in workspaces for case in cases]))
    launch_file = HOME / 'Library/LaunchAgents/local.task-tree.shared-agent.plist'
    with launch_file.open('rb') as stream:
        launch = plistlib.load(stream)
    rss = subprocess.run(['ps', '-o', 'pid=,rss=', '-p', ','.join(map(str, sorted(pids)))],
        capture_output=True, text=True, check=True).stdout
    assert sha(worker) == sha(source_worker)
    report = {'schemaVersion': 'global-retrieval-upgrade/1', 'workerSha256': sha(worker), 'graphSha256': sha(graph),
        'comparisonSha256': sha(args.comparison), 'passed': True,
        'requests': requests, 'summary': {'succeeded': len(requests), 'total': 100, 'clientConcurrency': args.concurrency,
            'observedPeakOutstanding': peak, 'queryProcesses': sorted(pids), 'wallSeconds': wall,
            'p50Ms': statistics.median(row['ms'] for row in requests), 'p95Ms': sorted(row['ms'] for row in requests)[94]},
        'hooks': hook_rows, 'hookPassed': len(hook_rows), 'processRssKiB': rss,
        'autostart': {key: launch.get(key) for key in ('Label', 'RunAtLoad', 'KeepAlive')},
        'limitations': [f'100 distinct uncached prompts at {args.concurrency} concurrent clients, not 100 simultaneous heavy LLM tasks',
            'Measures retrieval/routing, not authenticated service execution or task accuracy',
            'Concurrent latency includes queueing; not comparable to sequential paired experiment',
            'Manual actual global Hook calls in two empty workspaces; next UI prompt and whole-machine reboot not tested',
            'No LLM calls, token measurement, paid API calls or remote deployment']}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({key: report[key] for key in ('passed', 'summary', 'hookPassed', 'autostart')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
