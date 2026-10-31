#!/usr/bin/env python3
"""Exercise a candidate's real persistent worker and Hook from two workspaces."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]


def request(endpoint, query, timeout=55):
    began = time.perf_counter()
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(timeout)
        connection.connect(str(endpoint))
        connection.sendall((json.dumps({'query': query, 'top_k': 8,
            'deadline': time.time() * 1000 + timeout * 1000}) + '\n').encode())
        data = b''
        while b'\n' not in data:
            chunk = connection.recv(65536)
            if not chunk:
                raise RuntimeError('Candidate worker closed without response')
            data += chunk
    result = json.loads(data.split(b'\n', 1)[0])
    if not result.get('ok'):
        raise RuntimeError(result.get('error', 'Candidate query failed'))
    return {'ms': round((time.perf_counter() - began) * 1000, 3),
        'pid': result['pid'], 'queryPid': result.get('queryPid'),
        'loads': result.get('loads'), 'readyLanguages': result.get('readyLanguages'),
        'prefilter': result.get('prefilter'), 'names': [row['name'] for row in result['results']]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', required=True, type=Path)
    parser.add_argument('--node', required=True, type=Path)
    parser.add_argument('--processes', type=int, default=2, choices=range(1, 5))
    parser.add_argument('--report', required=True, type=Path)
    args = parser.parse_args()
    stage = args.stage.resolve()
    graph = stage / 'skills.graph.json'
    production = (Path.home() / '.codex/skill-registry/skills.graph.json').resolve()
    if graph.resolve() == production:
        parser.error('This verifier is candidate-only; production graph refused')
    indexer = stage / 'hooks/graph_skill_index.py'
    router = stage / 'hooks/skill-router.mjs'
    for file in (graph, indexer, router, args.node):
        if not file.is_file():
            parser.error(f'Missing input: {file}')
    endpoint = Path(f'/tmp/codex-graph-{os.getuid()}') / (
        hashlib.sha256(str(graph).encode()).hexdigest()[:24] + '.sock')
    if endpoint.exists():
        parser.error(f'Candidate socket already in use; refusing to replace it: {endpoint}')
    env = {**os.environ, 'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1',
        'TOKENIZERS_PARALLELISM': 'false', 'OMP_NUM_THREADS': '1', 'MKL_NUM_THREADS': '1',
        'CODEX_GRAPH_TOOL_PYTHON': sys.executable}
    cases = json.loads((ROOT / 'scripts/resource-retrieval-holdout.json').read_text())['cases']
    chosen = [case for case in cases if case['id'] in (
        'parallel-feature-delivery', 'live-library-docs', 'trip-budget-feasibility')]
    # IDs are asserted rather than silently yielding an empty success.
    if len(chosen) != 3:
        parser.error('Expected parallel-feature-delivery, live-library-docs and trip-budget-feasibility cases')
    with tempfile.TemporaryDirectory(prefix='codex-resource-hook-') as directory:
        temporary = Path(directory)
        codex = temporary / 'codex'
        (codex / 'hooks').mkdir(parents=True)
        (codex / 'skill-registry').mkdir()
        (codex / 'hooks/graph_skill_index.py').symlink_to(indexer)
        evidence = Path.home() / '.codex/resource-evidence'
        if evidence.is_dir():
            (codex / 'resource-evidence').symlink_to(evidence, target_is_directory=True)
        (codex / 'skill-registry/skills-index.json').write_text(json.dumps({
            'skills': [], 'externalGraphPath': str(graph)}))
        (codex / 'skill-registry/routing-rules.json').write_text('{}')
        workspaces = [temporary / 'workspace-a', temporary / 'workspace-b']
        for workspace in workspaces:
            workspace.mkdir()
        env['CODEX_HOME'] = str(codex)
        began = time.perf_counter()
        with (temporary / 'worker.log').open('w+') as log:
            worker = subprocess.Popen([sys.executable, str(indexer), 'serve', '--graph', str(graph),
                '--socket', str(endpoint), '--processes', str(args.processes)],
                stdout=log, stderr=log, env=env, start_new_session=True)
            report = {'schemaVersion': 'resource-hook-evidence/1', 'graphPath': str(graph),
                'workerSha256': hashlib.sha256(indexer.read_bytes()).hexdigest(),
                'routerSha256': hashlib.sha256(router.read_bytes()).hexdigest(),
                'productionChanged': False, 'processes': args.processes, 'rows': [],
                'limitations': ['Verifies worker and Hook transport and candidate context only',
                    'Does not prove module task correctness or dependency availability',
                    'Workspaces are isolated empty fixtures; production hooks remain unchanged']}
            try:
                deadline = time.monotonic() + 120
                while not endpoint.exists():
                    if worker.poll() is not None:
                        raise RuntimeError('Candidate worker exited before creating socket')
                    if time.monotonic() > deadline:
                        raise TimeoutError('Candidate socket startup exceeded 120 seconds')
                    time.sleep(.1)
                report['warmup'] = [request(endpoint, 'search files debugging performance skills', 120),
                    request(endpoint, '搜索文件，调试根因，性能分析与工具检索', 120)]
                report['startupSeconds'] = round(time.perf_counter() - began, 3)
                tasks = [(case, language, workspaces[n % 2]) for n, case in enumerate(chosen)
                    for language in ('en', 'zh')]

                def one(task):
                    case, language, cwd = task
                    began = time.perf_counter()
                    hook = subprocess.run([str(args.node), str(router)],
                        input=json.dumps({'hook_event_name': 'UserPromptSubmit', 'prompt': case[language]}),
                        cwd=cwd, env=env, capture_output=True, text=True, timeout=65, check=True)
                    body = json.loads(hook.stdout)
                    context = body.get('hookSpecificOutput', {}).get('additionalContext', '')
                    return {'case': case['id'], 'language': language, 'workspace': cwd.name,
                        'ms': round((time.perf_counter() - began) * 1000, 3),
                        'hasContext': bool(context), 'stderr': hook.stderr, 'context': context,
                        'targetPresent': any(f'- {name} [' in context for name in case['targets'])}

                with ThreadPoolExecutor(max_workers=6) as pool:
                    report['rows'] = list(pool.map(one, tasks))
                report['requests'] = [request(endpoint, case['en']) for case in chosen]
                report['allReturnedContext'] = all(row['hasContext'] and not row['stderr'] for row in report['rows'])
                report['targetPresentCount'] = sum(row['targetPresent'] for row in report['rows'])
            finally:
                os.killpg(worker.pid, signal.SIGTERM)
                try:
                    worker.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    os.killpg(worker.pid, signal.SIGKILL)
                    worker.wait(timeout=10)
                endpoint.unlink(missing_ok=True)
                Path(str(endpoint) + '.lock').unlink(missing_ok=True)
                log.seek(0)
                report['workerLogTail'] = log.read()[-4000:]
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({key: report.get(key) for key in ('graphPath', 'startupSeconds',
            'allReturnedContext', 'targetPresentCount', 'productionChanged')}, ensure_ascii=False))
        print(json.dumps({'report': str(args.report), 'hookQueries': len(report['rows'])}))


if __name__ == '__main__':
    main()
