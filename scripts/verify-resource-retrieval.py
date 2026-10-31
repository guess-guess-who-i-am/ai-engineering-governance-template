#!/usr/bin/env python3
"""Measure unchanged GraphToolCall ranking against frozen bilingual queries."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import gc
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import statistics
import time

os.environ.setdefault('HF_HUB_OFFLINE', '1')
os.environ.setdefault('TRANSFORMERS_OFFLINE', '1')
os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')
os.environ.setdefault('OMP_NUM_THREADS', '1')
os.environ.setdefault('MKL_NUM_THREADS', '1')
ROOT = Path(__file__).resolve().parents[1]


def percentile(values, fraction):
    return sorted(values)[min(len(values) - 1, max(0, math.ceil(len(values) * fraction) - 1))]


def evaluate(graph_path, cases, indexer, concurrency):
    began = time.perf_counter()
    worker = indexer._GraphWorker(graph_path)
    worker._load_if_stale()
    startup = time.perf_counter() - began
    tasks = [(case, language) for case in cases for language in ('en', 'zh')]
    def one(task):
        case, language = task
        began = time.perf_counter()
        results = worker.query({'query': case[language], 'top_k': 8})
        elapsed = (time.perf_counter() - began) * 1000
        matches = [n + 1 for n, result in enumerate(results)
            if result.get('kind', 'skill') == case['kind'] and result['name'] in case['targets']]
        module_matches = [n + 1 for n, result in enumerate(results)
            if result.get('module_id') and result.get('kind') == case['kind'] and result['name'] in case['targets']]
        return {'case': case['id'], 'kind': case['kind'], 'language': language, 'query': case[language],
            'expected': case['targets'], 'rank': min(matches) if matches else None,
            'moduleRank': min(module_matches) if module_matches else None, 'ms': round(elapsed, 3),
            'returned': [{'name': row['name'], 'kind': row['kind'], 'module_id': row.get('module_id'),
                          'availability': row.get('availability'), 'score': row['score']} for row in results]}
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        rows = list(pool.map(one, tasks))
    summary = []
    for kind in ('expert', 'skill', 'mcp-service'):
        for language in ('en', 'zh'):
            selected = [row for row in rows if row['kind'] == kind and row['language'] == language]
            summary.append({'kind': kind, 'language': language, 'n': len(selected),
                'top1': sum(row['rank'] == 1 for row in selected),
                'top4': sum(row['rank'] is not None and row['rank'] <= 4 for row in selected),
                'top8': sum(row['rank'] is not None for row in selected),
                'moduleTop4': sum(row['moduleRank'] is not None and row['moduleRank'] <= 4 for row in selected),
                'p50Ms': round(statistics.median(row['ms'] for row in selected), 3),
                'p95Ms': round(percentile([row['ms'] for row in selected], .95), 3)})
    del worker
    gc.collect()
    return {'graphPath': str(graph_path), 'graphSha256': hashlib.sha256(graph_path.read_bytes()).hexdigest(),
        'startupSeconds': round(startup, 3), 'concurrency': concurrency, 'summary': summary, 'rows': rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--graph', required=True, type=Path)
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--baseline-report', type=Path, help='Reuse a baseline run with identical frozen cases')
    parser.add_argument('--indexer', type=Path, default=ROOT / 'codex-profile/mac/hooks/graph_skill_index.py')
    parser.add_argument('--cases', type=Path, default=ROOT / 'scripts/resource-retrieval-holdout.json')
    parser.add_argument('--report', required=True, type=Path)
    parser.add_argument('--concurrency', type=int, default=8, choices=range(1, 21))
    parser.add_argument('--without-semantic-guard', action='store_true',
        help='Diagnostic counterfactual: disable only the new runtime guard in memory')
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location('candidate_indexer', args.indexer)
    indexer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(indexer)
    if args.without_semantic_guard:
        if not hasattr(indexer, 'prepare_semantic_candidate_guard'):
            parser.error('Indexer does not expose the semantic guard intervention')
        indexer.prepare_semantic_candidate_guard = lambda engine: None
    cases = json.loads(args.cases.read_text())
    results = {}
    cases_hash = hashlib.sha256(args.cases.read_bytes()).hexdigest()
    if args.baseline and args.baseline_report:
        parser.error('Choose either --baseline or --baseline-report')
    if args.baseline_report:
        previous = json.loads(args.baseline_report.read_text())
        if previous.get('casesSha256') != cases_hash:
            raise ValueError('Baseline report uses different held-out cases')
        results['baseline'] = previous['results'].get('baseline') or previous['results']['candidate']
    for label, graph in [('baseline', args.baseline), ('candidate', args.graph)]:
        if graph:
            results[label] = evaluate(graph, cases['cases'], indexer, args.concurrency)
            print(json.dumps({'label': label, 'summary': results[label]['summary']}, ensure_ascii=False), flush=True)
    report = {'schemaVersion': 'resource-retrieval-evidence/1', 'casesSha256': cases_hash,
        'runtimeOverrides': {'semanticGuardDisabled': args.without_semantic_guard},
        'percentileMethod': 'nearest-rank; baseline report retains its recorded historical timing summary',
        'indexerSha256': hashlib.sha256(args.indexer.read_bytes()).hexdigest(), 'results': results,
        'limitations': [*cases['limitations'], 'Measures retrieval relevance, not module execution quality',
            'Warm concurrent timings are diagnostic; not a controlled speedup benchmark',
            'No LLM inference in this test: actual token usage cannot be claimed']}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'report': str(args.report), 'totalQueriesPerGraph': 2 * len(cases['cases'])}))


if __name__ == '__main__':
    main()
