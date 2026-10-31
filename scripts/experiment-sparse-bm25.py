#!/usr/bin/env python3
"""Isolated exact sparse-postings BM25 experiment; never edits a graph/runtime."""
import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import statistics
import sys
import time

os.environ.setdefault('HF_HUB_OFFLINE', '1')
os.environ.setdefault('TRANSFORMERS_OFFLINE', '1')
os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')
os.environ.setdefault('OMP_NUM_THREADS', '1')
ROOT = Path(__file__).resolve().parents[1]
ENTRY = ROOT / 'codex-profile/mac/hooks/graph_skill_index.py'


def sparse_score(bm25):
    """Pure replacement for score(), including original arithmetic/boost order."""
    import numpy as np
    names = list(bm25._tool_tokens)
    postings = {}
    for index, name in enumerate(names):
        length = bm25._doc_lens[name]
        for term, frequency in bm25._tf_maps[name].items():
            df = bm25._doc_freqs[term]
            idf = math.log((bm25._n_docs - df + 0.5) / (df + 0.5) + 1.0)
            numerator = frequency * (bm25._k1 + 1.0)
            denominator = frequency + bm25._k1 * (1.0 - bm25._b + bm25._b * length / bm25._avg_dl)
            # Preserve upstream parentheses. (idf * tf) * (k1 + 1) can differ.
            contribution = idf * numerator / denominator
            postings.setdefault(term, []).append((index, contribution))
    postings = {term: (np.fromiter((i for i, _ in rows), dtype=np.int32),
                       np.fromiter((value for _, value in rows), dtype=np.float64))
                for term, rows in postings.items()}

    def score(query, *, restrict=None):
        raw = bm25._tokenize_fn(query)
        if not raw:
            return {}
        filtered = [term for term in raw if term not in bm25._stopwords]
        terms = bm25._expand_query_tokens(filtered or raw, query)
        values = np.zeros(len(names), dtype=np.float64)
        for term in terms:  # Preserve repeated terms and original addition order.
            entry = postings.get(term)
            if entry is not None:
                indices, contribution = entry
                values[indices] += contribution
        scores = {}
        for index in np.flatnonzero(values > 0):
            name = names[index]
            if restrict is not None and name not in restrict:
                continue
            value = float(values[index])
            length = bm25._name_token_counts.get(name, 0)
            if length > 6:
                value *= 1.0 / (1.0 + 0.15 * (length - 6))
            value *= bm25._name_subsequence_boost(terms, name)
            value *= bm25._semantic_phrase_boost(query, name, bm25._tools[name])
            scores[name] = value
        return scores

    score.postings_count = sum(len(indices) for indices, _ in postings.values())
    score.postings_bytes = sum(indices.nbytes + values.nbytes for indices, values in postings.values())
    return score


QUERIES = [
    ('en', 'citation', 'Find papers, verify citations and format BibTeX references'),
    ('en', 'repeat', 'search search files files debugging performance performance'),
    ('en', 'phrase', 'calculate hypotenuse and the area under the curve'),
    ('en', 'negative', 'zzzznonexistentqqqq 9x8v7w6'),
    ('en', 'stopwords', 'the and for a'),
    ('en', 'empty', ''),
    ('en', 'long', 'Investigate Python worker concurrency performance regression. Measure function-level latency, locate the root cause, preserve independent agent changes, and verify the result against existing tests. ' * 3),
    ('zh', 'citation', '查找论文，核验引用，规范BibTeX参考文献'),
    ('zh', 'repeat', '搜索搜索文件文件 根因根因 并发并发'),
    ('zh', 'mixed', '计算hypotenuse，检查Python并发；不要修改原始文件'),
    ('zh', 'negative', '龘龘靐靐齉齉 zzzznonexistentqqqq'),
    ('zh', 'long', '分析并发任务的超时和排队原因，测量每个函数，查明worker加载、候选预过滤、embedding和图排序各自耗时。保留原始目标与约束，不编造完成证据。' * 3),
]


