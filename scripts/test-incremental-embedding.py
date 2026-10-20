"""No network/model inference: verify vector invalidation with the real index."""
import importlib.util
import os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from graph_tool_call.retrieval.embedding import EmbeddingIndex

source=Path(os.environ.get('CODEX_HOME',str(Path.home()/'.codex')))/'hooks/graph_skill_index.py'
spec=importlib.util.spec_from_file_location('profile_index',source)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Provider:
    model_name=module.EMBEDDING_MODEL
    def __init__(self,*args):
        self.calls=[]
    def encode_batch(self,texts):
        self.calls.append(list(texts))
        return [[float(len(text)),1.0] for text in texts]

def tool(name,description):
    return SimpleNamespace(name=name,description=description,tags=[],parameters=[],metadata={})

class Graph:
    def __init__(self,tools):
        self.tools=tools
        self.engine=SimpleNamespace(_embedding_index=None)
        self.engine.set_embedding_index=lambda index:setattr(self.engine,'_embedding_index',index)
    def _get_retrieval_engine(self):
        return self.engine
    def tune_for_scale(self):
        pass

with patch('graph_tool_call.retrieval.embedding.SentenceTransformerProvider',Provider):
    first=Graph({'a':tool('a','first'),'b':tool('b','second')})
    assert module.attach_embedding_index(first)=={'reusedVectors':0,'encodedVectors':2}
    same=Graph({'a':tool('a','first'),'b':tool('b','second')})
    assert module.attach_embedding_index(same,first,module.EMBEDDING_MODEL)=={'reusedVectors':2,'encodedVectors':0}
    changed=Graph({'a':tool('a','changed'),'c':tool('c','new')})
    assert module.attach_embedding_index(changed,first,module.EMBEDDING_MODEL)=={'reusedVectors':0,'encodedVectors':2}
    assert 'b' not in changed.engine._embedding_index._embeddings
    assert module.attach_embedding_index(Graph(first.tools),first,'other-model')=={'reusedVectors':0,'encodedVectors':2}
print('PASS: unchanged vectors reused; changed, added, deleted and model-space changes handled explicitly.')
