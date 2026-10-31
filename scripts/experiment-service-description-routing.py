#!/usr/bin/env python3
"""Paired, offline service-description intervention; production stays untouched."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from contextvars import ContextVar
from copy import copy
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import statistics
import time

for key in ('HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE'):
    os.environ[key] = '1'
for key in ('OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'OPENBLAS_NUM_THREADS'):
    os.environ[key] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
ROOT = Path(__file__).resolve().parents[1]


def module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--graph', type=Path, default=Path.home() / '.codex/skill-registry/skills.graph.json')
    parser.add_argument('--baseline-indexer', type=Path, required=True,
        help='Exact prior worker source; the installed runtime is no longer an old baseline after deployment')
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--concurrency', type=int, default=4, choices=range(1, 9))
    parser.add_argument('--bounded-fusion', action='store_true',
        help='Diagnostic: enforce the existing guarded prefilter pool at fusion, as the Chinese channel does')
    args = parser.parse_args()
    source = ROOT / 'codex-profile/mac/hooks/graph_skill_index.py'
    cases_files = [ROOT / 'scripts/resource-intent-routing-cases.json', *[
        ROOT / f'scripts/resource-retrieval-{name}.json' for name in ('holdout', 'validation', 'unseen')]]
    frozen = {str(p): sha(p) for p in [args.graph, args.baseline_indexer, source, *cases_files]}
    old = module(args.baseline_indexer, 'old_description_runtime')
    new = module(source, 'new_description_runtime')
    began = time.perf_counter()
    worker = old._GraphWorker(args.graph)
    worker._load_if_stale()
    baseline = worker._english_graph
    candidate = new.english_retrieval_graph(worker._graph)
    old_engine = baseline._get_retrieval_engine()
    new_engine = candidate._get_retrieval_engine()
    changed = [name for name in candidate.tools if candidate.tools[name].description != baseline.tools[name].description]
    if not changed:
        parser.error('Baseline already uses the candidate service descriptions; no valid intervention to measure')
    assert all(candidate.tools[name].metadata.get('kind') == 'mcp-service' for name in changed)
    # Re-encode only changed service descriptions/tool texts. Static vectors for
    # all other nodes remain byte-for-byte the baseline's. No graph files change.
    index = copy(old_engine._embedding_index._index)
    index._embeddings = dict(index._embeddings)
    provider = old_engine._embedding_index._provider
    descriptions = list(dict.fromkeys(candidate.tools[name].description for name in changed))
    tool_texts = [index._tool_text(candidate.tools[name]) for name in changed]
    texts = list(dict.fromkeys([*descriptions, *tool_texts]))
    missing = [text for text in texts if text not in provider._precomputed]
    extra = dict(zip(missing, provider._provider.encode_batch(missing)))
    cache = {**provider._precomputed, **extra}
    for name, text in zip(changed, tool_texts):
        index.add(name, cache[text])
    index._provider = new._CachedEmbeddingProvider(provider._provider, cache)
    new_engine.set_embedding_index(new._SerializedEmbeddingIndex(index))
    new.prepare_sparse_bm25(new_engine)
    new.prepare_semantic_candidate_guard(new_engine)
    new.prepare_service_identity_routing(new_engine)
    if args.bounded_fusion:
        pool_context = ContextVar('experiment_english_pool', default=None)
        original_pool, original_fuse = new_engine._maybe_prefilter, new_engine._fuse_and_filter
        def maybe_pool(*positional, **keywords):
            pool = original_pool(*positional, **keywords)
            pool_context.set(pool)
            return pool
        def fuse(sources):
            pool = pool_context.get()
            if pool is not None:
                sources = [({name: score for name, score in scores.items() if name in pool}, weight)
                    for scores, weight in sources]
            return original_fuse(sources)
        new_engine._maybe_prefilter, new_engine._fuse_and_filter = maybe_pool, fuse
    candidate.retrieve_with_scores('warm library documentation and capabilities', top_k=8, max_graph_depth=2)
    print(json.dumps({'phase': 'ready', 'changedServices': len(changed),
        'newCachedTexts': len(missing), 'startupSeconds': time.perf_counter() - began}), flush=True)
    tasks = []
    for path in cases_files:
        for case in json.loads(path.read_text())['cases']:
            tasks.append({**case, 'set': 'intent' if path == cases_files[0] else path.stem})

    def run(case, variant):
        channel = baseline if variant == 'baseline' else candidate
        started = time.perf_counter()
        records = new.result_records(channel.retrieve_with_scores(case['en'], top_k=8, max_graph_depth=2))
        elapsed = (time.perf_counter() - started) * 1000
        return {'ms': elapsed, 'rank': next((i + 1 for i, row in enumerate(records)
            if row['name'] in case['targets']), None), 'returned': records}

    rows = []
    # Independent immutable engines avoid per-query global monkey-patching. Only
    # ranking evidence uses concurrency; latency below has sequential pairing.
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = []
        for number, case in enumerate(tasks):
            order = ['baseline', 'candidate'] if number % 2 == 0 else ['candidate', 'baseline']
            futures.append((case, {variant: pool.submit(run, case, variant) for variant in order}))
        for case, pending in futures:
            row = {'id': case['id'], 'set': case['set'], 'query': case['en'], 'targets': case['targets'],
                'baseline': pending['baseline'].result(), 'candidate': pending['candidate'].result()}
            rows.append(row)
            print(json.dumps({'case': row['id'], 'oldRank': row['baseline']['rank'],
                'newRank': row['candidate']['rank']}), flush=True)
    timing = []
    for repeat in range(3):
        for number, case in enumerate(tasks[:12]):
            observation = {}
            order = ['baseline', 'candidate'] if (number + repeat) % 2 == 0 else ['candidate', 'baseline']
            for variant in order:
                engine = (baseline if variant == 'baseline' else candidate)._get_retrieval_engine()
                engine._embedding_index._cached_encode.cache_clear()
                engine._embedding_index._provider._vectors.clear()
                observation[variant] = run(case, variant)['ms']
            timing.append({'case': case['id'], 'repeat': repeat, **observation})
    summary = []
    for dataset in ['all', 'intent']:
        chosen = [row for row in rows if dataset == 'all' or row['set'] == dataset]
        for k in [4, 8]:
            hit = lambda row, variant: row[variant]['rank'] is not None and row[variant]['rank'] <= k
            summary.append({'set': dataset, 'k': k, 'n': len(chosen),
                'baseline': sum(hit(row, 'baseline') for row in chosen),
                'candidate': sum(hit(row, 'candidate') for row in chosen),
                'gains': [row['id'] for row in chosen if not hit(row, 'baseline') and hit(row, 'candidate')],
                'losses': [row['id'] for row in chosen if hit(row, 'baseline') and not hit(row, 'candidate')]})
    timing_summary = {}
    for variant in ['baseline', 'candidate']:
        values = sorted(row[variant] for row in timing)
        timing_summary[variant] = {'n': len(values), 'p50Ms': statistics.median(values),
            'p95Ms': values[math.ceil(.95 * len(values)) - 1]}
    assert all(sha(Path(path)) == value for path, value in frozen.items())
    report = {'schemaVersion': 'service-description-paired/1', 'frozenInputSha256': frozen,
        'productionChanged': False, 'boundedFusion': args.bounded_fusion,
        'experimentSha256': sha(Path(__file__)), 'changedServices': len(changed), 'newCachedTexts': len(missing),
        'changed': [{'name': candidate.tools[name].metadata.get('skill_name'),
            'before': baseline.tools[name].description, 'after': candidate.tools[name].description} for name in changed],
        'summary': summary, 'timing': timing, 'timingSummary': timing_summary, 'rows': rows,
        'limitations': ['English-only controlled intervention; Chinese graph and vectors are unchanged.',
            'Identity labels miss equivalent workflows and do not measure actual task accuracy.',
            'Timing is sequential paired warm retrieval, three repeats for twelve tasks, not whole-agent latency.',
            'No business tool, paid API or LLM task executes; no actual token-usage claim.']}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'phase': 'done', 'summary': summary, 'timingSummary': timing_summary}), flush=True)


if __name__ == '__main__':
    main()
