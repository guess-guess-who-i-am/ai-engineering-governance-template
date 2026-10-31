#!/usr/bin/env python3
"""Forbidden fields must not affect lexical/vector input or graph recall."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('content_indexer', ROOT/'codex-profile/mac/hooks/graph_skill_index.py')
indexer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(indexer)


class ContentTests(unittest.TestCase):
    def test_external_skill_fields_are_explicitly_allowlisted(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/'one').mkdir()
            (root/'one/SKILL.md').write_text('Original workflow untouched')
            row = dict(name='database', dir='one', description='query plans',
                       problem_cn='慢查询', when_cn='优化索引', c1='C1_SENTINEL',
                       c2='C2_SENTINEL', key='KEY_SENTINEL', traits_cn=['TRAITS_SENTINEL'],
                       diff_cn='DIFF_SENTINEL', id='ID_SENTINEL')
            catalog = root/'catalog.json'
            catalog.write_text(json.dumps({'skills':[row]}))
            record = indexer.load_skills(root, catalog)[0][0]
            self.assertEqual(record['description'], 'query plans 慢查询 优化索引')
            self.assertEqual(record['tags'], [])
            self.assertEqual(record['categories'], [])

    def graph(self, identifier):
        graph = indexer.graph_from_records([dict(name='database', tool_name=identifier,
            description='Find database indexes', path='', tags=['TAG_SENTINEL'], categories=['C1_SENTINEL'])])
        graph.set_tokenizer(indexer.chinese_tokenize)
        engine = graph._get_retrieval_engine()
        indexer.prepare_content_retrieval(engine)
        indexer.prepare_resource_name_evidence(engine)
        indexer._prepare_keyword_index(engine)
        return graph, engine

    def test_identity_tags_parameters_metadata_are_never_lexical_or_vector_text(self):
        graph, engine = self.graph('INTERNAL_UUID_SENTINEL')
        tool = graph.tools['INTERNAL_UUID_SENTINEL']
        self.assertEqual(indexer.retrieval_tool_text(tool), 'database Find database indexes')
        self.assertEqual(engine._get_bm25()._tool_tokens['INTERNAL_UUID_SENTINEL'],
                         engine._get_bm25()._tokenize_fn('database') +
                         engine._get_bm25()._tokenize_fn('Find database indexes'))
        for query in ('INTERNAL_UUID_SENTINEL','TAG_SENTINEL','C1_SENTINEL'):
            self.assertEqual(engine._get_bm25().score(query), {})
            self.assertEqual(engine._keyword_match(query), {})
            self.assertEqual(engine._searcher.resource_first_search(query, tools=graph.tools), {})
        self.assertEqual(tool.name,'INTERNAL_UUID_SENTINEL', 'Locator identity is preserved')

    def test_renaming_ids_does_not_change_name_penalty_or_phrase_scores(self):
        a, left = self.graph('integral_internal_one_two_three_four_five_six_seven')
        b, right = self.graph('uuid_abcdef')
        for query in ['database indexes','area under the curve','find database']:
            scores = [list(engine._get_bm25().score(query).values()) for engine in (left,right)]
            self.assertEqual(*scores)
            boosted = []
            for engine, graph in [(left,a),(right,b)]:
                values = {next(iter(graph.tools)):1.0}
                engine._boost_semantic_phrase_matches(query,values)
                engine._boost_name_overlap(query,values)
                boosted.append(list(values.values()))
            self.assertEqual(*boosted)

    def test_native_mcp_keeps_public_function_name_outside_transport_prefix(self):
        graph = indexer.graph_from_records([],mcp_records=[dict(tool_name='TRANSPORT_UUID_SENTINEL',
            name='find_files', server='native', description='Search repository files',
            inputSchema={'type':'object','properties':{'PARAMETER_ID_SENTINEL':{'type':'string'}}})])
        tool = graph.tools['TRANSPORT_UUID_SENTINEL']
        self.assertEqual(indexer.retrieval_tool_text(tool),'find_files Search repository files')
        engine = graph._get_retrieval_engine()
        indexer.prepare_content_retrieval(engine)
        self.assertEqual(engine._get_bm25().score('PARAMETER_ID_SENTINEL'),{})
        self.assertTrue(tool.parameters, 'Invocation schema remains intact')


if __name__ == '__main__':
    unittest.main()
