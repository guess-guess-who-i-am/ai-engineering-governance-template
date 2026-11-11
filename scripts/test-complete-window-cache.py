#!/usr/bin/env python3
"""Real CPU encoder: full-token window reuse and bounded, provider-local state."""
import os,sys,time,unittest
from pathlib import Path
from collections import OrderedDict
for key in ('HF_HUB_OFFLINE','TRANSFORMERS_OFFLINE'):os.environ[key]='1'
for key in ('OMP_NUM_THREADS','MKL_NUM_THREADS','OPENBLAS_NUM_THREADS'):os.environ[key]='1'
os.environ['TOKENIZERS_PARALLELISM']='false'
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'codex-profile/mac/hooks'))
from complete_embedding import complete_provider,encode_complete
import numpy as np
import torch
from sentence_transformers import SentenceTransformer
from types import SimpleNamespace

class WindowCacheTests(unittest.TestCase):
 def test_real_bilingual_models_preserve_full_token_vectors_and_changed_tails(self):
  torch.set_num_threads(1)
  for name in ['sentence-transformers/all-MiniLM-L6-v2','paraphrase-multilingual-MiniLM-L12-v2']:
   with self.subTest(model=name):
    model=SentenceTransformer(name,device='cpu');cache=OrderedDict()
    prefix='搜索文件 debug performance context '*90
    texts=[prefix+'SQL indexes 001',prefix+'hotel travel 002',prefix+'SQL indexes 003']
    expected=encode_complete(model,texts)
    rows=[];new_rows=[];forward=model.forward
    def traced(features,**kwargs):new_rows.append(features['input_ids'].shape[0]);return forward(features,**kwargs)
    model.forward=traced
    audit={}
    for text in texts:rows.append(encode_complete(model,[text],audit=audit,window_cache=cache)[0])
    np.testing.assert_allclose(rows,expected,rtol=2e-5,atol=2e-6)
    self.assertGreater(float(np.linalg.norm(rows[0]-rows[1])),1e-4)
    self.assertEqual(audit['sourceTokens'],audit['coveredTokens'])
    self.assertLess(sum(new_rows),audit['chunks']*2)
    count=len(new_rows);encode_complete(model,[texts[-1]],window_cache=cache);self.assertEqual(len(new_rows),count)
    self.assertLessEqual(len(cache),512)
    # Eviction must alter work only; no window is discarded from the output.
    for i in range(520):cache[(0,(i,))]=np.zeros(384,dtype=np.float32)
    actual=encode_complete(model,[texts[0]],window_cache=cache)[0]
    np.testing.assert_allclose(actual,expected[0],rtol=2e-5,atol=2e-6)
    self.assertLessEqual(len(cache),512)
 def test_providers_do_not_share_model_window_caches(self):
  providers=[SimpleNamespace(_get_model=lambda:None) for _ in range(2)]
  for provider in providers:complete_provider(provider,cache_windows=True)
  self.assertIsNot(providers[0]._complete_window_cache,providers[1]._complete_window_cache)
if __name__=='__main__':unittest.main()
