#!/usr/bin/env python3
"""Frozen, isolated direct-retrieval ablation; never edits production resources."""
import argparse
from collections import defaultdict
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
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
for key in ('OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'OPENBLAS_NUM_THREADS'):
    os.environ[key] = '1'
ROOT = Path(__file__).resolve().parents[1]
CODEX_HOME = Path.home() / '.codex'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def percentile(values, p):
    return sorted(values)[max(0, math.ceil(len(values) * p) - 1)]


def raw_bm25(index, ids):
    """Standard BM25 on the existing immutable corpus; no intent/name bonuses."""
    import numpy as np
    postings = defaultdict(list)
    for i, name in enumerate(ids):
        for term, tf in index._tf_maps[name].items():
            df = index._doc_freqs[term]
            idf = math.log((index._n_docs - df + .5) / (df + .5) + 1)
            value = idf * (tf * (index._k1 + 1)) / (tf + index._k1 *
                (1 - index._b + index._b * index._doc_lens[name] / index._avg_dl))
            postings[term].append((i, value))
    postings = {term: (np.asarray([i for i, _ in rows], dtype=np.int32),
                       np.asarray([value for _, value in rows], dtype=np.float64))
                for term, rows in postings.items()}

    def score(query):
        raw = index._tokenize_fn(query)
        terms = [term for term in raw if term not in index._stopwords] or raw
        values = np.zeros(len(ids), dtype=np.float64)
        for term in terms:  # Repeated query terms retain their ordinary weight.
            if term in postings:
                positions, additions = postings[term]
                values[positions] += additions
        return values
    return score


def normalize(matrix):
    import numpy as np
    matrix = np.asarray(matrix, dtype=np.float32)
    assert matrix.ndim == 2 and matrix.shape[1] == 384 and np.isfinite(matrix).all()
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    assert (norms > 0).all()
    return matrix / norms


def ordered(values, positive_only=False):
    import numpy as np
    # Stable ID order resolves ties; never compare target names or resource types.
    order = np.argsort(-values, kind='stable')
    return order[values[order] > 0] if positive_only else order


def rrf(first, second, n):
    import numpy as np
    scores = np.zeros(n, dtype=np.float64)
    for ranks in (first, second):
        scores[ranks] += 1 / (60 + np.arange(1, len(ranks) + 1))
    return ordered(scores)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--graph', type=Path, default=CODEX_HOME / 'skill-registry/skills.graph.json')
    parser.add_argument('--indexer', type=Path, default=CODEX_HOME / 'hooks/graph_skill_index.py')
    parser.add_argument('--report', type=Path, default=ROOT / '.reports/resource-direct-retrieval.json')
    parser.add_argument('--repeats', type=int, default=2)
    parser.add_argument('--expert-challenge', type=Path,
        help='Optionally include the frozen name-free expert/Skill/MCP challenge set.')
    args = parser.parse_args()
    sets = {name: ROOT / f'scripts/resource-retrieval-{name}.json'
            for name in ('holdout', 'validation', 'unseen')}
    frozen_paths = [args.graph, args.indexer, *sets.values()]
    if args.expert_challenge:
        frozen_paths.append(args.expert_challenge)
    frozen = {str(path): digest(path) for path in frozen_paths}
    tasks = []
    limitations = []
    for name, path in sets.items():
        data = json.loads(path.read_text())
        limitations += data.get('limitations', [])
        for case in data['cases']:
            for language in ('en', 'zh'):
                tasks.append({'set': name, 'case': case['id'], 'kind': case['kind'],
                    'language': language, 'query': case[language], 'targets': case['targets']})
    if args.expert_challenge:
        challenge = json.loads(args.expert_challenge.read_text())
        limitations += challenge.get('limitations', [])
        split_kind = {'expert-required': 'expert', 'bounded-skill': 'skill', 'bounded-tool': 'mcp-service'}
        for case in challenge['cases']:
            kind = split_kind[case['split']]
            for language in ('en', 'zh'):
                tasks.append({'set': 'expert-challenge', 'case': case['id'], 'kind': kind,
                    'language': language, 'query': case[language], 'targets': case['targets']})
    assert len(tasks) == 80 + (2 * len(challenge['cases']) if args.expert_challenge else 0)
    spec = importlib.util.spec_from_file_location('isolated_direct_indexer', args.indexer)
    indexer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(indexer)
    original_records = indexer.result_records
    def retain_worker_ids(results):
        results = list(results)
        records = original_records(results)
        for record, result in zip(records, results):
            record['id'] = result.tool.name
        return records
    indexer.result_records = retain_worker_ids  # Observation only, no ranking change.
    began = time.perf_counter()
    worker = indexer._GraphWorker(args.graph)
    worker._load_if_stale()
    startup = time.perf_counter() - began
    import numpy as np
    channels = {'en': worker._english_graph, 'zh': worker._graph}
    ids = sorted(worker._graph.tools)
    engines = {language: channel._get_retrieval_engine() for language, channel in channels.items()}
    matrices, descriptions, scorers, providers = {}, {}, {}, {}
    began = time.perf_counter()
    for language, channel in channels.items():
        engine = engines[language]
        idx = engine._embedding_index
        assert set(ids) == set(idx._embeddings)
        matrices[language] = normalize([idx._embeddings[name] for name in ids])
        cached = idx._provider._precomputed
        missing = [name for name in ids if channel.tools[name].description not in cached]
        if missing:
            raise ValueError(f'{language}: missing description vectors for {len(missing)} nodes')
        descriptions[language] = normalize([cached[channel.tools[name].description] for name in ids])
        providers[language] = idx._provider._provider  # Bypass query-vector cache entirely.
        scorers[language] = raw_bm25(engine._get_bm25(), ids)
    for config in worker._graph.metadata.get('description_embeddings', {}).values():
        path = args.graph.parent / config['file']
        frozen[str(path)] = digest(path)
    config = worker._graph.metadata['chinese_embedding']
    path = args.graph.parent / config['file']
    frozen[str(path)] = digest(path)
    preparation = time.perf_counter() - began
    metadata = {name: {'id': name, 'name': (channels['zh'].tools[name].metadata or {}).get('skill_name',
        (channels['zh'].tools[name].metadata or {}).get('mcp_original_name', channels['zh'].tools[name].name)),
        'kind': (channels['zh'].tools[name].metadata or {}).get('kind', 'skill'),
        'module_id': (channels['zh'].tools[name].metadata or {}).get('module_id')} for name in ids}
    variants = ['worker', 'bm25_selected', 'tool_selected', 'tool_multilingual',
        'description_selected', 'description_multilingual', 'rrf_bm25_tool_selected',
        'rrf_bm25_description_selected', 'rrf_bm25_description_multilingual']
    # Warm every native scoring path using prompts absent from all frozen cases.
    for lang, query in [('en', 'warm immutable vector and lexical indexes before measurement'),
                        ('zh', '测量前预热固定向量与词法索引')]:
        vector = normalize([providers[lang].encode(query)])[0]
        for matrix in (matrices[lang], descriptions[lang]):
            ordered(matrix @ vector)
        scorers[lang](query)
    rows = []
    rng = random.Random(20261024)
    tasks = list(tasks)
    rng.shuffle(tasks)
    print(json.dumps({'phase': 'prepared', 'queries': len(tasks), 'nodes': len(ids),
                      'startupSeconds': startup, 'preparationSeconds': preparation}), flush=True)
    for repeat in range(args.repeats):
        repeat_tasks = tasks[repeat:] + tasks[:repeat]
        for number, task in enumerate(repeat_tasks):
            order = list(variants)
            rng.shuffle(order)  # Counterbalanced independently of case language/kind.
            for variant in order:
                language, query = task['language'], task['query']
                encoding_ms = 0
                if variant == 'worker':
                    worker._results.clear()
                    for engine in engines.values():
                        engine._embedding_index._cached_encode.cache_clear()
                        engine._embedding_index._provider._vectors.clear()
                    # Query interpretation caches share no direct-baseline work.
                    from graph_tool_call.retrieval import semantic_scorer
                    from graph_tool_call.retrieval.keyword import BM25Scorer
                    for owner in (semantic_scorer, BM25Scorer):
                        for attr in dir(owner):
                            fn = getattr(owner, attr)
                            if callable(fn) and hasattr(fn, 'cache_clear') and attr != 'semantic_terms':
                                fn.cache_clear()
                    began = time.perf_counter()
                    result = worker.query({'query': query, 'top_k': 8})
                    elapsed = (time.perf_counter() - began) * 1000
                    returned = [{key: value for key, value in record.items()
                                 if key in ('id', 'name', 'kind', 'module_id', 'score')} for record in result]
                else:
                    began = time.perf_counter()
                    lexical = None
                    if variant == 'bm25_selected' or variant.startswith('rrf_'):
                        lexical = ordered(scorers[language](query), positive_only=True)
                    if variant == 'bm25_selected':
                        ranking = lexical
                    else:
                        model_language = 'zh' if variant.endswith('multilingual') else language
                        before_encoding = time.perf_counter()
                        vector = normalize([providers[model_language].encode(query)])[0]
                        encoding_ms = (time.perf_counter() - before_encoding) * 1000
                        source = descriptions if 'description' in variant else matrices
                        semantic = ordered(source[model_language] @ vector)
                        ranking = rrf(lexical, semantic, len(ids)) if variant.startswith('rrf_') else semantic
                    elapsed = (time.perf_counter() - began) * 1000
                    returned = [metadata[ids[int(i)]] for i in ranking[:8]]
                hits = [i + 1 for i, row in enumerate(returned)
                        if row['kind'] == task['kind'] and row['name'] in task['targets']]
                rows.append({**task, 'variant': variant, 'repeat': repeat,
                             'rank': min(hits) if hits else None, 'ms': elapsed,
                             'encodingMs': encoding_ms, 'returned': returned})
            if (number + 1) % 20 == 0:
                print(json.dumps({'phase': 'measurement', 'repeat': repeat,
                                  'completedQueries': number + 1}), flush=True)
    groups = defaultdict(list)
    for row in rows:
        for keys in [(row['variant'], 'all', 'all', 'all'),
                     (row['variant'], row['set'], 'all', 'all'),
                     (row['variant'], 'all', row['kind'], row['language']),
                     (row['variant'], row['set'], row['kind'], row['language'])]:
            groups[keys].append(row)
    summary = []
    for (variant, dataset, kind, language), selected in groups.items():
        first = [row for row in selected if row['repeat'] == 0]
        summary.append({'variant': variant, 'set': dataset, 'kind': kind, 'language': language,
            'n': len(first), 'top4': sum(row['rank'] is not None and row['rank'] <= 4 for row in first),
            'top8': sum(row['rank'] is not None for row in first),
            'timingsN': len(selected), 'p50Ms': statistics.median(row['ms'] for row in selected),
            'p95Ms': percentile([row['ms'] for row in selected], .95),
            'encodingP50Ms': statistics.median(row['encodingMs'] for row in selected)})
    first_rows = [row for row in rows if row['repeat'] == 0]
    case_key = lambda row: (row['set'], row['case'], row['language'])
    baseline = {case_key(row): row for row in first_rows if row['variant'] == 'worker'}
    comparisons = []
    for variant in variants:
        entry = {'variant': variant}
        selected = [row for row in first_rows if row['variant'] == variant]
        for cutoff in (4, 8):
            hit = lambda row: row['rank'] is not None and row['rank'] <= cutoff
            entry[f'gainsTop{cutoff}'] = [list(case_key(row)) for row in selected
                if hit(row) and not hit(baseline[case_key(row)])]
            entry[f'lossesTop{cutoff}'] = [list(case_key(row)) for row in selected
                if not hit(row) and hit(baseline[case_key(row)])]
        comparisons.append(entry)
    unchanged = all(digest(Path(path)) == before for path, before in frozen.items())
    assert unchanged, 'Production/case/sidecar input changed during the experiment'
    per_case = defaultdict(set)
    for row in rows:
        per_case[(row['set'], row['case'], row['language'], row['variant'])].add(
            json.dumps(row['returned'], sort_keys=True))
    stable_repeats = all(len(values) == 1 for values in per_case.values())
    report = {'schemaVersion': 'resource-direct-retrieval-evidence/1',
        'frozenInputSha256': frozen, 'inputUnchanged': unchanged,
        'startupSeconds': startup, 'preparationSeconds': preparation, 'nodeCount': len(ids),
        'repeats': args.repeats, 'stableRepeatedRankings': stable_repeats,
        'configuration': {'seed': 20261024, 'rrfK': 60, 'rrfCandidateDepth': 'all nodes / positive BM25 only',
            'bm25': 'existing corpus TF, k1/b/stopwords/tokenizer; no query expansion, boosts, MMR or prefilter',
            'tieBreak': 'stable exact node ID ascending', 'semantic': 'float32 L2-normalized cosine all nodes',
            'description': 'existing validated description-only sidecars, exact text matches, no new embeddings',
            'models': {lang: providers[lang].model_name for lang in providers},
            'timing': 'worker in-process API wall time; direct fresh query encoding plus full ranking wall time (final eight-record assembly excluded); randomized variant order; worker result/index/provider query caches explicitly cleared; static corpus semantic terms and graph expansion may stay warm; no transport time',
            'concurrency': 1, 'threadsPerModel': 1},
        'summary': summary, 'pairedComparisonsToWorker': comparisons, 'rows': rows,
        'limitations': list(dict.fromkeys(limitations + [
            'Top4/top8 measure supplied target-identity retrieval, not exhaustive relevance or task correctness.',
            'Frozen tests were used in earlier experiments; this is ablation, not a new unseen generalization claim.',
            'No business service calls, model download, paid API, token accounting or module edits.',
            'Existing persisted tool vectors include names and metadata; raw BM25 uses the existing corpus, which includes names/tags/parameter metadata; no explicit target/name/type bonuses.',
            'Global worker remains alive and other machine activity can influence wall times; sequential isolated requests measure latency, not 100-client throughput.',
            'Worker exact IDs are observed from result.tool.name before API serialization, with no ranking changes; all variants retain node versions without name deduplication.'
        ]))}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'report': str(args.report), 'inputUnchanged': unchanged,
                     'stableRepeatedRankings': stable_repeats,
                     'summary': [s for s in summary if s['set'] == s['kind'] == s['language'] == 'all']},
                     ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
