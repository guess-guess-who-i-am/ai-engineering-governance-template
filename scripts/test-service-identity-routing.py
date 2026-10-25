#!/usr/bin/env python3
"""Explicit service identity is a routing constraint, not a semantic bonus."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from graph_tool_call.core.tool import ToolSchema
from graph_tool_call.retrieval.engine import RetrievalResult

SPEC = importlib.util.spec_from_file_location('identity_indexer', Path(__file__).resolve().parents[1] / 'codex-profile/mac/hooks/graph_skill_index.py')
INDEXER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INDEXER)


class ServiceIdentityTests(unittest.TestCase):
    def engine(self, duplicate=False):
        def tool(identifier, name, kind):
            node = ToolSchema(name=identifier, description='Original complete module, unchanged.')
            node.metadata.update(kind=kind, skill_name=name, members=['roles/lead.md'], availability={'state': 'unverified'})
            return node
        tools = {'n': tool('n', 'notesphere', 'mcp-service'),
                 'g': tool('g', 'forgebox', 'mcp-service'),
                 's': tool('s', 'search', 'mcp-service'),
                 'x': tool('x', 'irrelevant', 'skill')}
        if duplicate:
            tools['n2'] = tool('n2', 'notesphere', 'mcp-service')
        def original(candidates, query, scores, top_k):
            return list(candidates[:top_k])
        engine = SimpleNamespace(_tools=tools, _post_process=original)
        getattr(INDEXER, 'prepare_service_identity_routing', lambda engine: None)(engine)
        return engine

    def run_query(self, engine, query, k=4):
        original = [RetrievalResult(tool=engine._tools['x'], score=.04)]
        return engine._post_process(original, query, {'x': .04}, k)

    def test_chinese_and_english_service_names_are_preserved_without_translation(self):
        for query in ['通过Notesphere连接器搜索我的页面。', 'Search my NOTESPHERE workspace via its MCP connector.',
                      '用Forgebox的MCP服务查看PR', 'Use the Forgebox connector to read issues.']:
            with self.subTest(query=query):
                engine = self.engine()
                result = self.run_query(engine, query)
                expected = 'n' if 'notesphere' in query.lower() else 'g'
                self.assertEqual(result[0].tool.name, expected)
                self.assertEqual(result[0].score, 0, 'Identity injection must not invent a relevance score')
                self.assertEqual(result[0].tool.metadata['members'], ['roles/lead.md'])
                self.assertEqual(result[0].tool.metadata['availability'], {'state': 'unverified'})

    def test_negations_comparisons_code_tasks_and_incidental_mentions_do_not_pin(self):
        for query in ['不要使用Notesphere连接器，改用别的。', 'Do not use the Notesphere MCP connector.',
                      'Use another connector instead of Notesphere.', '比较Notesphere和Forgebox两个连接器',
                      'Compare the Notesphere MCP connector with another implementation.',
                      'Fix a bug in my Notesphere MCP adapter.', '开发Notesphere连接器并测试',
                      'Look at a project hosted on Forgebox.', '搜索Notesphere连接器的源码',
                      'Search via MCP', 'Search my supernotesphere connector', 'Notesphere-compatible connector',
                      'Read Notesphere pages', 'Notesphere MCP alternatives', 'Use Notesphere and Forgebox connectors.']:
            with self.subTest(query=query):
                engine = self.engine()
                self.assertEqual([row.tool.name for row in self.run_query(engine, query)], ['x'])

    def test_ambiguous_versions_do_not_silently_pick_one(self):
        engine = self.engine(duplicate=True)
        self.assertEqual(self.run_query(engine, 'Use the Notesphere MCP connector')[0].tool.name, 'x')

    def test_existing_result_reused_no_duplicates_topk_and_no_candidate_mutation(self):
        engine = self.engine()
        target = RetrievalResult(tool=engine._tools['n'], score=.013, keyword_score=8)
        other = RetrievalResult(tool=engine._tools['x'], score=.04)
        candidates = [other, target]
        output = engine._post_process(candidates, 'Use Notesphere MCP connector', {'n': .013, 'x': .04}, 1)
        self.assertEqual(output, [target])
        self.assertEqual(candidates, [other, target])
        self.assertEqual(target.keyword_score, 8)

    def test_idempotent_concurrent_and_no_catalog_metadata_mutation(self):
        engine = self.engine()
        first = engine._post_process
        getattr(INDEXER, 'prepare_service_identity_routing', lambda engine: None)(engine)
        self.assertIs(first, engine._post_process)
        queries = ['用Notesphere连接器查页面', 'Use Forgebox MCP connector', 'Do not use Notesphere MCP'] * 34
        with ThreadPoolExecutor(max_workers=20) as pool:
            rows = list(pool.map(lambda query: self.run_query(engine, query), queries))
        for query, result in zip(queries, rows):
            expected = 'n' if query.startswith('用') else ('g' if query.startswith('Use') else 'x')
            self.assertEqual(result[0].tool.name, expected)
        self.assertTrue(all(node.description == 'Original complete module, unchanged.' for node in engine._tools.values()))

    def test_real_graph_still_enriches_prerequisite_relations(self):
        from graph_tool_call import ToolGraph
        graph = ToolGraph()
        graph.ingest_mcp_tools([{'name': 'service', 'description': 'Search pages', 'inputSchema': {'type': 'object'}},
            {'name': 'auth', 'description': 'Authenticate user', 'inputSchema': {'type': 'object'}}])
        graph.tools['service'].metadata.update(kind='mcp-service', skill_name='notesphere', members=['roles/lead.md'])
        graph.add_relation('service', 'auth', 'requires', confidence='EXTRACTED', conf_score=1.0, layer=1, evidence='Fixture explicit prerequisite')
        engine = graph._get_retrieval_engine()
        # Force the ordinary result to omit the explicitly requested module.
        engine._post_process = lambda candidates, query, scores, k: []
        INDEXER.prepare_service_identity_routing(engine)
        result = engine._post_process([], 'Use Notesphere MCP connector', {}, 1)
        engine._enrich_relations(result)
        self.assertEqual(result[0].tool.name, 'service')
        self.assertEqual(result[0].prerequisites, ['auth'])
        self.assertEqual(len(graph.tools), 2, 'Members must not become separate routable nodes')


if __name__ == '__main__':
    unittest.main()
