#!/usr/bin/env python3
"""Verify optimized routing against the unmodified library on the real global graph."""
import importlib.util
import json
import os
from pathlib import Path
import time

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('equivalence_indexer', ROOT / 'codex-profile/mac/hooks/graph_skill_index.py')
indexer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(indexer)
spec = importlib.util.spec_from_file_location('load_benchmark', ROOT / 'scripts/benchmark-graph-load.py')
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)

def main():
    from graph_tool_call.retrieval.engine import RetrievalEngine
    registry = json.loads((Path.home() / '.codex/skill-registry/skills-index.json').read_text())
    worker = indexer._GraphWorker(Path(registry['externalGraphPath']))
    graph = worker._load_if_stale()
    engine = graph._get_retrieval_engine()
    optimized_keyword = engine._keyword_match
    optimized_index = engine._embedding_index
    original_index = optimized_index._index
    cached_provider = original_index._provider
    original_provider = cached_provider._provider
    rows = []
    for number, prompt in enumerate(benchmark.PROMPTS):
        query = prompt + ' 保留全部用户要求，完成后核验真实文件与测试证据。' * 4
        engine._keyword_match = lambda text: RetrievalEngine._keyword_match(engine, text)
        engine.set_embedding_index(original_index)
        original_index._provider = original_provider
        begun = time.perf_counter()
        baseline = indexer.result_records(graph.retrieve_with_scores(query, top_k=8, max_graph_depth=2))
        baseline_ms = (time.perf_counter() - begun) * 1000
        engine._keyword_match = optimized_keyword
        original_index._provider = cached_provider
        engine.set_embedding_index(optimized_index)
        begun = time.perf_counter()
        actual = worker.query({'query': query, 'top_k': 8})
        optimized_ms = (time.perf_counter() - begun) * 1000
        assert len(actual) == len(baseline), (number, len(actual), len(baseline))
        max_difference = 0
        for expected, value in zip(baseline, actual):
            assert expected.keys() == value.keys()
            for key in expected:
                if isinstance(expected[key], float):
                    delta = abs(expected[key] - value[key])
                    max_difference = max(max_difference, delta)
                    assert delta < 1e-6, (number, key, expected[key], value[key])
                else:
                    assert expected[key] == value[key], (number, key, expected[key], value[key])
        rows.append({'query': number, 'baselineMs': round(baseline_ms, 2),
                     'optimizedMs': round(optimized_ms, 2), 'sameRankAndRecords': True,
                     'maxScoreDelta': max_difference})
    print(json.dumps({'queries': len(rows), 'passed': len(rows), 'rows': rows}, ensure_ascii=False))

if __name__ == '__main__':
    main()
