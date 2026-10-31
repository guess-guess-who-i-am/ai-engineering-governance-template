#!/usr/bin/env python3
"""Runtime staging cannot silently accept graph/build or unrelated edits."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('revalidation', Path(__file__).with_name('revalidate-resource-runtime.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

BASE = '''
def graph_from_records(records):
    return records
def build(args):
    return graph_from_records(args)
class _GraphWorker:
    def _load_if_stale(self):
        if self.ready:
            engine = self.graph
            return engine
    def query(self, payload):
        return payload
'''


class RuntimeASTTests(unittest.TestCase):
    def digest(self, source):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'indexer.py'
            file.write_text(source)
            return MODULE.normalized_ast(file)

    def test_only_named_helpers_and_initialization_calls_are_ignored(self):
        for helper in MODULE.RUNTIME_HELPERS:
            source = f'def {helper}(engine):\n    return engine\n' + BASE.replace('            return engine', f'            {helper}(engine)\n            return engine')
            self.assertEqual(self.digest(BASE), self.digest(source))

    def test_builders_outputs_tokenizers_and_query_semantics_are_protected(self):
        variants = [BASE.replace('return records', 'return records[:1]'),
                    BASE.replace('return graph_from_records(args)', 'return []'),
                    BASE.replace('return payload', 'return {}'),
                    BASE + '\ndef unexpected_helper(engine):\n    return []\n',
                    BASE.replace('            return engine', '            engine = None\n            return engine')]
        for source in variants:
            self.assertNotEqual(self.digest(BASE), self.digest(source))

    def test_helper_calls_outside_worker_initialization_are_not_ignored(self):
        for helper in MODULE.RUNTIME_HELPERS:
            source = BASE.replace('return records', f'{helper}(records)\n    return records')
            self.assertNotEqual(self.digest(BASE), self.digest(source))

    def test_only_the_exact_english_engine_alias_is_normalized(self):
        original = BASE.replace('            return engine', '            english_provider = self._english_graph._get_retrieval_engine()._embedding_index\n            return engine')
        alias = original.replace('            english_provider = self._english_graph._get_retrieval_engine()._embedding_index',
            '            english_engine = self._english_graph._get_retrieval_engine()\n            english_provider = english_engine._embedding_index')
        self.assertEqual(self.digest(original), self.digest(alias))
        self.assertNotEqual(self.digest(original), self.digest(alias.replace('english_engine = self._english_graph', 'english_engine = self._other_graph')))
        self.assertNotEqual(self.digest(original), self.digest(alias.replace('return engine', 'return english_engine')))


if __name__ == '__main__':
    unittest.main()
