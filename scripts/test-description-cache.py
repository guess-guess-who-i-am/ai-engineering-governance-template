#!/usr/bin/env python3
"""Bounded-memory verification of real NumPy reranking cache files."""
import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path
import tempfile
import tracemalloc
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'codex-profile/mac/hooks'))
os.environ['HF_HUB_OFFLINE']='1'
os.environ['TRANSFORMERS_OFFLINE']='1'
spec = importlib.util.spec_from_file_location('description_cache', os.environ.get('DESCRIPTION_INDEXER',str(ROOT/'codex-profile/mac/hooks/graph_skill_index.py')))
indexer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(indexer)


class DescriptionCacheTests(unittest.TestCase):
    def fixture(self, root):
        # One long description pads every row in NumPy's native Unicode dtype.
        texts = ['完整说明: ' + '医学 evidence ' * 1800] + [f'完整资源 {n}' for n in range(511)]
        graph = SimpleNamespace(tools={str(n): SimpleNamespace(description=t) for n,t in enumerate(texts)}, metadata={})
        output = root/'graph.json'
        vectors = np.random.default_rng(17).normal(size=(len(texts),384)).astype(np.float32)
        with patch('graph_tool_call.retrieval.embedding.SentenceTransformerProvider._get_model', return_value=None), patch('complete_embedding.encode_complete', return_value=vectors):
            config = indexer.build_description_embeddings(graph, output, 'encoder')
        target = output.parent/config['file']
        graph.metadata['description_embeddings']={'en':config}
        return graph, output, target, texts, vectors

    def test_skewed_lengths_load_with_bounded_memory_and_exact_vectors(self):
        with tempfile.TemporaryDirectory() as directory:
            graph,output,target,texts,vectors=self.fixture(Path(directory))
            with zipfile.ZipFile(target) as archive:
                self.assertLess(archive.getinfo('texts.npy').file_size, 1024*1024, 'one long row must not pad every other row on disk')
            tracemalloc.start()
            try:
                actual=indexer.load_description_embeddings(graph,output,'en')
                _,peak=tracemalloc.get_traced_memory()
            finally:
                tracemalloc.stop()
            self.assertEqual(list(actual),texts)
            np.testing.assert_array_equal(np.asarray(list(actual.values())),vectors)
            self.assertLess(peak,8*1024*1024,'loading one long description must not allocate the entire padded text column')

    def test_changed_text_with_valid_file_checksum_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            graph,output,target,texts,vectors=self.fixture(Path(directory))
            texts[-1]='错误内容'
            signature=graph.metadata['description_embeddings']['en']['signature']
            with np.load(target, allow_pickle=False) as cached:
                stored=cached['texts']
            if stored.dtype.kind == 'U':
                stored=np.asarray(texts)
            else:
                stored=np.frombuffer(json.dumps(texts,ensure_ascii=False).encode('utf-8'),dtype=np.uint8)
            np.savez_compressed(target,texts=stored,vectors=vectors,signature=signature)
            graph.metadata['description_embeddings']['en']['sha256']=hashlib.sha256(target.read_bytes()).hexdigest()
            with self.assertRaisesRegex(ValueError,'text identity mismatch'):
                indexer.load_description_embeddings(graph,output,'en')

if __name__=='__main__':unittest.main()
