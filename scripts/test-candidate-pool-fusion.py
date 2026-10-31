#!/usr/bin/env python3
"""Fusion must honor the existing query-local pool without losing fallback."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
from pathlib import Path
import threading
from types import SimpleNamespace
import unittest

SPEC = importlib.util.spec_from_file_location('pool_indexer', Path(__file__).resolve().parents[1] / 'codex-profile/mac/hooks/graph_skill_index.py')
INDEXER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INDEXER)


class CandidatePoolTests(unittest.TestCase):
    def engine(self, pool=None, barrier=None, fail=False):
        def maybe_pool(query):
            return pool(query) if callable(pool) else pool
        def fuse(sources):
            if barrier:
                barrier.wait(timeout=10)
            if fail:
                raise ValueError('fusion failed')
            result = {}
            for scores, weight in sources:
                for name, value in scores.items():
                    result[name] = result.get(name, 0) + value * weight
            return result
        engine = SimpleNamespace(_maybe_prefilter=maybe_pool, _fuse_and_filter=fuse)
        getattr(INDEXER, 'prepare_candidate_pool_fusion', lambda engine: None)(engine)
        return engine

    def test_pool_bounds_every_fusion_source_and_retains_arithmetic(self):
        engine = self.engine({'relevant', 'zero'})
        engine._maybe_prefilter('task')
        self.assertEqual(engine._fuse_and_filter([
            ({'irrelevant': 100, 'relevant': 2, 'zero': 0}, .25),
            ({'relevant': 4, 'other': 100}, .5)]), {'relevant': 2.5, 'zero': 0})

    def test_no_prefilter_keeps_the_full_corpus_fallback(self):
        engine = self.engine()
        engine._maybe_prefilter('task')
        self.assertEqual(engine._fuse_and_filter([({'a': 1, 'b': 2}, 1)]), {'a': 1, 'b': 2})

    def test_empty_pool_is_not_a_full_corpus_fallback(self):
        engine = self.engine(set())
        engine._maybe_prefilter('task')
        self.assertEqual(engine._fuse_and_filter([({'a': 1}, 1)]), {})

    def test_concurrent_requests_do_not_exchange_their_pools(self):
        engine = self.engine(lambda query: {query}, barrier=threading.Barrier(20))
        def one(query):
            engine._maybe_prefilter(query)
            return query, engine._fuse_and_filter([({str(n): n for n in range(100)}, 1)])
        with ThreadPoolExecutor(max_workers=20) as pool:
            results = list(pool.map(one, map(str, range(100))))
        for query, values in results:
            self.assertEqual(values, {query: int(query)})

    def test_repeated_install_and_full_corpus_next_request(self):
        engine = self.engine(lambda query: {'a'} if query == 'filtered' else None)
        original = engine._fuse_and_filter
        getattr(INDEXER, 'prepare_candidate_pool_fusion', lambda engine: None)(engine)
        self.assertIs(engine._fuse_and_filter, original)
        engine._maybe_prefilter('filtered')
        self.assertEqual(engine._fuse_and_filter([({'a': 1, 'b': 2}, 1)]), {'a': 1})
        engine._maybe_prefilter('full')
        self.assertEqual(engine._fuse_and_filter([({'a': 1, 'b': 2}, 1)]), {'a': 1, 'b': 2})


if __name__ == '__main__':
    unittest.main()