def exact_compare(original, candidate):
    keys = set(original) | set(candidate)
    differences = [key for key in keys if original.get(key) != candidate.get(key)]
    return {'equal': not differences, 'keysEqual': set(original) == set(candidate), 'differingValues': len(differences),
            'maxAbsoluteError': max((abs(original.get(key, 0) - candidate.get(key, 0)) for key in keys), default=0),
            'firstDifferences': [{ 'name': key, 'original': original.get(key), 'sparse': candidate.get(key) } for key in sorted(differences)[:3]]}


def top(scores):
    from graph_tool_call.retrieval.ranking import stable_score_items
    return [{'name': name, 'score': score} for name, score in stable_score_items(scores)[:8]]


def median(values):
    return round(statistics.median(values), 4)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--graph', type=Path, default=Path.home() / '.codex/skill-registry/skills.graph.json')
    parser.add_argument('--report', type=Path, default=ROOT / '.reports/resource-integration/sparse-bm25.json')
    parser.add_argument('--rounds', type=int, default=3)
    parser.add_argument('--full-retrieval', action='store_true')
    parser.add_argument('--full-cases', default='citation,long', help='Comma-separated case names for whole-retrieval timing; lexical equality still covers all cases')
    parser.add_argument('--production-helper', action='store_true', help='Use prepare_sparse_bm25 from the current indexer rather than the isolated candidate factory')
    args = parser.parse_args()
    if args.rounds < 3:
        parser.error('At least three alternating rounds are required')
    from graph_tool_call import ToolGraph
    from graph_tool_call.retrieval.keyword import BM25Scorer
    spec = importlib.util.spec_from_file_location('bm25_experiment_indexer', ENTRY)
    indexer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(indexer)
    indexer._cache_query_interpretation()
    started = time.perf_counter()
    worker = None
    if args.full_retrieval:
        worker = indexer._GraphWorker(args.graph)
        with worker._condition:
            graph = worker._load_if_stale()
        english = worker._english_graph
    else:
        graph = ToolGraph.load(args.graph)
        graph.set_tokenizer(indexer.chinese_tokenize)
        graph.tune_for_scale()
        english = indexer.english_retrieval_graph(graph)
    load_ms = (time.perf_counter() - started) * 1000
    channels = {'en': english, 'zh': graph}
    bm25s = {language: channel._get_retrieval_engine()._get_bm25() for language, channel in channels.items()}
    candidates, build_ms = {}, {}
    for language, bm25 in bm25s.items():
        start = time.perf_counter()
        if args.production_helper:
            indexer.prepare_sparse_bm25(channels[language]._get_retrieval_engine())
            candidates[language] = bm25.score
        else:
            candidates[language] = sparse_score(bm25)
        build_ms[language] = (time.perf_counter() - start) * 1000
    report = {'schemaVersion': 'sparse-bm25-experiment/1', 'graph': str(args.graph),
        'graphSha256': hashlib.sha256(args.graph.read_bytes()).hexdigest(),
        'indexerSha256': hashlib.sha256(ENTRY.read_bytes()).hexdigest(),
        'toolCount': len(graph.tools), 'loadMs': round(load_ms, 3), 'rounds': args.rounds,
        'implementation': 'production-helper' if args.production_helper else 'isolated-candidate',
        'scope': 'Only BM25.score is swapped; no candidate-pool/fusion/ranking modification. Worker query-result cache is bypassed. Warm embedding-vector caches are retained in full mode.',
        'productionChanged': False, 'postings': {language: {'buildMs': round(build_ms[language], 3),
            'entries': getattr(candidates[language], 'postings_count', None), 'arrayBytes': getattr(candidates[language], 'postings_bytes', None)} for language in channels},
        'cases': []}
    for query_index, (language, case, query) in enumerate(QUERIES):
        bm25, candidate = bm25s[language], candidates[language]
        original = lambda query, **kwargs: BM25Scorer.score(bm25, query, **kwargs)
        # Warm both implementations. No score/query-result memoization is used.
        original(query); candidate(query)
        measurements = {'original': [], 'sparse': []}
        baseline = original(query); result = candidate(query)
        equivalence = exact_compare(baseline, result)
        restrictions = {}
        for label, restrict in [('empty', set()), ('prefix', set(list(bm25._tool_tokens)[:37])), ('hits', set(list(baseline)[:12]))]:
            restrictions[label] = exact_compare(original(query, restrict=restrict), candidate(query, restrict=restrict))
        for iteration in range(args.rounds):
            order = ['original', 'sparse'] if (iteration + query_index) % 2 == 0 else ['sparse', 'original']
            for variant in order:
                start = time.perf_counter(); measured = original(query) if variant == 'original' else candidate(query)
                measurements[variant].append((time.perf_counter() - start) * 1000)
                if not exact_compare(baseline, measured)['equal']:
                    raise AssertionError(f'Unstable exact scores: {language}/{case}/{variant}')
        row = {'language': language, 'case': case, 'query': query, 'matchedDocuments': len(baseline),
            'equivalence': equivalence, 'restrictEquivalence': restrictions, 'top8Equal': top(baseline) == top(result),
            'top8': top(result), 'milliseconds': measurements,
            'medianMs': {name: median(values) for name, values in measurements.items()}}
        row['speedup'] = round(statistics.median(measurements['original']) / max(statistics.median(measurements['sparse']), 1e-9), 3)
        if args.full_retrieval and query and case in args.full_cases.split(','):
            channel = channels[language]
            original_score = bm25.score
            variants = {'original': original, 'sparse': candidate}
            observed, retrieval_ms = {}, {'original': [], 'sparse': []}
            try:
                # One real warm retrieval per query/variant; excludes lazy state.
                for name, score in variants.items():
                    bm25.score = score
                    observed[name] = [(r.tool.name, float(r.score)) for r in channel.retrieve_with_scores(query, top_k=8, max_graph_depth=2)]
                for iteration in range(args.rounds):
                    order = ['original', 'sparse'] if (iteration + query_index) % 2 == 0 else ['sparse', 'original']
                    for variant in order:
                        bm25.score = variants[variant]; start = time.perf_counter()
                        values = [(r.tool.name, float(r.score)) for r in channel.retrieve_with_scores(query, top_k=8, max_graph_depth=2)]
                        retrieval_ms[variant].append((time.perf_counter() - start) * 1000)
                        if values != observed[variant]:
                            raise AssertionError(f'Unstable retrieval: {language}/{case}/{variant}')
            finally:
                bm25.score = original_score
            row['retrieval'] = {'top8ExactEqual': observed['original'] == observed['sparse'], 'results': observed,
                'milliseconds': retrieval_ms, 'medianMs': {name: median(values) for name, values in retrieval_ms.items()}}
            row['retrieval']['speedup'] = round(statistics.median(retrieval_ms['original']) / max(statistics.median(retrieval_ms['sparse']), 1e-9), 3)
        report['cases'].append(row)
        print(json.dumps({'language': language, 'case': case, 'exact': equivalence['equal'], 'medianMs': row['medianMs'], 'speedup': row['speedup'], 'retrieval': row.get('retrieval', {}).get('medianMs')}, ensure_ascii=False), flush=True)
    report['allExactEqual'] = all(row['equivalence']['equal'] and row['top8Equal'] and all(result['equal'] for result in row['restrictEquivalence'].values()) and row.get('retrieval', {}).get('top8ExactEqual', True) for row in report['cases'])
    report['summary'] = {}
    for language in channels:
        rows = [row for row in report['cases'] if row['language'] == language]
        report['summary'][language] = { 'medianOriginalMs': median([value for row in rows for value in row['milliseconds']['original']]),
            'medianSparseMs': median([value for row in rows for value in row['milliseconds']['sparse']]),
            'medianCaseSpeedup': median([row['speedup'] for row in rows]) }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'report': str(args.report), 'toolCount': report['toolCount'], 'allExactEqual': report['allExactEqual'], 'summary': report['summary']}, ensure_ascii=False), flush=True)
    if not report['allExactEqual']:
        sys.exit(1)


if __name__ == '__main__':
    main()
