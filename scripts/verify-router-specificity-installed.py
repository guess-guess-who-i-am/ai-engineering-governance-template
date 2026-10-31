#!/usr/bin/env python3
"""Verify deployed Hook outputs match the approved comparison, in two workspaces."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
HOME = Path.home() / '.codex'
NODE = Path.home() / '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'


def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--comparison', type=Path, default=ROOT / '.reports/router-specificity-release.json')
    p.add_argument('--report', type=Path, default=ROOT / '.reports/router-specificity-installed.json')
    args = p.parse_args()
    comparison = json.loads(args.comparison.read_text())
    approved = [r for r in comparison['rows'] if r['variant'] == 'hook_only']
    hook = HOME / 'hooks/skill-router.mjs'
    source = ROOT / 'codex-profile/.codex/hooks/skill-router.mjs'
    assert sha(hook) == sha(source) == comparison['inputsSha256'][str(source)]
    registry = json.loads((HOME / 'skill-registry/skills-index.json').read_text())
    graph = Path(registry['externalGraphPath']).resolve()
    indexer = HOME / 'hooks/graph_skill_index.py'
    assert sha(graph) == comparison['inputsSha256'][str(graph)]
    assert sha(indexer) == comparison['inputsSha256'][str(indexer)]
    rules = json.loads((HOME / 'skill-registry/routing-rules.json').read_text())
    source_rules = json.loads((ROOT / 'codex-profile/.codex/skill-registry/routing-rules.json').read_text())
    assert rules['_capabilityRoutes'] == source_rules['_capabilityRoutes']
    address = f'/tmp/codex-graph-{os.getuid()}/' + hashlib.sha256(str(graph).encode()).hexdigest()[:24] + '.sock'

    def status():
        with socket.socket(socket.AF_UNIX) as s:
            s.settimeout(10)
            s.connect(address)
            s.sendall(b'{"query":""}\n')
            r = json.loads(s.makefile('rb').readline())
            assert r['ok'] and set(r['readyLanguages']) == {'en', 'zh'}
            return {k: r[k] for k in ('pid', 'loads', 'readyLanguages', 'prefilter')}

    before = status()
    with tempfile.TemporaryDirectory(prefix='installed-routing-workspace-') as other:
        workspaces = [str(ROOT), str(Path(other).resolve())]
        def run(item):
            number, expected = item
            workspace = workspaces[number % 2]
            began = time.perf_counter()
            result = subprocess.run([str(NODE), str(hook)],
                input=json.dumps({'hook_event_name': 'UserPromptSubmit', 'prompt': expected['query'], 'cwd': workspace}),
                text=True, capture_output=True, timeout=60)
            assert result.returncode == 0 and not result.stderr, result.stderr
            context = json.loads(result.stdout)['hookSpecificOutput']['additionalContext']
            entries = re.findall(r'^- (.+?) \[([^;]+);', context, re.M)
            kind_map = {'Skill': 'skill', 'Complete expert module': 'expert', 'MCP service module': 'mcp-service'}
            names = [name for name, _ in entries]
            kinds = [kind_map.get(kind, 'mcp' if kind.startswith('MCP/') else kind) for _, kind in entries]
            assert names == expected['returned'], (expected['case'], expected['language'], names, expected['returned'])
            assert kinds == expected['returnedKinds']
            return {k: expected[k] for k in ('set', 'case', 'language', 'query', 'rank')} | {
                'workspace': workspace, 'returned': names, 'returnedKinds': kinds,
                'ms': (time.perf_counter() - began) * 1000, 'matchesApproved': True}
        with ThreadPoolExecutor(max_workers=8) as pool:
            rows = list(pool.map(run, enumerate(approved)))
    after = status()
    assert before == after, (before, after)
    report = {'schemaVersion': 'installed-specificity-verification/1',
        'comparisonSha256': sha(args.comparison), 'hookSha256': sha(hook), 'graphSha256': sha(graph),
        'indexerSha256': sha(indexer), 'requests': len(rows), 'matched': len(rows), 'concurrency': 8,
        'workerBefore': before, 'workerAfter': after, 'workspaces': workspaces,
        'hit4NameAndKind': sum(r['rank'] is not None for r in rows), 'paidCalls': 0,
        'limitations': ['Routing output verification, not downstream task execution or semantic accuracy.',
            'Temporary second workspace is removed after verification. No machine reboot tested.'], 'rows': rows}
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k != 'rows'}, ensure_ascii=False))


if __name__ == '__main__':
    main()
