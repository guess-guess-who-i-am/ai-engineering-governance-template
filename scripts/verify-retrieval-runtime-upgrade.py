#!/usr/bin/env python3
"""Paired real-graph check: original runtime versus exact sparse + identity guard.

One immutable graph/model is shared, interventions alternate per request, result
and query-vector caches are cleared, and labels are used only after retrieval.
No production files, services, module bodies or credentials are changed.
"""
import argparse
from collections import defaultdict
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
for key in ('TOKENIZERS_PARALLELISM',):
    os.environ[key] = 'false'
for key in ('OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'OPENBLAS_NUM_THREADS'):
    os.environ[key] = '1'
ROOT = Path(__file__).resolve().parents[1]


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def module(file, name):
    spec = importlib.util.spec_from_file_location(name, file)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-indexer', type=Path, default=Path.home() / '.codex/hooks/graph_skill_index.py')
    parser.add_argument('--candidate-indexer', type=Path, default=ROOT / 'codex-profile/mac/hooks/graph_skill_index.py')
    parser.add_argument('--graph', type=Path, default=Path.home() / '.codex/skill-registry/skills.graph.json')
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--ranking-report', type=Path, help='Reuse verified rankings from identical frozen inputs; keep the first report')
    parser.add_argument('--timing-repeats', type=int, default=3, choices=range(3, 21))
    args = parser.parse_args()
    files = [args.baseline_indexer, args.candidate_indexer, args.graph]
    tasks = []
    for dataset in ('holdout', 'validation', 'unseen', 'identity-challenge'):
        file = ROOT / f'scripts/resource-retrieval-{dataset}.json'
        files.append(file)
        data = json.loads(file.read_text())
        for case in data['cases']:
            for lang in ('en', 'zh'):
                tasks.append({**case, 'set': dataset, 'language': lang, 'query': case[lang]})
    legacy_file = ROOT / '.reports/legacy-resource-route-comparison.json'
    files.append(legacy_file)
    for case in json.loads(legacy_file.read_text())['cases']:
        for lang in ('en', 'zh'):
            if lang in case:
                tasks.append({**case, 'set': 'legacy', 'language': lang, 'query': case[lang]})
    frozen = {str(file): digest(file) for file in files}
    reused = None
    if args.ranking_report:
        if args.ranking_report.resolve() == args.report.resolve():
            parser.error('Timing recheck must preserve the first report')
        reused = json.loads(args.ranking_report.read_text())
        if reused.get('frozenInputSha256') != frozen or not reused.get('passed'):
            parser.error('Ranking report is not passing evidence for these exact inputs')
    old = module(args.baseline_indexer, 'old_runtime')
    new = module(args.candidate_indexer, 'new_runtime')
    start = time.perf_counter()
    worker = old._GraphWorker(args.graph)
    worker._load_if_stale()
    engines = {'en': worker._english_graph._get_retrieval_engine(), 'zh': worker._graph._get_retrieval_engine()}
    baseline, candidate = {}, {}
    for lang, engine in engines.items():
        baseline[lang] = (engine._get_bm25().score, engine._post_process)
        if lang == 'en':
            new.prepare_sparse_bm25(engine)
        new.prepare_service_identity_routing(engine)
        candidate[lang] = (engine._get_bm25().score, engine._post_process)
    startup = time.perf_counter() - start
    rows = []
    print(json.dumps({'phase': 'ready', 'n': len(tasks), 'startupSeconds': startup}), flush=True)

    def run(task, variant):
        for lang, engine in engines.items():
            engine._get_bm25().score, engine._post_process = (baseline if variant == 'baseline' else candidate)[lang]
            engine._embedding_index._cached_encode.cache_clear()
            engine._embedding_index._provider._vectors.clear()
        worker._results.clear()
        # Cached interpretation is cheap but should not privilege the second arm.
        from graph_tool_call.retrieval import semantic_scorer
        from graph_tool_call.retrieval.keyword import BM25Scorer
        for owner in (semantic_scorer, BM25Scorer):
            for attr in dir(owner):
                fn = getattr(owner, attr)
                if callable(fn) and hasattr(fn, 'cache_clear') and attr != 'semantic_terms':
                    fn.cache_clear()
        before = time.perf_counter()
        records = worker.query({'query': task['query'], 'top_k': 8})
        ms = (time.perf_counter() - before) * 1000
        ranked = [{'name': row['name'], 'kind': row.get('kind', 'skill'), 'path': row.get('path'),
                   'moduleId': row.get('module_id'), 'score': row['score']} for row in records]
        rank = next((i + 1 for i, row in enumerate(ranked)
            if row['kind'] == task.get('kind') and row['name'] in task.get('targets', [])), None)
        return {'variant': variant, 'ms': ms, 'rank': rank, 'returned': ranked}

    for number, task in enumerate([] if reused else tasks):
        observed = {}
        order = ['baseline', 'candidate'] if number % 2 == 0 else ['candidate', 'baseline']
        for variant in order:
            observed[variant] = run(task, variant)
        engine = engines[task['language']]
        identifier = engine._codex_service_identity_match(task['query'])
        matched = engine._tools[identifier].metadata['skill_name'].casefold() if identifier else None
        row = {key: task[key] for key in ('id', 'set', 'language', 'query')}
        row.update(expected=task.get('targets', []), kind=task.get('kind'), identityMatch=matched,
                   exactEqual=observed['baseline']['returned'] == observed['candidate']['returned'], results=observed)
        if 'expectedGuard' in task:
            row['guardCorrect'] = matched == task['expectedGuard']
        if matched is None and not row['exactEqual']:
            raise AssertionError(f'Unintended ranking/score change: {row["set"]}/{row["id"]}/{row["language"]}')
        rows.append(row)
        if (number + 1) % 20 == 0:
            print(json.dumps({'phase': 'rankings', 'done': number + 1, 'total': len(tasks)}), flush=True)

    if reused:
        rows = reused['rows']
        if {(row['set'], row['id'], row['language']) for row in rows} != {(task['set'], task['id'], task['language']) for task in tasks}:
            raise AssertionError('Reused query identities differ')

    # A separate repeated subset estimates latency; rank scan above is not
    # presented as a statistically convincing universal speedup experiment.
    timing_tasks = [task for task in tasks if task['set'] == 'legacy'][:8]
    timing_tasks += [task for task in tasks if task['set'] == 'validation' and task['id'] in ('research-evidence', 'workspace-notes')]
    timings = []
    for repeat in range(args.timing_repeats):
        for number, task in enumerate(timing_tasks):
            for variant in (['baseline', 'candidate'] if (number + repeat) % 2 == 0 else ['candidate', 'baseline']):
                result = run(task, variant)
                timings.append({'id': task['id'], 'language': task['language'], 'repeat': repeat, 'variant': variant, 'ms': result['ms']})
        print(json.dumps({'phase': 'timing', 'repeat': repeat + 1}), flush=True)
    summary = []
    for dataset in ('all-labelled', 'holdout', 'validation', 'unseen', 'identity-challenge', 'legacy'):
        chosen = [row for row in rows if row['kind'] and (dataset == 'all-labelled' or row['set'] == dataset)]
        for variant in ('baseline', 'candidate'):
            hit = lambda row, n: row['results'][variant]['rank'] is not None and row['results'][variant]['rank'] <= n
            summary.append({'set': dataset, 'variant': variant, 'n': len(chosen),
                'top4': sum(hit(row, 4) for row in chosen), 'top8': sum(hit(row, 8) for row in chosen)})
    timing_summary = []
    for lang in ('en', 'zh'):
        for variant in ('baseline', 'candidate'):
            values = [row['ms'] for row in timings if row['variant'] == variant and row['language'] == lang]
            timing_summary.append({'language': lang, 'variant': variant, 'n': len(values), 'p50Ms': statistics.median(values),
                'p95Ms': sorted(values)[math.ceil(len(values) * .95) - 1]})
    losses = {str(n): [f'{row["set"]}/{row["id"]}/{row["language"]}' for row in rows
        if row['kind'] and row['results']['baseline']['rank'] is not None and row['results']['baseline']['rank'] <= n
        and (row['results']['candidate']['rank'] is None or row['results']['candidate']['rank'] > n)] for n in (4, 8)}
    unchanged = all(digest(Path(file)) == sha for file, sha in frozen.items())
    assert unchanged
    passed = all(row.get('guardCorrect', True) for row in rows) and not any(losses.values())
    report = {'schemaVersion': 'resource-retrieval-runtime-upgrade/1', 'frozenInputSha256': frozen,
        'scriptSha256': digest(Path(__file__)),
        'rankingEvidenceReused': {'path': str(args.ranking_report), 'sha256': digest(args.ranking_report)} if reused else None,
        'inputsUnchanged': unchanged, 'productionChanged': False, 'startupSeconds': startup, 'rows': rows,
        'summary': summary, 'losses': losses, 'timings': timings, 'timingSummary': timing_summary, 'passed': passed,
        'tokens': {'llmCalls': 0, 'measured': False},
        'limitations': ['Prior 80 diagnostic queries are development data, not independent held-out evidence',
            'Fresh challenge is targeted at explicit service identity, not broad generalization',
            'Exact-name recall is a proxy; equivalent workflows can be useful despite a missed label',
            'Timings are sequential warm process API with cold query/result caches; exclude Hook/network and model startup',
            f'{args.timing_repeats} alternating repeats on {len(timing_tasks)} requests, not a broad throughput/100-concurrency claim',
            'Graph expansion cache retained equally; no business MCP execution or task success is measured']}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'report': str(args.report), 'summary': summary, 'timingSummary': timing_summary,
        'losses': losses, 'passed': passed}), flush=True)
    if not passed:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
