#!/usr/bin/env python3
"""Differential traversal contract on real GraphToolCall graphs."""
import importlib.util
from pathlib import Path
import random
from types import SimpleNamespace
import unittest
from graph_tool_call.core.dict_graph import DictGraph
from graph_tool_call.ontology.schema import NodeType, RelationType
from graph_tool_call.retrieval.graph_search import GraphSearcher
spec = importlib.util.spec_from_file_location('indexer', Path(__file__).resolve().parents[1] / 'codex-profile/mac/hooks/graph_skill_index.py')
indexer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(indexer)

class ReadCacheTests(unittest.TestCase):
    def test_same_scores_order_directions_and_repeated_reads(self):
        for seed in range(5):
            rng = random.Random(seed)
            graph = DictGraph()
            for n in range(30):
                graph.add_node(str(n), node_type=NodeType.CATEGORY if n < 3 else NodeType.TOOL, description=f'node {n}')
            for _ in range(120):
                a, b = str(rng.randrange(30)), str(rng.randrange(30))
                graph.add_edge(a, b, relation=RelationType.BELONGS_TO)
            original, candidate = GraphSearcher(graph), GraphSearcher(graph)
            engine = SimpleNamespace(_searcher=candidate)
            indexer.prepare_graph_read_cache(engine)
            first = candidate._graph
            indexer.prepare_graph_read_cache(engine)
            self.assertIs(first, candidate._graph)
            for n in graph.nodes():
                for direction in ('in', 'out', 'both'):
                    self.assertEqual(graph.get_edges_from(n, direction), list(candidate._graph.get_edges_from(n, direction)))
                self.assertEqual(graph.get_node_attrs(n), candidate._graph.get_node_attrs(n))
            for depth in (0, 1, 2, 3):
                for limit in (1, 8, 30):
                    for seeds in (['3'], ['4','5'], ['29','0'], ['missing']):
                        self.assertEqual(original.expand_from_seeds(seeds, depth, limit), candidate.expand_from_seeds(seeds, depth, limit))
            self.assertGreater(candidate._graph.get_edges_from.cache_info().hits, 0)
            self.assertGreater(candidate._graph.get_node_attrs.cache_info().hits, 0)
            # A new graph version must build new caches; no shared stale nodes.
            replacement = DictGraph(); replacement.add_node('new', node_type=NodeType.TOOL)
            next_engine = SimpleNamespace(_searcher=GraphSearcher(replacement))
            indexer.prepare_graph_read_cache(next_engine)
            self.assertEqual(next_engine._searcher._graph.nodes(), ['new'])
            self.assertIsNot(next_engine._searcher._graph, candidate._graph)

if __name__ == '__main__': unittest.main()
