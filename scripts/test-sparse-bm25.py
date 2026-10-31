#!/usr/bin/env python3
"""Exact replacement contract for the production sparse BM25 helper."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
from pathlib import Path
import unittest
from graph_tool_call.core.tool import ToolSchema
from graph_tool_call.retrieval.keyword import BM25Scorer

SPEC = importlib.util.spec_from_file_location('sparse_bm25_indexer', Path(__file__).resolve().parents[1] / 'codex-profile/mac/hooks/graph_skill_index.py')
INDEXER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INDEXER)


def install(bm25):
    from types import SimpleNamespace
    INDEXER.prepare_sparse_bm25(SimpleNamespace(_get_bm25=lambda: bm25))
    return bm25.score


class SparseBM25Contract(unittest.TestCase):
    def scorer(self, tokenizer=None):
        tools = [ToolSchema(name='hypot', description='Calculate hypotenuse and euclidean norm'),
            ToolSchema(name='integral', description='Compute integral and integrate area under curve'),
            ToolSchema(name='search_files', description='Search files files files and verify citations'),
            ToolSchema(name='get_very_long_operation_name_for_citation_verification', description='Search files and verify citations'),
            ToolSchema(name='中文引用核验', description='论文引用 文献查找 引用引用'),
            ToolSchema(name='blank', description='')]
        return BM25Scorer({tool.name: tool for tool in tools}, tokenizer=tokenizer)

    def assert_exact(self, bm25, queries):
        sparse = install(bm25)
        for query in queries:
            for restrict in (None, set(), {'hypot', 'search_files', '中文引用核验'}, set(bm25._tools)):
                with self.subTest(query=query, restrict=restrict):
                    original = BM25Scorer.score(bm25, query, restrict=restrict)
                    candidate = sparse(query, restrict=restrict)
                    self.assertEqual(original, candidate)
                    self.assertEqual(list(original), list(candidate), 'insertion/tie order must not change')

    def test_repeated_expanded_terms_negative_empty_and_stopwords(self):
        self.assert_exact(self.scorer(), ['', 'the and for', 'zzzz_unmatched_qqqq',
            'search files search files files', 'calculate hypotenuse', 'area under the curve',
            'search file citations', '가져오기 파일', '中文引用核验'])

    def test_lexical_boosts_length_penalty_and_subsequence_are_exercised(self):
        bm25 = self.scorer()
        self.assertGreater(bm25._semantic_phrase_boost('calculate hypotenuse', 'hypot', bm25._tools['hypot']), 1)
        self.assertGreater(bm25._semantic_phrase_boost('area under the curve', 'integral', bm25._tools['integral']), 1)
        self.assertGreater(bm25._name_subsequence_boost(['search', 'file'], 'search_files'), 1)
        self.assertGreater(bm25._name_token_counts['get_very_long_operation_name_for_citation_verification'], 6)
        self.assert_exact(bm25, ['calculate hypotenuse', 'area under the curve', 'search files', 'verify citations'])

    def test_chinese_tokenizer_preserves_multilingual_scoring(self):
        import re
        def tokenizer(text):
            parts = re.split(r'([\u3400-\u9fff]+)', text)
            return [token for part in parts for token in
                ([part[i:i+2] for i in range(len(part)-1)] if re.fullmatch(r'[\u3400-\u9fff]+', part) and len(part)>1 else BM25Scorer._tokenize(part))]
        self.assert_exact(self.scorer(tokenizer), ['核验引用引用 论文', '中文引用hypotenuse文件', '龘靐齉 zzzzqqqq'])

    def test_empty_corpus(self):
        self.assert_exact(BM25Scorer({}), ['', 'search files', 'the and for'])

    def test_chinese_sparse_matches_upstream_arithmetic_exactly(self):
        from types import SimpleNamespace
        tools = [ToolSchema(name=f'doc_{n}', description=('files ' * (1 + n % 7)) + ('引用' * (2 + n % 3))) for n in range(30)]
        bm25 = BM25Scorer({tool.name: tool for tool in tools}, tokenizer=INDEXER.chinese_tokenize)
        engine = SimpleNamespace(_get_bm25=lambda: bm25,
            _maybe_prefilter=lambda *args, **kwargs: None,
            _fuse_and_filter=lambda sources: sources,
            _searcher=SimpleNamespace(expand_from_seeds=lambda *args, **kwargs: []))
        queries = ['核验引用引用 论文', '中文引用hypotenuse文件', 'search files search files files',
                   'area under the curve', '龘靐齉 zzzzqqqq', 'the and for', '']
        expected = {q: BM25Scorer.score(bm25, q) for q in queries}
        INDEXER.prepare_chinese_retrieval(engine)
        for query in queries:
            self.assertEqual(bm25.score(query), expected[query], query)

    def test_install_is_idempotent(self):
        bm25 = self.scorer()
        first = install(bm25)
        self.assertIs(first, install(bm25))
        self.assertEqual(first('search files'), BM25Scorer.score(bm25, 'search files'))

    def test_concurrent_score_buffers_and_returned_dicts_are_isolated(self):
        bm25 = self.scorer()
        queries = ['search files search files', 'calculate hypotenuse', 'area under the curve', 'zzzzqqqq', 'the and for']
        expected = {query: BM25Scorer.score(bm25, query) for query in queries}
        score = install(bm25)
        scheduled = [queries[index % len(queries)] for index in range(100)]
        with ThreadPoolExecutor(max_workers=20) as pool:
            results = list(pool.map(score, scheduled))
        for query, result in zip(scheduled, results):
            self.assertEqual(result, expected[query])
        self.assertEqual(len({id(result) for result in results}), 100)
        results[0].clear()
        self.assertEqual(score(queries[0]), expected[queries[0]])


if __name__ == '__main__':
    unittest.main()
