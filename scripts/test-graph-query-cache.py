#!/usr/bin/env python3
"""Focused real-library checks; never connects to or restarts the shared worker."""
import importlib.util
import json
import os
from pathlib import Path
import time
import unittest
from unittest.mock import patch

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
ROOT = Path(__file__).resolve().parents[1]
ENTRY = ROOT / 'codex-profile/mac/hooks/graph_skill_index.py'
spec = importlib.util.spec_from_file_location('query_cache_indexer', ENTRY)
indexer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(indexer)

QUERIES = [
    '请实际完善 N9 身体底盘：将已有 N9_1 睡眠习惯和 N9_2 时间安排写成可立即行动的子节点，沿用这两个 ID，按需加一个身体活动子节点。调用 task_tree_subtree(action="write",path="subtrees/N9-subtree.md",foldRoot="N9",markdown,reason) 保存独立子树，保留 ROOT、收入分支全部事实和 GraphState。先 focus 和 read，只有必要时才读协议；不要查 IDE 工程实现。主树超过12KiB不是阻塞，不要整理或折叠其它分支。中间进度用简短中文，成功后明确写“本轮已完成”并说明实际改动；失败就明确写未完成与原因。不要编造个人身体情况，提供普通作息与时间安排，不做医学诊断。',
    '定位并行 IDE 的执行延迟，按函数计时，不修改业务树。'
]


class QueryCacheTests(unittest.TestCase):
    def test_two_queries_reuse_original_function_once_per_distinct_input(self):
        from graph_tool_call.retrieval import semantic_scorer
        calls = {'action': 0, 'shape': 0}

        def shape(query):
            calls['shape'] += 1
            return query.upper()

        def action(query):
            calls['action'] += 1
            return semantic_scorer.infer_query_result_shape(query) + '!'

        with patch.object(semantic_scorer, 'infer_query_action', action), patch.object(semantic_scorer, 'infer_query_result_shape', shape):
            indexer._cache_query_interpretation()
            for query in ('first', 'second', 'first', 'second'):
                self.assertEqual(semantic_scorer.infer_query_action(query), query.upper() + '!')
                self.assertEqual(semantic_scorer.infer_query_result_shape(query), query.upper())
            self.assertEqual(calls, {'action': 2, 'shape': 2})
            self.assertEqual(semantic_scorer.infer_query_action.cache_info().hits, 2)

    def test_cache_is_bounded_and_install_is_idempotent(self):
        from graph_tool_call.retrieval import semantic_scorer
        with patch.object(semantic_scorer, 'infer_query_action', lambda query: query), patch.object(semantic_scorer, 'infer_query_result_shape', lambda query: query):
            indexer._cache_query_interpretation()
            first = {name: getattr(semantic_scorer, name) for name in ('infer_query_action', 'infer_query_result_shape')}
            indexer._cache_query_interpretation()
            for name, function in first.items():
                self.assertIs(getattr(semantic_scorer, name), function)
                for number in range(300):
                    self.assertEqual(function(str(number)), str(number))
                info = function.cache_info()
                self.assertEqual(info.maxsize, 256)
                self.assertEqual(info.currsize, 256)

    def test_real_graph_complete_records_equal_with_one_load(self):
        from graph_tool_call.retrieval import semantic_scorer
        registry = json.loads((Path.home() / '.codex/skill-registry/skills-index.json').read_text())
        worker = indexer._GraphWorker(Path(registry['externalGraphPath']))
        worker._load_if_stale()
        names = ('infer_query_action', 'infer_query_result_shape')
        installed = {name: getattr(semantic_scorer, name) for name in names}
        self.assertTrue(all(hasattr(function, 'cache_info') for function in installed.values()))
        originals = {name: function.__wrapped__ for name, function in installed.items()}
        report = {'schema': 'graph-query-cache-verification/v1', 'scope': 'independent process; shared worker not restarted', 'queries': []}
        try:
            for name, function in originals.items():
                setattr(semantic_scorer, name, function)
            baseline = []
            # Loading normally reinstalls the caches. Disable only that installer
            # during the independent baseline so timings really are uncached.
            with patch.object(indexer, '_cache_query_interpretation', lambda: None):
                worker.query({'query': QUERIES[0], 'top_k': 8})
                for query in QUERIES:
                    worker._results.clear()
                    started = time.perf_counter()
                    baseline.append(worker.query({'query': query, 'top_k': 8}))
                    report['queries'].append({'baselineMs': (time.perf_counter() - started) * 1000})
            indexer._cache_query_interpretation()
            cached = []
            for query, result in zip(QUERIES, baseline):
                worker._results.clear()
                started = time.perf_counter()
                value = worker.query({'query': query, 'top_k': 8})
                cached.append(value)
                self.assertEqual(value, result)
                report['queries'][len(cached) - 1].update({'cachedMs': (time.perf_counter() - started) * 1000, 'resultCount': len(value), 'completeRecordsExactlyEqual': True})
            report['loads'] = worker.loads
            self.assertEqual(worker.loads, 1)
            report['cacheInfo'] = {name: getattr(semantic_scorer, name).cache_info()._asdict() for name in names}
            print(json.dumps(report, ensure_ascii=False))
        finally:
            for name, function in installed.items():
                setattr(semantic_scorer, name, function)


if __name__ == '__main__':
    unittest.main(verbosity=2)
