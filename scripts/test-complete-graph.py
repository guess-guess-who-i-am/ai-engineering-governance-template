#!/usr/bin/env python3
"""Exercise build -> serialized vectors -> resident query with real encoders."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

for key in ('HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE'):
    os.environ[key] = '1'
for key in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
    os.environ[key] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
ROOT = Path(__file__).resolve().parents[1]
ENTRY = ROOT/'codex-profile/mac/hooks/graph_skill_index.py'
spec = importlib.util.spec_from_file_location('complete_graph_test', ENTRY)
indexer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(indexer)
from complete_embedding import REPRESENTATION, encode_complete
import numpy as np


class CompleteGraphTests(unittest.TestCase):
    def test_long_documents_survive_build_and_long_queries_reach_native_provider(self):
        with tempfile.TemporaryDirectory(prefix='complete-graph-') as directory:
            root = Path(directory)
            description = 'general context ' * 280 + ' PostgreSQL indexes and SQL query execution plans'
            for name in ('database', 'travel'):
                (root/name).mkdir()
                (root/name/'SKILL.md').write_text('---\nname: '+name+'\n---\nComplete original package.')
            catalog = root/'catalog.json'
            catalog.write_text(json.dumps({'skills':[
                {'name':'database','dir':'database','description':description},
                {'name':'travel','dir':'travel','description':'Book hotels and plan a Tokyo trip'}]}))
            output = root/'graph.json'
            result = subprocess.run([sys.executable, str(ENTRY), 'build', '--root', str(root),
                '--catalog', str(catalog), '--output', str(output), '--embedding',
                '--chinese-embedding', 'paraphrase-multilingual-MiniLM-L12-v2'],
                capture_output=True, text=True, timeout=120)
            self.assertEqual(result.returncode, 0, result.stdout+result.stderr)
            built = json.loads(output.read_text())
            self.assertEqual(built['metadata']['embedding_representation'], REPRESENTATION)
            self.assertIn(description, [tool['description'] for tool in built['tools'].values()])
            worker = indexer._GraphWorker(output)
            worker._load_if_stale()
            results = worker.query({'query':'SQL PostgreSQL execution plans', 'top_k':2})
            self.assertTrue(results)
            english = worker._english_graph._get_retrieval_engine()._embedding_index
            chinese = worker._graph._get_retrieval_engine()._embedding_index
            prefix = 'general context '*160
            texts = [prefix+' SQL indexes '*30, prefix+' hotel booking '*30]
            for channel in (english, chinese):
                before, after = [np.asarray(channel.encode(text)) for text in texts]
                self.assertGreater(float(np.linalg.norm(before-after)), .01)
            self.assertEqual(indexer.load_skills(root, catalog)[0][0]['description'], description)
            for language, graph in [('en', worker._english_graph), ('zh', worker._graph)]:
                precomputed = indexer.load_description_embeddings(graph, output, language)
                channel = english if language == 'en' else chinese
                model = channel._provider._provider._get_model()
                expected = encode_complete(model, [description])[0]
                np.testing.assert_allclose(precomputed[description], expected, rtol=3e-4, atol=3e-5)
                for identifier, tool in graph.tools.items():
                    expected = encode_complete(model, [indexer.retrieval_tool_text(tool)])[0]
                    np.testing.assert_allclose(channel._embeddings[identifier], expected,
                                               rtol=3e-4, atol=3e-5)


if __name__ == '__main__':
    unittest.main()
