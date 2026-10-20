"""Real SQLite, exact retrieval and namespace tests; no network/model download."""
import importlib.util
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import json
import tempfile
from unittest.mock import patch

source = Path(os.environ.get('CODEX_INDEXER_SOURCE', str(Path.home() / '.codex/hooks/graph_skill_index.py')))
spec = importlib.util.spec_from_file_location('description_index', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Provider:
    model_name = module.EMBEDDING_MODEL
    def __init__(self, *args, **kwargs):
        self.calls = []
    def encode_batch(self, texts):
        self.calls.append(list(texts))
        return [[float(len(text)), 0.5] for text in texts]
    def encode(self, text):
        return self.encode_batch([text])[0]

with tempfile.TemporaryDirectory(prefix='description-cache-') as directory:
    file = Path(directory) / 'vectors.sqlite3'
    first_provider = Provider()
    first = module._CachedEmbeddingProvider(first_provider, cache_path=file, descriptions=['first', 'second'])
    assert first._persistent._connection.execute('PRAGMA synchronous').fetchone()[0] == 1
    assert first.encode_batch(['user query', 'first', 'second']) == [[10.0, 0.5], [5.0, 0.5], [6.0, 0.5]]
    second_provider = Provider()
    second = module._CachedEmbeddingProvider(second_provider, cache_path=file, descriptions=['first', 'second'])
    assert second.encode_batch(['different query', 'first', 'second']) == [[15.0, 0.5], [5.0, 0.5], [6.0, 0.5]]
    assert second_provider.calls == [['different query']], 'another process/provider must reuse static descriptors'
    probe = ('import importlib.util,json,sys;'
             's=importlib.util.spec_from_file_location("cache_probe",sys.argv[1]);'
             'm=importlib.util.module_from_spec(s);s.loader.exec_module(m);'
             'c=m._DescriptionVectorCache(sys.argv[2]);'
             'print(json.dumps(c.get_many(["first","second","user query"])));c.close()')
    child = subprocess.run([sys.executable, '-c', probe, str(source), str(file)], capture_output=True, text=True, check=True)
    assert json.loads(child.stdout) == {'first': [5.0, 0.5], 'second': [6.0, 0.5]}, child.stdout
    assert second._persistent.get_many(['user query']) == {}, 'private query vectors must remain RAM-only'
    assert second._persistent.get_many(['changed']) == {}, 'changed descriptions must not alias old ones'
    wrong_model = module._DescriptionVectorCache(file, model='another-model')
    wrong_revision = module._DescriptionVectorCache(file, revision='another-revision')
    assert wrong_model.get_many(['first']) == {}
    assert wrong_revision.get_many(['first']) == {}
    with sqlite3.connect(file) as db:
        db.execute('UPDATE vectors SET vector=? WHERE key=?', (b'bad', second._persistent._key('first')))
    db.close()
    third = module._CachedEmbeddingProvider(Provider(), cache_path=file, descriptions=['first'])
    try:
        third.encode('first')
        raise AssertionError('corrupt cache was accepted')
    except RuntimeError:
        pass

    records = [{'name': name, 'tool_name': name, 'description': description, 'path': '', 'categories': [], 'tags': []}
               for name, description in [('alpha', 'search alpha documents'), ('beta', 'read beta sources'), ('gamma', 'trace gamma failures')]]
    with patch('graph_tool_call.retrieval.embedding.SentenceTransformerProvider', Provider):
        graph = module.graph_from_records(records)
        module.attach_embedding_index(graph)
    engine = graph._get_retrieval_engine()
    provider = engine._embedding_index._provider
    expected = module.result_records(graph.retrieve_with_scores('search alpha sources', top_k=3))
    fresh_file = Path(directory) / 'pipeline.sqlite3'
    cached = module._CachedEmbeddingProvider(provider, cache_path=fresh_file, descriptions=[r['description'] for r in records])
    engine._embedding_index._provider = cached
    assert module.result_records(graph.retrieve_with_scores('search alpha sources', top_k=3)) == expected
    replay_provider = Provider()
    engine._embedding_index._provider = module._CachedEmbeddingProvider(replay_provider, cache_path=fresh_file, descriptions=[r['description'] for r in records])
    assert module.result_records(graph.retrieve_with_scores('search alpha sources', top_k=3)) == expected
    assert replay_provider.calls == [['search alpha sources']], replay_provider.calls
    for owner in [first, second, third, cached, engine._embedding_index._provider, wrong_model, wrong_revision]:
        owner.close()
print('PASS: SQLite sharing, RAM-only private queries, text/model/revision invalidation, corrupt rejection and identical real retrieval.')
