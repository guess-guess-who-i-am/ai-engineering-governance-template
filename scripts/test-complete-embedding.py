#!/usr/bin/env python3
"""Real local-encoder checks for complete input coverage and retained tails."""
import os
from pathlib import Path
import sys
import unittest

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
for key in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
    os.environ[key] = '1'
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'codex-profile/mac/hooks'))

import numpy as np
import torch
from sentence_transformers import SentenceTransformer
from complete_embedding import encode_complete, complete_provider


class CompleteEmbeddingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(1)
        cls.model = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2',
                                       device='cpu', local_files_only=True)

    def test_short_inputs_preserve_original_normalized_vectors(self):
        texts = ['PostgreSQL execution plans and indexes', '检查网页的布局和交互', '']
        before = self.model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        after = encode_complete(self.model, texts)
        np.testing.assert_allclose(before, after, atol=2e-6, rtol=2e-5)

    def test_tail_changes_vector_when_old_prefix_truncation_cannot_see_it(self):
        prefix = 'general context ' * 160
        texts = [prefix+' PostgreSQL indexes query execution '*20,
                 prefix+' hotel booking Tokyo travel '*20]
        before = self.model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        np.testing.assert_allclose(before[0], before[1], atol=2e-6)
        after = encode_complete(self.model, texts)
        self.assertGreater(float(np.linalg.norm(after[0]-after[1])), .01)

    def test_all_source_tokens_covered_with_bounded_model_windows(self):
        texts = ['short', '数据库执行计划 ' * 300, 'a '+('b '*127)+'TAIL']
        audit = {}
        matrix = encode_complete(self.model, texts, batch_size=2, audit=audit)
        expected = sum(len(ids) for ids in self.model.tokenizer(
            texts, add_special_tokens=False, truncation=False)['input_ids'])
        self.assertEqual(audit['coveredTokens'], expected)
        self.assertEqual(audit['sourceTokens'], expected)
        self.assertLessEqual(audit['maxChunkTokens'], self.model.max_seq_length)
        self.assertEqual(audit['documents'], len(texts))
        self.assertGreater(audit['chunks'], len(texts))
        np.testing.assert_allclose(np.linalg.norm(matrix, axis=1), 1, atol=2e-6)

    def test_batch_partition_does_not_change_document_identity_or_vectors(self):
        texts = ['query plans '*140, '旅游住宿', '日常计划 '*90]
        one = encode_complete(self.model, texts, batch_size=1)
        many = encode_complete(self.model, texts, batch_size=8)
        np.testing.assert_allclose(one, many, atol=2e-6, rtol=2e-5)

    def test_empty_corpus_has_valid_shape(self):
        result = encode_complete(self.model, [])
        self.assertEqual(result.shape, (0, self.model.get_sentence_embedding_dimension()))

    def test_native_provider_encodes_tail_without_changing_serialized_identity(self):
        from graph_tool_call.retrieval.embedding import SentenceTransformerProvider
        provider = SentenceTransformerProvider('paraphrase-multilingual-MiniLM-L12-v2')
        provider._model = self.model
        self.assertIs(complete_provider(provider), provider)
        method = provider.encode_batch
        self.assertIs(complete_provider(provider).encode_batch, method)
        self.assertIsInstance(provider, SentenceTransformerProvider)
        self.assertEqual(provider.model_name, 'paraphrase-multilingual-MiniLM-L12-v2')
        texts = ['general context '*160+'SQL indexes '*30,
                 'general context '*160+'hotel booking '*30]
        np.testing.assert_allclose(provider.encode_batch(texts), encode_complete(self.model, texts), atol=2e-6)
        self.assertGreater(np.linalg.norm(np.asarray(provider.encode(texts[0]))-provider.encode(texts[1])), .01)


if __name__ == '__main__':
    unittest.main()
