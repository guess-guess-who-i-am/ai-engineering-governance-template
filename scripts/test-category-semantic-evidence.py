#!/usr/bin/env python3
"""Recalled experts must retain semantic evidence below global top-depth."""
from concurrent.futures import ThreadPoolExecutor
from contextvars import ContextVar
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

import numpy as np

SPEC = importlib.util.spec_from_file_location('semantic_evidence_indexer',
    Path(__file__).resolve().parents[1]/'codex-profile/mac/hooks/graph_skill_index.py')
INDEXER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INDEXER)


class SemanticEvidenceTests(unittest.TestCase):
    def fixture(self,unrestricted=False):
        names = [f'skill-{n:03}' for n in range(600)] + ['expert-first','expert-second','expert-target']
        values = np.array([.9-i*.0005 for i in range(600)]+[.4,.35,.3],dtype=np.float32)
        matrix = np.column_stack((values,-values))
        index = SimpleNamespace(size=len(names),_names=names,_matrix=matrix,
            _ensure_matrix=lambda:None,encode=lambda q:np.array([1,0] if q=='positive' else [0,1]))
        tools = {n:SimpleNamespace(metadata={'kind':'expert' if n.startswith('expert') else 'skill'}) for n in names}
        prefilter = SimpleNamespace(_tools=tools,_max_pool=500,_embedding_index=index,
            candidate_pool=lambda *a,**kw:None if unrestricted else set(names[:499]+['expert-target']))
        fallback = lambda q,top_k,restrict=None:{'fallback':1.0}
        engine = SimpleNamespace(_get_prefilter=lambda:prefilter,_compute_embedding_scores=fallback,
            _codex_category_slots=ContextVar('test_slots',default=None))
        INDEXER.prepare_semantic_candidate_guard(engine)
        return engine,prefilter

    def request(self,engine,prefilter,query):
        slots=engine._codex_category_slots.set({'expert':2,'skill':4,'mcp':2})
        context=engine._codex_category_embedding_scores_context.set(None)
        try:
            pool=prefilter.candidate_pool(query,None,['expert-target'])
            return pool,engine._compute_embedding_scores(query,8,pool)
        finally:
            engine._codex_category_embedding_scores_context.reset(context)
            engine._codex_category_slots.reset(slots)

    def test_lexical_expert_keeps_its_actual_semantic_score(self):
        engine,prefilter=self.fixture()
        pool,scores=self.request(engine,prefilter,'positive')
        self.assertIn('expert-target',pool)
        self.assertEqual(set(scores),pool,'Score the recalled pool before taking output slots')
        self.assertAlmostEqual(scores['expert-target'],.3,places=6)
        self.assertLessEqual(len(pool),500,'No candidate-pool expansion')

    def test_negative_cosine_is_preserved_without_inventing_evidence(self):
        engine,prefilter=self.fixture()
        pool,scores=self.request(engine,prefilter,'negative')
        self.assertEqual(set(scores),pool)
        self.assertAlmostEqual(scores['expert-target'],-.3,places=6)

    def test_requests_do_not_exchange_semantic_vectors(self):
        engine,prefilter=self.fixture()
        with ThreadPoolExecutor(max_workers=8) as threads:
            result=list(threads.map(lambda q:(q,self.request(engine,prefilter,q)),['positive','negative']*16))
        for query,(pool,scores) in result:
            self.assertEqual(set(scores),pool)
            self.assertAlmostEqual(scores['expert-target'],.3 if query=='positive' else -.3,places=6)

    def test_non_category_requests_keep_the_owning_library_behavior(self):
        engine,_=self.fixture()
        self.assertEqual(engine._compute_embedding_scores('positive',8,{'expert-target'}),{'fallback':1.0})

    def test_weak_category_signal_still_uses_the_semantic_pool(self):
        engine,prefilter=self.fixture(unrestricted=True)
        pool,scores=self.request(engine,prefilter,'positive')
        self.assertIsNotNone(pool,'Known semantic evidence must not trigger full-corpus scoring')
        self.assertLessEqual(len(pool),500)
        self.assertTrue({'expert-first','expert-second','expert-target'}.issubset(pool))
        self.assertIn('skill-000',pool)
        self.assertEqual(set(scores),pool)

    def test_absent_semantic_evidence_does_not_invent_a_pool(self):
        engine,prefilter=self.fixture(unrestricted=True)
        prefilter._embedding_index._matrix=None
        pool,_=self.request(engine,prefilter,'positive')
        self.assertIsNone(pool)


if __name__=='__main__':unittest.main()
