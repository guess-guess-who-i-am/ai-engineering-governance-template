#!/usr/bin/env python3
"""Experimental lexical contract, NOT proof of production non-regression.

The candidate is not installed because full-graph comparison finds a loss.
"""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('specificity_experiment', ROOT / 'scripts/compare-router-specificity.py')
experiment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(experiment)
indexer = experiment.punctuation_candidate(ROOT / 'codex-profile/mac/hooks/graph_skill_index.py')


class TokenizationTests(unittest.TestCase):
    def test_punctuation_is_never_lexical_evidence(self):
        self.assertEqual(indexer.lexical_query_tokens('、，。；！ … ★'), [])
        self.assertEqual(indexer.lexical_query_tokens('测试、代码'), ['测试', '代码'])

    def test_no_bigram_across_separators(self):
        tokens = indexer.lexical_query_tokens('甲乙，丙丁 HNSW-32 검색')
        self.assertIn('甲乙', tokens)
        self.assertIn('丙丁', tokens)
        self.assertNotIn('乙丙', tokens)
        self.assertTrue(all(any(c.isalnum() for c in token) for token in tokens))

    def test_query_never_matches_document_punctuation(self):
        from graph_tool_call import ToolGraph
        graph = ToolGraph()
        graph.add_tool({'name': 'irrelevant', 'description': '、，。；！'})
        graph.add_tool({'name': 'specific', 'description': 'HNSW内存，索引调优。'})
        graph.set_tokenizer(indexer.chinese_tokenize)
        engine = graph._get_retrieval_engine()
        engine._tokenize = indexer.chinese_tokenize
        indexer._prepare_keyword_index(engine)
        indexer.prepare_chinese_retrieval(engine)
        self.assertEqual(engine._keyword_match('，。、'), {})
        self.assertNotIn('irrelevant', engine._keyword_match('HNSW内存、'))
        self.assertEqual(engine._get_bm25().score('，。、'), {})

    def test_document_norms_stay_compatible(self):
        # Query evidence is cleaned, not the historical document-length stats.
        self.assertIn('、', indexer.chinese_tokenize('代码、质量'))
        self.assertNotIn('、', indexer.lexical_query_tokens('代码、质量'))


if __name__ == '__main__':
    unittest.main()
