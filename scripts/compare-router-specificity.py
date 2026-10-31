#!/usr/bin/env python3
"""Real Hook + global graph comparison. Never mutate the running service.

Baseline is the installed Hook/worker; candidate Hook uses either that same
worker or one isolated new-indexer worker. Both use the very same graph bytes.
"""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import socket
import statistics
import subprocess
import tempfile
import threading
import time
from types import ModuleType

ROOT = Path(__file__).resolve().parents[1]
HOME = Path.home() / '.codex'
NODE = Path.home() / '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
for key in ('HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE'):
    os.environ[key] = '1'
for key in ('OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'OPENBLAS_NUM_THREADS'):
    os.environ[key] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'


def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def punctuation_candidate(entry):
    """An explicitly experimental indexer; never write it to install sources.

    Retained for reproducibility because this proposal still regresses a
    connector. Production installs use the unchanged indexer, NOT this module.
    """
    source = entry.read_text()
    anchor = '\ndef english_retrieval_description(tool):'
    helper = '''\ndef lexical_query_tokens(text: str) -> list[str]:
    return [token for token in chinese_tokenize(text)
            if any(char.isalnum() for char in token)]

'''
    assert source.count(anchor) == 1
    source = source.replace(anchor, helper + anchor)
    old = '        tokens = set(engine._tokenize(query))'
    assert source.count(old) == 1
    source = source.replace(old, '''        tokens = set(lexical_query_tokens(query) if engine._tokenize is chinese_tokenize
                     else engine._tokenize(query))''')
    # Only the Chinese score channel, not the English sparse scorer.
    begin = source.index('def prepare_chinese_retrieval(engine):')
    before, tail = source[:begin], source[begin:]
    old = '        raw = bm25._tokenize_fn(query)'
    assert tail.count(old) == 1
    source = before + tail.replace(old, '        raw = lexical_query_tokens(query)')
    module = ModuleType('experimental_punctuation_indexer')
    module.__file__ = str(entry)
    exec(compile(source, str(entry) + ':punctuation-experiment', 'exec'), module.__dict__)
    module.experiment_source_sha256 = hashlib.sha256(source.encode()).hexdigest()
    return module


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--report', type=Path, default=ROOT / '.reports/router-specificity.json')
    p.add_argument('--workers', type=int, default=8)
    p.add_argument('--hook-only', action='store_true', help='Do not load the rejected punctuation experiment')
    args = p.parse_args()
    files = ['resource-retrieval-holdout.json', 'resource-retrieval-validation.json',
             'resource-retrieval-unseen.json', 'resource-expert-routing-challenge.json',
             'resource-routing-mechanism-challenge.json', 'resource-routing-specificity-holdout.json']
    registry = json.loads((HOME / 'skill-registry/skills-index.json').read_text())
    graph = Path(registry['externalGraphPath']).resolve()
    old_hook = HOME / 'hooks/skill-router.mjs'
    new_hook = ROOT / 'codex-profile/.codex/hooks/skill-router.mjs'
    new_indexer = ROOT / 'codex-profile/mac/hooks/graph_skill_index.py'
    inputs = {str(file): sha(file) for file in [graph, old_hook, new_hook, new_indexer,
              HOME / 'hooks/graph_skill_index.py', HOME / 'skill-registry/routing-rules.json',
              ROOT / 'codex-profile/.codex/skill-registry/routing-rules.json', Path(__file__).resolve(),
              HOME / 'skill-registry/skills-index.json', *[ROOT / 'scripts' / f for f in files]]}
    tasks = [{'set': name, 'case': c['id'], 'kind': c.get('kind') or {
                  'expert-required': 'expert', 'bounded-skill': 'skill', 'bounded-tool': 'mcp-service'
              }.get(c.get('split'), 'expert'), 'targets': c['targets'],
              'language': lang, 'query': c[lang]} for name in files
             for c in json.loads((ROOT / 'scripts' / name).read_text())['cases'] for lang in ('en', 'zh')]
    rows = []
    variants = ['baseline', 'hook_only'] + ([] if args.hook_only else ['hook_and_tokens'])
    manifest = json.loads(graph.with_suffix('.manifest.json').read_text())
    node_count = sum(manifest[key] for key in ('skillCount', 'mcpToolCount', 'resourceModuleCount'))
    experiment_sha = None
    startup, loads = 0, 0

    def run(job):
        task, variant, hook, codex_home, workspace = job
        before = time.perf_counter()
        result = subprocess.run([str(NODE), str(hook)],
            input=json.dumps({'hook_event_name': 'UserPromptSubmit', 'prompt': task['query'], 'cwd': str(workspace)}),
            env={**os.environ, 'CODEX_HOME': str(codex_home),
                 'CODEX_GRAPH_TOOL_PYTHON': str(HOME / 'tools/graph-tool-call-venv/bin/python')},
            text=True, capture_output=True, timeout=65)
        if result.returncode or result.stderr:
            raise RuntimeError(f'{variant} {task["case"]}: {result.returncode} {result.stderr}')
        context = json.loads(result.stdout).get('hookSpecificOutput', {}).get('additionalContext', '')
        entries = re.findall(r'^- (.+?) \[([^;]+);', context, re.M)
        returned = [name for name, _ in entries]
        kind_map = {'Skill': 'skill', 'Complete expert module': 'expert', 'MCP service module': 'mcp-service'}
        kinds = [kind_map.get(kind, 'mcp' if kind.startswith('MCP/') else kind) for _, kind in entries]
        if not returned:
            raise ValueError(f'No candidates: {variant} {task["query"]}')
        return {**task, 'variant': variant, 'returned': returned, 'returnedKinds': kinds,
                'nameRank': next((i + 1 for i, n in enumerate(returned) if n in task['targets']), None),
                'rank': next((i + 1 for i, n in enumerate(returned) if n in task['targets'] and kinds[i] == task['kind']), None),
                'ms': (time.perf_counter() - before) * 1000, 'contextChars': len(context)}

    with tempfile.TemporaryDirectory(prefix='specificity-', dir='/tmp') as temp:
        sandbox = Path(temp).resolve()
        other_workspace = sandbox / 'other-workspace'
        other_workspace.mkdir()
        for directory in ('hooks', 'skill-registry'):
            (sandbox / directory).mkdir()
        (sandbox / 'hooks/graph_skill_index.py').write_text('# Isolated entry marker; never spawned.')
        (sandbox / 'skill-registry/skills-index.json').write_text(json.dumps(registry))
        old_rules = json.loads((HOME / 'skill-registry/routing-rules.json').read_text())
        new_rules = json.loads((ROOT / 'codex-profile/.codex/skill-registry/routing-rules.json').read_text())
        (sandbox / 'skill-registry/routing-rules.json').write_text(json.dumps({**old_rules,
            '_capabilityRoutes': new_rules['_capabilityRoutes']}))
        # Interleave baseline/new Hook jobs to avoid attributing warm-cache
        # ordering effects to a policy speedup. These share the installed graph.
        jobs = [(task, variant, hook, HOME if variant == 'baseline' else sandbox, ROOT if i % 2 == 0 else other_workspace)
                for i, task in enumerate(tasks) for variant, hook in
                [('baseline', old_hook), ('hook_only', new_hook)]]
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            rows.extend(pool.map(run, jobs))
        print(json.dumps({'phase': 'live_hook_comparison', 'completed': len(rows)}), flush=True)
        if not args.hook_only:
            indexer = punctuation_candidate(new_indexer)
            experiment_sha = indexer.experiment_source_sha256
            worker = indexer._GraphWorker(graph)
            began = time.perf_counter()
            loaded = worker._load_if_stale()
            startup = time.perf_counter() - began
            assert len(loaded.tools) == node_count, len(loaded.tools)
            # Marker identifies only the isolated socket; the worker loads the
            # unchanged full graph with verified sidecars, not this marker.
            marker = sandbox / 'graph.json'
            marker.write_text('{}')
            (sandbox / 'skill-registry/skills-index.json').write_text(json.dumps({**registry, 'externalGraphPath': str(marker)}))
            directory = Path('/tmp') / f'codex-graph-{os.getuid()}'
            address = directory / (hashlib.sha256(str(marker).encode()).hexdigest()[:24] + '.sock')
            server = indexer._WorkerServer(str(address), worker)
            address.chmod(0o600)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                with ThreadPoolExecutor(max_workers=args.workers) as pool:
                    rows.extend(pool.map(run, [(task, 'hook_and_tokens', new_hook, sandbox,
                        ROOT if i % 2 == 0 else other_workspace) for i, task in enumerate(tasks)]))
            finally:
                server.shutdown()
                server.server_close()
                address.unlink(missing_ok=True)
            loads = worker.loads
            print(json.dumps({'phase': 'isolated_tokenizer_comparison', 'completed': len(tasks), 'loads': loads}), flush=True)

    summary = []
    comparisons = []
    for variant in variants:
        selected = [r for r in rows if r['variant'] == variant]
        summary.append({'variant': variant, 'n': len(selected), 'hit4': sum(r['rank'] is not None for r in selected),
            'nameOnlyHit4': sum(r['nameRank'] is not None for r in selected),
            'medianMs': statistics.median(r['ms'] for r in selected),
            'p95Ms': sorted(r['ms'] for r in selected)[int(.95 * (len(selected) - 1))],
            'medianContextChars': statistics.median(r['contextChars'] for r in selected),
            'top1': Counter(r['returned'][0] for r in selected).most_common(12),
            'top4': Counter(n for r in selected for n in r['returned']).most_common(12),
            'byKind': {k: {'n': sum(r['kind'] == k for r in selected),
                'hit4': sum(r['kind'] == k and r['rank'] is not None for r in selected)} for k in sorted({r['kind'] for r in selected})},
            'bySplit': {s: {'n': sum(r['set'] == s for r in selected), 'hit4': sum(r['set'] == s and r['rank'] is not None for r in selected)} for s in files}})
    baseline = {(r['set'], r['case'], r['language']): r for r in rows if r['variant'] == 'baseline'}
    for variant in variants[1:]:
        wins, losses = [], []
        for row in (r for r in rows if r['variant'] == variant):
            old = baseline[row['set'], row['case'], row['language']]
            if (row['rank'] is None) != (old['rank'] is None):
                (wins if row['rank'] is not None else losses).append({'case': row['case'], 'language': row['language'],
                    'before': old['returned'], 'after': row['returned'], 'targets': row['targets']})
        comparisons.append({'variant': variant, 'wins': wins, 'losses': losses})
    assert all(sha(Path(file)) == value for file, value in inputs.items()), 'Inputs changed during comparison'
    report = {'schemaVersion': 'router-specificity/2', 'inputsSha256': inputs, 'nodesFromManifest': node_count,
        'candidateStartupSeconds': startup, 'concurrency': args.workers, 'candidateLoads': loads,
        'experimentalIndexerSourceSha256': experiment_sha,
        'paidCalls': 0, 'productionChanged': False, 'summary': summary, 'comparisons': comparisons, 'rows': rows,
        'limitations': ['Author-labeled identity Hit@4, NOT semantic accuracy or task success.',
            'Baseline/Hook-only share live caches; token variant has an isolated warm worker. Latencies are operational observations, not controlled speedup.',
            'Context characters are not LLM tokens. No main-LLM cost or downstream execution claimed.',
            'Old 118 diagnosis queries and 20 new authored queries must be reported separately.',
            'Frequency concentration alone cannot establish irrelevance; no name blacklist or type oracle used.']}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'report': str(args.report), 'summary': summary,
        'comparisons': [{'variant': c['variant'], 'wins': len(c['wins']), 'losses': len(c['losses'])} for c in comparisons]}), flush=True)


if __name__ == '__main__':
    main()
