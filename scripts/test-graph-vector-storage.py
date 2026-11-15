"""Keep native similarity and MMR vectors while removing boxed-float storage."""
import sys,unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'codex-profile/mac/hooks'))
import graph_skill_index as indexer
from graph_tool_call.retrieval.embedding import EmbeddingIndex

class StorageTests(unittest.TestCase):
 def test_search_and_raw_vectors_are_exact_with_smaller_storage(self):
  rng=np.random.default_rng(17)
  source=rng.normal(size=(1024,384)).astype(np.float32)
  index=EmbeddingIndex();index._embeddings={str(i):row.tolist() for i,row in enumerate(source)}
  query=source[8].tolist();before=index.search(query,50)
  boxed=sum(sys.getsizeof(v)+sum(map(sys.getsizeof,v)) for v in index._embeddings.values())
  indexer.compact_embedding_storage(index)
  self.assertEqual(index.search(query,50),before)
  np.testing.assert_array_equal(np.stack(list(index._embeddings.values())),source)
  first=next(iter(index._embeddings.values()))
  self.assertFalse(first.flags.writeable)
  self.assertLess(first.base.nbytes,boxed/4)
  indexer.compact_embedding_storage(index)
  self.assertIs(next(iter(index._embeddings.values())),first)
 def test_empty_index_is_usable(self):
  index=EmbeddingIndex();indexer.compact_embedding_storage(index)
  self.assertEqual(index.search([1,0],2),[])

if __name__=='__main__': unittest.main()
