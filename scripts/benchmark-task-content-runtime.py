#!/usr/bin/env python3
"""Same-process, interleaved warm timing of frozen global and candidate workers."""
import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import random
import statistics
import time

for key in ('HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE'):
    os.environ[key] = '1'
for key in ('OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'OPENBLAS_NUM_THREADS'):
    os.environ[key] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
ROOT = Path(__file__).resolve().parents[1]


def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--baseline-indexer', type=Path)
    parser.add_argument('--baseline-graph', type=Path)
    args = parser.parse_args()
    if bool(args.baseline_indexer) != bool(args.baseline_graph):
        parser.error('Provide both --baseline-indexer and --baseline-graph, or neither')
    production = Path.home() / '.codex'
    paths = {'baseline': (production / 'hooks/graph_skill_index.py', production / 'skill-registry/skills.graph.json'),
             'candidate': (args.stage / 'hooks/graph_skill_index.py', args.stage / 'skills.graph.json')}
    if args.baseline_indexer:
        paths['baseline'] = args.baseline_indexer, args.baseline_graph
    if all(sha(paths['baseline'][i]) == sha(paths['candidate'][i]) for i in range(2)):
        parser.error('Baseline is already the candidate. Use the exact earlier source/graph from the recorded hashes; do not compare the deployed version to itself.')
    cases_path = ROOT / 'scripts/resource-intent-routing-cases.json'
    frozen = {str(p): sha(p) for pair in paths.values() for p in pair}
    frozen[str(cases_path)] = sha(cases_path)
    workers = {}
    for variant, (source, graph) in paths.items():
        spec = importlib.util.spec_from_file_location(variant + '_timing', source)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        worker = module._GraphWorker(graph)
        worker._load_if_stale()
        workers[variant] = worker
    print(json.dumps({'phase': 'ready', 'workers': len(workers)}), flush=True)
    tasks = [(case, lang, repeat) for repeat in range(5)
        for case in json.loads(cases_path.read_text())['cases'] for lang in ['zh', 'en']]
    random.Random(20261024).shuffle(tasks)
    rows = []
    for number, (case, lang, repeat) in enumerate(tasks):
        row = {'id': case['id'], 'language': lang, 'repeat': repeat}
        for variant in (['baseline', 'candidate'] if number % 2 == 0 else ['candidate', 'baseline']):
            worker = workers[variant]
            for channel in [worker._graph, worker._english_graph]:
                index = channel._get_retrieval_engine()._embedding_index
                index._cached_encode.cache_clear()
                index._provider._vectors.clear()
            worker._results.clear()
            began = time.perf_counter()
            results = worker.query({'query': case[lang], 'top_k': 8})
            row[variant] = {'ms': (time.perf_counter() - began) * 1000,
                'names': [r['name'] for r in results]}
        rows.append(row)
    summary = []
    for lang in ['zh', 'en']:
        for variant in ['baseline', 'candidate']:
            times = sorted(row[variant]['ms'] for row in rows if row['language'] == lang)
            summary.append({'language': lang, 'variant': variant, 'n': len(times),
                'p50Ms': statistics.median(times), 'p95Ms': times[math.ceil(.95 * len(times)) - 1]})
    assert all(sha(Path(p)) == value for p, value in frozen.items())
    report = {'schemaVersion': 'task-content-runtime-timing/1', 'frozenInputSha256': frozen,
        'productionChanged': False, 'timingRepeats': 5, 'summary': summary, 'rows': rows,
        'limitations': ['Sequential interleaved warm worker API; five repeats for twelve frozen queries per language.',
            'Query/result caches cleared, immutable corpus/model/graph-expansion caches retained for both versions.',
            'Not whole-agent, Hook, network or cold-start latency; no universal speed guarantee.',
            'No paid API, business tool execution or actual LLM token measurement.']}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'phase': 'done', 'summary': summary}), flush=True)


if __name__ == '__main__':
    main()
