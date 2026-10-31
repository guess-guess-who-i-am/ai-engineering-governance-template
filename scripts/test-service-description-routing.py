#!/usr/bin/env python3
"""A server capability must not be replaced by its enclosing plugin's pitch."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('description_indexer', ROOT / 'codex-profile/mac/hooks/graph_skill_index.py')
INDEXER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INDEXER)


class ServiceDescriptionTests(unittest.TestCase):
    def fixture(self):
        from graph_tool_call import ToolGraph
        graph = ToolGraph()
        graph.ingest_mcp_tools([
            {'name': 'service', 'description': 'Find current library documentation and versioned code examples.'},
            {'name': 'skill', 'description': 'Original skill. 中文翻译。'},
            {'name': 'tool', 'description': 'Original native schema. 中文翻译。'},
        ], detect_dependencies=False)
        graph.tools['service'].metadata.update(kind='mcp-service',
            retrieval_original_description='Parent plugin: orchestrates teams, agents and hooks.',
            module_id='complete-service', members=[], availability={'state': 'unverified'})
        graph.tools['skill'].metadata['retrieval_original_description'] = 'Original skill.'
        graph.tools['tool'].metadata.update(kind='mcp', retrieval_original_description='Original native schema.')
        graph.add_relation('skill', 'service', 'requires')
        return graph

    def test_english_channel_retains_actual_server_capability(self):
        graph = self.fixture()
        english = INDEXER.english_retrieval_graph(graph)
        self.assertEqual(english.tools['service'].description, graph.tools['service'].description)
        self.assertNotIn('Parent plugin', english.tools['service'].description)

    def test_translated_skills_and_native_tool_schemas_keep_original_english(self):
        graph = self.fixture()
        english = INDEXER.english_retrieval_graph(graph)
        self.assertEqual(english.tools['skill'].description, 'Original skill.')
        self.assertEqual(english.tools['tool'].description, 'Original native schema.')

    def test_source_provenance_module_identity_and_relations_are_preserved(self):
        graph = self.fixture()
        descriptions = {key: node.description for key, node in graph.tools.items()}
        english = INDEXER.english_retrieval_graph(graph)
        self.assertEqual({key: node.description for key, node in graph.tools.items()}, descriptions)
        self.assertEqual(english.tools['service'].metadata, graph.tools['service'].metadata)
        self.assertTrue(english._graph.has_edge('skill', 'service'))
        self.assertEqual(set(english.tools), set(graph.tools))

    def test_description_sidecar_identity_detects_the_old_service_text(self):
        graph = self.fixture()
        english = INDEXER.english_retrieval_graph(graph)
        old = SimpleNamespace(tools={name: SimpleNamespace(description=node.metadata.get(
            'retrieval_original_description', node.description)) for name, node in graph.tools.items()})
        output = Path('/tmp/description-fixture/graph.json')
        before = INDEXER._description_cache_inputs(old, output, 'fixture-model')[1]
        after = INDEXER._description_cache_inputs(english, output, 'fixture-model')[1]
        self.assertNotEqual(before, after, 'A changed corpus must not accept the old precomputed vectors')


if __name__ == '__main__':
    unittest.main()
