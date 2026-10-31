#!/usr/bin/env python3
"""Verify a rebuilt candidate against frozen, same-budget production rankings."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import time

for key in ('HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE'):
    os.environ[key] = '1'
for key in ('OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'OPENBLAS_NUM_THREADS'):
    os.environ[key] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', type=Path, required=True)
    parser.add_argument('--baseline-report', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    production = Path.home() / '.codex/skill-registry/skills.graph.json'
    old = json.loads(args.baseline_report.read_text())
    assert old['schemaVersion'] == 'intent-recommendation-paired/1'
    assert old['frozenInputSha256'][str(production)] == sha(production), 'Baseline graph changed'
    for file, expected in old['frozenInputSha256'].items():
        if Path(file).name.startswith('resource-'):
            assert sha(Path(file)) == expected, 'Frozen cases changed'
    graph = args.stage / 'skills.graph.json'
    indexer = args.stage / 'hooks/graph_skill_index.py'
    frozen = {str(p): sha(p) for p in [graph, indexer, args.baseline_report, production]}
    spec = importlib.util.spec_from_file_location('candidate_worker', indexer)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    worker = module._GraphWorker(graph)
    began = time.perf_counter()
    worker._load_if_stale()
    print(json.dumps({'phase': 'ready', 'startupSeconds': time.perf_counter() - began}), flush=True)
    def run(task):
        started = time.perf_counter()
        records = worker.query({'query': task['query'], 'top_k': 8})
        assert records and len(records) <= 8
        hit = lambda values: any(row['name'] in task['targets'] for row in values)
        baseline = task['results']['baseline']['returned']
        return {'set': task['set'], 'id': task['id'], 'language': task['language'],
            'query': task['query'], 'targets': task['targets'],
            'baseline': {'top4': hit(baseline[:4]), 'top8': hit(baseline), 'returned': baseline},
            'candidate': {'top4': hit(records[:4]), 'top8': hit(records), 'returned': records},
            'msWithQueueing': (time.perf_counter() - started) * 1000,
            'sameNames': [r['name'] for r in baseline] == [r['name'] for r in records]}
    with ThreadPoolExecutor(max_workers=8) as pool:
        rows = list(pool.map(run, old['rows']))
    summary = []
    for dataset in ['all', 'intent']:
        for lang in ['all', 'en', 'zh']:
            chosen = [r for r in rows if (dataset == 'all' or r['set'] == dataset)
                and (lang == 'all' or r['language'] == lang)]
            for key in ['top4', 'top8']:
                identify = lambda r: f"{r['set']}:{r['id']}:{r['language']}"
                summary.append({'set': dataset, 'language': lang, 'metric': key, 'n': len(chosen),
                    'baseline': sum(r['baseline'][key] for r in chosen),
                    'candidate': sum(r['candidate'][key] for r in chosen),
                    'gains': [identify(r) for r in chosen if not r['baseline'][key] and r['candidate'][key]],
                    'losses': [identify(r) for r in chosen if r['baseline'][key] and not r['candidate'][key]]})
    assert all(sha(Path(p)) == expected for p, expected in frozen.items())
    zh_unchanged = all(r['sameNames'] for r in rows if r['language'] == 'zh')
    no_loss = all(not r['losses'] for r in summary)
    report = {'schemaVersion': 'task-content-candidate/1', 'frozenInputSha256': frozen,
        'productionChanged': False, 'noLabelRecallLoss': no_loss, 'chineseRankingsUnchanged': zh_unchanged,
        'nodeCount': len(worker._graph.tools), 'summary': summary, 'rows': rows,
        'limitations': ['Previously measured baseline rankings reused only after verifying graph and case hashes.',
            'Identity recall is a proxy: equivalent modules and action coverage need separate review.',
            'Eight-thread queued timings are not a controlled latency comparison or whole-agent timing.',
            'No paid API, LLM task or business tool executes.']}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'phase': 'done', 'noLabelRecallLoss': no_loss,
        'chineseRankingsUnchanged': zh_unchanged, 'summary': summary}), flush=True)
    if not no_loss or not zh_unchanged:
        raise SystemExit('Candidate failed frozen recall or unchanged-Chinese gate; see report')


if __name__ == '__main__':
    main()
