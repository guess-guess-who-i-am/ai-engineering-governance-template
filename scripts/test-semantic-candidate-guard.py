#!/usr/bin/env python3
"""Candidate cap must preserve global semantic hits as well as BM25 hits."""
from concurrent.futures import ThreadPoolExecutor
from contextvars import ContextVar
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('guard_indexer', ROOT / 'codex-profile/mac/hooks/graph_skill_index.py')
indexer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(indexer)
install_guard = getattr(indexer, 'prepare_semantic_candidate_guard', lambda engine: None)


class GuardTests(unittest.TestCase):
    def fixture(self, pool=None, embedding=True):
        names = [f'a{i:04}' for i in range(500)] + [f'z{i:04}' for i in range(100)]
        original = set(names[:500]) if pool is None else pool
        def candidate(query, intent, bm25_top, *, resource_scored=None):
            return None if original is False else set(original)
        # Match the actual resident index API: one matrix pass is reused by
        # category recall and scoring; a fake search-only index cannot test it.
        matrix = np.asarray([[.1,.1]]*500+[[1,.5]]*50+[[.5,1]]*50,dtype=np.float32)
        vectors = SimpleNamespace(size=len(names), _names=names, _matrix=matrix,
            _ensure_matrix=lambda:None,
            encode=lambda query:np.asarray([1,0] if query=='one' else [0,1],dtype=np.float32))
        prefilter = SimpleNamespace(candidate_pool=candidate, _max_pool=500,
            _tools={name:SimpleNamespace(metadata={'kind':'skill'}) for name in names},
            _embedding_index=vectors if embedding else None)
        engine = SimpleNamespace(_get_prefilter=lambda: prefilter,
            _compute_embedding_scores=lambda *a,**kw:{},
            _codex_category_slots=ContextVar('guard_test_slots',default={'expert':2,'skill':4,'mcp':2}))
        return engine, prefilter

    def test_global_semantic_top50_survives_lexicographic_category_cap(self):
        engine, prefilter = self.fixture()
        install_guard(engine)
        lexical = [f'a{i:04}' for i in range(50)]
        pool = prefilter.candidate_pool('one', None, lexical,
            resource_scored={f'a{i:04}': 500 - i for i in range(500)})
        self.assertEqual(len(pool), 500)
        self.assertTrue(set(lexical).issubset(pool))
        self.assertTrue({f'z{i:04}' for i in range(50)}.issubset(pool))

    def test_weak_signal_full_corpus_path_is_unchanged(self):
        engine, prefilter = self.fixture(pool=False)
        install_guard(engine)
        self.assertIsNone(prefilter.candidate_pool('one', None, []))

    def test_missing_embedding_preserves_original_pool(self):
        engine, prefilter = self.fixture(embedding=False)
        install_guard(engine)
        self.assertEqual(prefilter.candidate_pool('one', None, []), {f'a{i:04}' for i in range(500)})

    def test_repeated_install_is_idempotent(self):
        engine, prefilter = self.fixture()
        install_guard(engine)
        installed = prefilter.candidate_pool
        install_guard(engine)
        self.assertIs(prefilter.candidate_pool, installed)

    def test_concurrent_queries_do_not_share_pool_state(self):
        engine, prefilter = self.fixture()
        install_guard(engine)
        with ThreadPoolExecutor(max_workers=10) as threads:
            results = list(threads.map(lambda query: (query, prefilter.candidate_pool(query, None, [])),
                ['one', 'two'] * 20))
        for query, pool in results:
            offset = 0 if query == 'one' else 50
            self.assertTrue({f'z{i:04}' for i in range(offset, offset + 50)}.issubset(pool))
            self.assertLessEqual(len(pool), 500)

    def test_small_cap_keeps_bm25_and_bounds_semantic_guard(self):
        engine, prefilter = self.fixture(pool={f'a{i:04}' for i in range(10)})
        prefilter._max_pool = 10
        install_guard(engine)
        lexical = [f'a{i:04}' for i in range(5)]
        pool = prefilter.candidate_pool('one', None, lexical)
        self.assertEqual(len(pool), 10)
        self.assertTrue(set(lexical).issubset(pool))

    def test_chinese_fusion_context_receives_the_guarded_pool(self):
        from graph_tool_call import ToolGraph
        _, prefilter = self.fixture()
        graph = ToolGraph()
        graph.ingest_mcp_tools([{'name': name, 'description': 'fixture',
            'inputSchema': {'type': 'object', 'properties': {}}} for name in prefilter._tools])
        engine = graph._get_retrieval_engine()
        engine._prefilter_enabled = True
        engine._prefilter = prefilter
        engine._embedding_index = prefilter._embedding_index
        indexer.prepare_category_slot_retrieval(engine).set({'expert':2,'skill':4,'mcp':2})
        indexer.prepare_semantic_candidate_guard(engine)
        indexer.prepare_chinese_retrieval(engine)
        pool = engine._maybe_prefilter('one', None, {}, {})
        self.assertIn('z0000', pool)
        fused = engine._fuse_and_filter([({'z0000': 1.0}, 1.0)])
        self.assertIn('z0000', fused)


if __name__ == '__main__':
    unittest.main()
