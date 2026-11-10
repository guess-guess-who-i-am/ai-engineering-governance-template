"""Exact-score and query-work regression tests against the installed library."""
import importlib.util
from pathlib import Path
import re
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('keyword_adapter', ROOT / 'codex-profile/mac/hooks/graph_skill_index.py')
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)

class KeywordAccelerationTests(unittest.TestCase):
    def test_all_phrase_intents_preserve_candidate_multipliers(self):
        from graph_tool_call.retrieval.keyword import BM25Scorer
        from graph_tool_call.core.tool import ToolSchema, ToolParameter
        from graph_tool_call.retrieval.engine import RetrievalEngine
        queries = ['hypotenuse', 'area under the curve', 'distance traveled', 'geo distance between cities in km', 'distance a(1,2) b(3,4) kilometers', 'fibonacci series', 'current cost', 'genetic similarity', 'population density', 'highest common factor', 'magnetic field current distance', 'lawyer specializing', 'instrument price stock availability guitar budget', 'grocery nutritional home delivery', 'population of london in 2020', 'preference between two options', 'museum open hours', 'when american civil war began', 'religion historical dates islam', 'musical scale piano notes', 'top female sports ranking', 'projectile velocity displacement seconds', 'find restaurant options nearby', 'find vegan recipe within minutes', 'football match schedule', 'get stock info', 'locate nearby hospital', 'fastest route from A to B', '주문 목록 조회', '정산 비교 조회', '권한 버튼', '문의', '中文资料，保留全部', '']
        tools = {name: ToolSchema(name=name, description=description, parameters=[ToolParameter(name='preference', description='route preference', enum=['fastest', 'shortest'])]) for name, description in [('calculate_distance', 'latitude longitude gps coordinates geo distance'), ('find_instrument', 'guitar instrument availability'), ('route_planner', 'calculating the route fastest route'), ('integral', 'area integrate integral'), ('hospital.locate', 'hospital restaurant nutrition religion history stock info recipe'), ('qa_order', '주문조회 정산대사 권한 버튼 pagerole') ]}
        original = BM25Scorer._semantic_phrase_multiplier
        expected = {(q, name): original(q, name, tool) for q in queries for name, tool in tools.items()}
        try:
            adapter._accelerate_keyword_scoring(RetrievalEngine(None, tools))
            for (q, name), value in expected.items():
                self.assertEqual(BM25Scorer._semantic_phrase_multiplier(q, name, tools[name]), value, (q, name))
        finally:
            adapter._restore_keyword_interpretation()

    def test_semantic_overlap_does_not_reclassify_full_query_per_tool(self):
        from graph_tool_call.retrieval import semantic_scorer
        original = semantic_scorer._matching_terms
        left = frozenset({'中文', 'search', '조회', '주문', 'a'} | {f'token{i}' for i in range(500)})
        rights = [frozenset({'조회현황', '주문목록', 'search', str(i)}) for i in range(100)]
        expected = [original(set(left), set(right)) for right in rights]
        calls = []
        fullmatch = re.fullmatch
        def observed(pattern, term, flags=0):
            calls.append(term)
            return fullmatch(pattern, term, flags)
        try:
            getattr(adapter, '_accelerate_term_matching', lambda: None)()
            with patch.object(re, 'fullmatch', observed):
                actual = [semantic_scorer._matching_terms(set(left), set(right)) for right in rights]
            self.assertEqual(actual, expected)
            self.assertLess(len(calls), 1000, 'classify terms once rather than once per tool')
            for l, r in [({'가'}, {'가나다'}), ({'주문목록'}, {'주문'}), ({'中文'}, {'中文字'}), ({'get'}, {'forget'}), (set(), {'조회'})]:
                self.assertEqual(semantic_scorer._matching_terms(l, r), original(l, r))
        finally:
            semantic_scorer._matching_terms = original

    def test_full_input_query_predicates_are_not_repeated_per_candidate(self):
        from graph_tool_call.retrieval.keyword import BM25Scorer
        from graph_tool_call.core.tool import ToolSchema
        from graph_tool_call.retrieval.engine import RetrievalEngine
        tools = {f'search_{i}': ToolSchema(name=f'search_{i}', description='search documents hospital recipe stock route') for i in range(300)}
        engine = RetrievalEngine(None, tools)
        scorer = engine._get_bm25()
        query = 'search documents hospital recipe stock route ' + '保留完整资料，不要截断。' * 100
        baseline = scorer.score(query)
        original_multiplier = BM25Scorer._semantic_phrase_multiplier
        original_search = re.search
        calls = []
        def observed(pattern, text, flags=0):
            if text in (query, query.lower()):
                calls.append(pattern)
            return original_search(pattern, text, flags)
        try:
            getattr(adapter, '_accelerate_keyword_scoring', lambda engine: None)(engine)
            with patch.object(re, 'search', observed):
                actual = scorer.score(query)
            self.assertEqual(actual, baseline)
            self.assertLess(len(calls), 100, 'query regex work must not scale with candidate count')
            self.assertTrue(calls, 'must exercise uncached query interpretation')
            for text in ('geo distance fastest route', 'population of london in 2020', 'grocery nutrition', '주문 목록 조회', '中文全文', ''):
                for name, tool in list(tools.items())[:3]:
                    self.assertEqual(BM25Scorer._semantic_phrase_multiplier(text, name, tool), original_multiplier(text, name, tool))
        finally:
            getattr(adapter, '_restore_keyword_interpretation', lambda: None)()

    def test_sparse_scores_preserve_order_duplicates_restriction_and_custom_tokenizer(self):
        from graph_tool_call.core.tool import ToolSchema
        from graph_tool_call.retrieval.engine import RetrievalEngine
        tools = {name: ToolSchema(name=name, description=description) for name, description in [('b', 'alpha beta'), ('a', 'beta beta'), ('c', 'gamma alpha')]}
        for tokenizer in (None, lambda text: text.lower().split()):
            engine = RetrievalEngine(None, tools)
            if tokenizer:
                engine.set_tokenizer(tokenizer)
            scorer = engine._get_bm25()
            expected = {(q, restricted): scorer.score(q, restrict={'a'} if restricted else None) for q in ('alpha beta beta', 'gamma', 'unknown', '') for restricted in (False, True)}
            try:
                getattr(adapter, '_accelerate_keyword_scoring', lambda engine: None)(engine)
                for (q, restricted), baseline in expected.items():
                    actual = scorer.score(q, restrict={'a'} if restricted else None)
                    self.assertEqual(list(actual.items()), list(baseline.items()))
            finally:
                getattr(adapter, '_restore_keyword_interpretation', lambda: None)()

if __name__ == '__main__':
    unittest.main(verbosity=2)
