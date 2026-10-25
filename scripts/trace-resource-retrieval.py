#!/usr/bin/env python3
"""Observe unchanged ranking stages and isolated in-memory channel probes."""
import argparse
from copy import copy
import hashlib
import importlib.util
import inspect
import json
import os
from pathlib import Path
import time

os.environ.setdefault('HF_HUB_OFFLINE', '1')
os.environ.setdefault('TRANSFORMERS_OFFLINE', '1')
os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')
os.environ.setdefault('OMP_NUM_THREADS', '1')
os.environ.setdefault('MKL_NUM_THREADS', '1')
ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', required=True, type=Path)
    parser.add_argument('--retrieval-report', required=True, type=Path)
    parser.add_argument('--report', required=True, type=Path)
    parser.add_argument('--pool-probe-only', action='store_true')
    args = parser.parse_args()
    graph_path = args.stage / 'skills.graph.json'
    indexer_path = args.stage / 'hooks/graph_skill_index.py'
    spec = importlib.util.spec_from_file_location('traced_indexer', indexer_path)
    indexer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(indexer)
    from graph_tool_call.retrieval.ranking import stable_score_items
    source = json.loads(args.retrieval_report.read_text())
    cases_path = ROOT / 'scripts/resource-retrieval-holdout.json'
    if source['casesSha256'] != digest(cases_path):
        parser.error('Frozen cases differ from initial retrieval report')
    cases = json.loads(cases_path.read_text())['cases']
    by_id = {case['id']: case for case in cases}
    before = digest(graph_path)
    worker = indexer._GraphWorker(graph_path)
    worker._load_if_stale()
    tools = worker._graph.tools

    def identity(name):
        node = tools[name]
        return {'tool': name, 'name': node.metadata.get('skill_name', node.name),
            'kind': node.metadata.get('kind', 'skill'), 'moduleId': node.metadata.get('module_id')}

    def target_names(case):
        return [name for name in tools if identity(name)['name'] in case['targets']
            and identity(name)['kind'] == case['kind']]

    def summarize(scores, targets):
        ranked = stable_score_items(scores)
        ranks = {name: n + 1 for n, (name, _) in enumerate(ranked)}
        return {'count': len(scores), 'targets': [{**identity(name), 'rank': ranks.get(name),
            'score': scores.get(name)} for name in targets],
            'top8': [{**identity(name), 'score': score} for name, score in ranked[:8]]}

    def result_summary(results, case):
        target = set(target_names(case))
        return {'rank': next((n + 1 for n, result in enumerate(results) if result.tool.name in target), None),
            'top8': [{**identity(result.tool.name), 'score': result.score,
                'keywordScore': result.keyword_score, 'embeddingScore': result.embedding_score,
                'graphScore': result.graph_score, 'annotationScore': result.annotation_score,
                'semanticScore': result.semantic_score} for result in results]}

    if args.pool_probe_only:
        rows = []
        for row in source['results']['candidate']['rows']:
            if row['rank'] is not None and row['rank'] <= 4:
                continue
            case = by_id[row['case']]
            channel = worker._english_graph if row['language'] == 'en' else worker._graph
            engine = channel._get_retrieval_engine()
            targets = target_names(case)
            captured = {}
            original = engine._maybe_prefilter

            def pool_probe(*positional, **keywords):
                pool = original(*positional, **keywords)
                query = positional[0] if positional else keywords['effective_query']
                index = engine._embedding_index
                hits = index.search(index.encode(query), top_k=len(tools))
                ranks = {name: n + 1 for n, (name, _) in enumerate(hits)}
                similarities = dict(hits)
                captured.update({'poolCount': len(pool) if pool is not None else len(tools),
                    'targets': [{**identity(name), 'poolIncluded': pool is None or name in pool,
                        'globalEmbeddingRank': ranks.get(name), 'globalEmbeddingScore': similarities.get(name),
                        'semanticTop50ButPoolExcluded': ranks.get(name, len(tools) + 1) <= 50
                            and pool is not None and name not in pool} for name in targets]})
                return pool

            engine._maybe_prefilter = pool_probe
            try:
                results = engine.retrieve_with_scores(case[row['language']], top_k=8, max_graph_depth=2)
            finally:
                engine._maybe_prefilter = original
            rows.append({'case': case['id'], 'language': row['language'], **captured,
                'result': result_summary(results, case)})
        report = {'schemaVersion': 'resource-semantic-pool-probe/1', 'graphSha256': before,
            'indexerSha256': digest(indexer_path), 'productionChanged': False,
            'graphFileUnchanged': digest(graph_path) == before, 'rows': rows,
            'limitations': ['Observational probe, no ranking or pool modification',
                'Exact global embedding ranks are measured against the full existing vector matrix']}
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'report': str(args.report), 'semanticTop50Excluded': sum(
            target['semanticTop50ButPoolExcluded'] for row in rows for target in row['targets'])}))
        return

    traced = []
    for row in source['results']['candidate']['rows']:
        if row['rank'] is not None and row['rank'] <= 4:
            continue
        case = by_id[row['case']]
        channel = worker._english_graph if row['language'] == 'en' else worker._graph
        engine = channel._get_retrieval_engine()
        targets = target_names(case)
        stages = {}
        originals = {}
        returns = ('_compute_keyword_scores', '_compute_embedding_scores', '_fuse_and_filter')
        mutates = ('_inject_graph_candidates', '_boost_name_overlap', '_boost_semantic_phrase_matches',
            '_inject_clause_candidates', '_boost_method_intent', '_boost_embedding_rerank',
            '_preserve_dominant_keyword_candidates', '_boost_structured_semantics')
        for name in (*returns, *mutates, '_maybe_prefilter', '_build_candidates'):
            original = getattr(engine, name)
            originals[name] = original
            signature = inspect.signature(original)

            def wrapped(*positional, _name=name, _original=original, _signature=signature, **keywords):
                bound = _signature.bind(*positional, **keywords).arguments
                result = _original(*positional, **keywords)
                if _name == '_maybe_prefilter':
                    stages['pool'] = {'count': len(result) if result is not None else len(tools),
                        'targets': [{**identity(target), 'poolIncluded': result is None or target in result}
                            for target in targets]}
                elif _name in returns:
                    stages[_name] = summarize(result, targets)
                else:
                    scores = bound.get('scores', bound.get('final_scores'))
                    if scores is not None:
                        stages[_name] = summarize(scores, targets)
                return result

            setattr(engine, name, wrapped)
        began = time.perf_counter()
        try:
            results = engine.retrieve_with_scores(case[row['language']], top_k=8, max_graph_depth=2)
        finally:
            for name, original in originals.items():
                setattr(engine, name, original)
        final = result_summary(results, case)
        traced.append({'case': case['id'], 'language': row['language'], 'initialRank': row['rank'],
            'query': case[row['language']], 'ms': round((time.perf_counter() - began) * 1000, 3),
            'stages': stages, 'final': final,
            'postProcessing': {'reranker': type(engine._reranker).__name__ if engine._reranker else None,
                'diversityLambda': engine._diversity_lambda},
            'reproducedTop8Names': [identity(result.tool.name)['name'] for result in results] ==
                [item['name'] for item in row['returned']]})
        print(json.dumps({'trace': case['id'], 'language': row['language'], 'rank': final['rank']}), flush=True)

    multilingual = []
    for case in cases:
        began = time.perf_counter()
        results = worker._graph.retrieve_with_scores(case['en'], top_k=8, max_graph_depth=2)
        multilingual.append({'case': case['id'], 'query': case['en'],
            'ms': round((time.perf_counter() - began) * 1000, 3), **result_summary(results, case)})
    # Isolated metadata probe: originals on disk and all model/vector files remain unchanged.
    english = worker._english_graph
    changed = []
    for name, node in list(english.tools.items()):
        if node.metadata.get('kind') == 'mcp-service' and node.description != tools[name].description:
            english._tools[name] = copy(node)
            english._tools[name].description = tools[name].description
            changed.append(name)
    engine = english._get_retrieval_engine()
    engine._bm25 = None
    engine._prefilter = None
    indexer._prepare_keyword_index(engine)
    enhanced_mcp = []
    for case in cases:
        if case['kind'] == 'mcp-service':
            results = english.retrieve_with_scores(case['en'], top_k=8, max_graph_depth=2)
            enhanced_mcp.append({'case': case['id'], **result_summary(results, case)})
    report = {'schemaVersion': 'resource-retrieval-trace/1', 'graphSha256': before,
        'indexerSha256': digest(indexer_path), 'casesSha256': digest(cases_path),
        'productionChanged': False, 'graphFileUnchanged': digest(graph_path) == before,
        'failedTop4Traces': traced, 'englishViaMultilingualChannel': multilingual,
        'englishMcpEnhancedDescriptionProbe': {'changedNodeCount': len(changed), 'rows': enhanced_mcp},
        'limitations': ['Diagnostic in-memory interventions, not independent held-out acceptance evidence',
            'Ranks are over the original unchanged top_k=8 pipeline, not an enlarged pool',
            'Pool membership is not sufficient: downstream channels may still exclude a node',
            'No query-specific label is injected into retrieval or scoring']}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'report': str(args.report), 'traces': len(traced),
        'allReproduced': all(row['reproducedTop8Names'] for row in traced),
        'multilingualTop4': sum(row['rank'] is not None and row['rank'] <= 4 for row in multilingual),
        'enhancedMcpTop4': sum(row['rank'] is not None and row['rank'] <= 4 for row in enhanced_mcp)}))


if __name__ == '__main__':
    main()
