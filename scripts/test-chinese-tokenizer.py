#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import unittest
from graph_tool_call.retrieval.keyword import BM25Scorer

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('indexer', ROOT / 'codex-profile/mac/hooks/graph_skill_index.py')
indexer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(indexer)


class ChineseTokenTests(unittest.TestCase):
    def test_chinese_query_is_not_one_opaque_token(self):
        query = '分析软件测试失败，验证根因假设。'
        self.assertEqual(BM25Scorer._tokenize(query), [query])
        actual = indexer.chinese_tokenize(query)
        self.assertIn('测试', actual)
        self.assertIn('根因', actual)
        self.assertNotIn('败验', actual)

    def test_latin_and_korean_behavior_preserved(self):
        for query in ['getUserById list_all_pets namespaced API schema', '정기주문해지', 'HTTP error 503 file_path.py']:
            self.assertEqual(indexer.chinese_tokenize(query), BM25Scorer._tokenize(query))

    def test_real_bm25_recovers_chinese_paraphrase(self):
        records = [{'name': 'debugging', 'tool_name': 'debugging', 'description': '诊断软件测试故障，沿信息流验证根因。', 'path': 'debugging', 'categories': [], 'tags': []},
                   {'name': 'finance', 'tool_name': 'finance', 'description': '分析股票收益与交易策略。', 'path': 'finance', 'categories': [], 'tags': []}]
        graph = indexer.graph_from_records(records)
        engine = graph._get_retrieval_engine()
        self.assertEqual(engine._compute_keyword_scores('测试出故障，验证根因', '测试出故障，验证根因'), {})
        graph.set_tokenizer(indexer.chinese_tokenize)
        scores = engine._compute_keyword_scores('测试出故障，验证根因', '测试出故障，验证根因')
        self.assertIn('debugging', scores)
        self.assertNotIn('finance', scores)

    def test_offline_translation_covers_all_owned_skills(self):
        owned = indexer.load_owned_skills(ROOT / 'codex-profile/global-skills')
        self.assertEqual(len(owned), 22)
        import re
        self.assertTrue(all(re.search('[\u4e00-\u9fff]', row['description']) for row in owned))

    def test_vectorized_bm25_preserves_scores_and_restrict(self):
        records = [{'name': f'skill-{i}', 'tool_name': f'skill_{i}', 'description': '诊断测试根因 软件接口 schema' if i % 2 else '数据搜索 API listUsers',
                    'path': '', 'tags': [], 'categories': []} for i in range(25)]
        graph = indexer.graph_from_records(records)
        graph.set_tokenizer(indexer.chinese_tokenize)
        engine = graph._get_retrieval_engine()
        queries = ['诊断测试根因', 'API schema 软件测试 测试', 'listUsers 根因', '不存在', '']
        scorer = engine._get_bm25()
        expected = [scorer.score(q) for q in queries]
        restricted = [scorer.score(q, restrict={'skill_1', 'skill_2'}) for q in queries]
        indexer.prepare_chinese_retrieval(engine)
        for q, rows, limited in zip(queries, expected, restricted):
            actual = scorer.score(q)
            self.assertEqual(actual.keys(), rows.keys())
            for name, value in rows.items():
                self.assertAlmostEqual(actual[name], value, places=12)
            self.assertEqual(scorer.score(q, restrict={'skill_1', 'skill_2'}), limited)

    def test_sidecar_checks_identity_checksum_shape_and_relative_path(self):
        import hashlib
        import numpy as np
        import tempfile
        graph = indexer.graph_from_records([{'name': 'one', 'tool_name': 'one', 'description': '测试',
            'path': '', 'tags': [], 'categories': []}])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sidecar = root / 'vectors.npz'
            np.savez_compressed(sidecar, names=['one'], vectors=np.zeros((1, 384), dtype=np.float32), signature='fixture')
            config = dict(file=sidecar.name, model='unused-offline-test', signature='fixture', sha256=hashlib.sha256(sidecar.read_bytes()).hexdigest())
            graph.metadata['chinese_embedding'] = config
            loaded = indexer.load_chinese_embedding(graph, root / 'graph.json')
            self.assertEqual(loaded.size, 1)
            self.assertEqual(loaded._embeddings['one'].dtype, np.float32)
            config['signature'] = 'stale'
            with self.assertRaisesRegex(ValueError, 'does not match'):
                indexer.load_chinese_embedding(graph, root / 'graph.json')
            config['file'] = '../vectors.npz'
            with self.assertRaisesRegex(ValueError, 'sidecar path'):
                indexer.load_chinese_embedding(graph, root / 'graph.json')
            config['file'], config['signature'], config['sha256'] = sidecar.name, 'fixture', 'bad'
            with self.assertRaisesRegex(ValueError, 'checksum'):
                indexer.load_chinese_embedding(graph, root / 'graph.json')

    def test_phrase_projection_preserves_mixed_language_boosts(self):
        import re
        from graph_tool_call.core.tool import ToolSchema
        phrases = ['hypotenuse', 'area under the curve', 'geo distance', 'latitude longitude distance',
            'population of france in 1945', 'fastest best route', 'recipe search', 'hospital near me',
            'stock price availability', '24 hours grocery home delivery', '정산 비교 조회', '주문 목록 조회',
            'sports schedule', 'nutrition calories grocery', 'us history religion', 'fibonacci series']
        for phrase in phrases:
            tool = ToolSchema(name='calculate_distance', description=phrase)
            for query in [phrase, '查找' + phrase, phrase + '然后验证所有证据' * 50,
                          '保留并发修改，' * 30 + phrase + '。不遗漏目标。', '중국中文' + phrase + '中文한국']:
                self.assertEqual(BM25Scorer._semantic_phrase_multiplier(query, tool.name, tool),
                    BM25Scorer._semantic_phrase_multiplier(re.sub(r'[\u3400-\u4dbf\u4e00-\u9fff]+', '中', query), tool.name, tool))

    def test_description_vectors_are_prebuilt_and_validated(self):
        import tempfile
        import numpy as np
        from unittest.mock import patch
        graph = indexer.graph_from_records([{'name': 'one', 'tool_name': 'one', 'description': '固定描述',
            'path': '', 'tags': [], 'categories': []}])
        class Model:
            def to(self, device): return self
            def encode(self, texts, **kwargs): return np.ones((len(texts), 384), dtype=np.float32)
        class Provider:
            def _get_model(self): return Model()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch('graph_tool_call.retrieval.embedding.SentenceTransformerProvider', lambda name: Provider()):
                config = indexer.build_description_embeddings(graph, root / 'graph.json', 'fixture-model')
            graph.metadata['description_embeddings'] = {'zh': config}
            loaded = indexer.load_description_embeddings(graph, root / 'graph.json', 'zh')
            self.assertTrue(np.array_equal(loaded['固定描述'], np.ones(384)))
            self.assertFalse(loaded['固定描述'].flags.writeable)
            config['sha256'] = 'bad'
            with self.assertRaisesRegex(ValueError, 'checksum'):
                indexer.load_description_embeddings(graph, root / 'graph.json', 'zh')
            config['file'] = '../escape.npz'
            with self.assertRaisesRegex(ValueError, 'identity/path'):
                indexer.load_description_embeddings(graph, root / 'graph.json', 'zh')


unittest.main()
