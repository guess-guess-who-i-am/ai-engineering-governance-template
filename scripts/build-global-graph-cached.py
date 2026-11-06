#!/usr/bin/env python3
"""Build with the installed indexer, reusing verified exact-text source vectors.

No path rewriting, fabricated manifests or alternate retrieval implementation.
The normal builder still creates local identities, edges, signatures and files.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import time
from types import SimpleNamespace


def digest(file):
    h = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source-graph', type=Path, required=True)
    p.add_argument('--source-sha256', required=True)
    p.add_argument('--codex-root', type=Path, default=Path.home() / '.codex')
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--hooks', type=Path, help='Candidate hook sources, separate from production')
    p.add_argument('--report', type=Path, required=True)
    a = p.parse_args()
    if a.output.name != 'skills.graph.json' or a.output.parent == a.codex_root / 'skill-registry':
        p.error('Output must be skills.graph.json in a separate candidate directory')
    if digest(a.source_graph) != a.source_sha256:
        raise ValueError('Source graph checksum mismatch')
    hooks = a.hooks.resolve() if a.hooks else a.codex_root / 'hooks'
    hook_names = ['graph_skill_index.py', 'artifact_relations.py', 'complete_embedding.py', 'skill-retrieval.zh.json',
                  'mcp-retrieval.zh.json', 'registry-inputs.mjs', 'refresh-skill-registry.mjs',
                  'skill-router.mjs']
    # Pin executable bytes before importing them, rather than after loading the
    # large source cache. A concurrent installer must invalidate this candidate.
    imported_sources = {str(hooks / name): digest(hooks / name) for name in hook_names}
    sys.path.insert(0, str(hooks))
    spec = importlib.util.spec_from_file_location('installed_indexer', hooks / 'graph_skill_index.py')
    indexer = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = indexer
    spec.loader.exec_module(indexer)
    import numpy as np
    import complete_embedding as complete
    from graph_tool_call import ToolGraph
    from graph_tool_call.retrieval.embedding import SentenceTransformerProvider

    began = time.monotonic()
    source = ToolGraph.load(str(a.source_graph))
    if source.metadata.get('embedding_representation') != complete.REPRESENTATION:
        raise ValueError('Source encoding representation mismatch')
    cache, stats = {}, []

    def add(model, texts, vectors):
        matrix = np.asarray(vectors, dtype=np.float32)
        if matrix.shape != (len(texts), 384) or not np.isfinite(matrix).all():
            raise ValueError('Invalid source vector shape or non-finite value')
        if not np.allclose(np.linalg.norm(matrix, axis=1), 1, atol=1e-4):
            raise ValueError('Source vectors are not normalized')
        bucket = cache.setdefault(model, {})
        for text, vector in zip(texts, matrix):
            if text in bucket and not np.allclose(bucket[text], vector, atol=1e-5):
                raise ValueError('Conflicting exact-text source embeddings')
            bucket[text] = vector

    english = indexer.english_retrieval_graph(source)
    state = json.loads(a.source_graph.read_text())['retrieval_state']['embedding_index']
    # Provider model identity is part of the native persisted embedding state.
    provider = state.get('provider', {})
    model = provider.get('model_name') or state.get('model_name')
    if model != 'sentence-transformers/all-MiniLM-L6-v2':
        raise ValueError('Unverified source English model identity: ' + str(provider))
    vectors = state['embeddings']
    if set(vectors) != set(english.tools):
        raise ValueError('Source English vector coverage mismatch')
    add(model, [indexer.retrieval_tool_text(english.tools[n]) for n in english.tools],
        [vectors[n] for n in english.tools])
    del state, vectors, english
    configs = [source.metadata['chinese_embedding'],
               *source.metadata['description_embeddings'].values()]
    for config in configs:
        relative = Path(config['file'])
        if relative.name != str(relative) or config.get('representation') != complete.REPRESENTATION:
            raise ValueError('Invalid source sidecar identity')
        file = a.source_graph.parent / relative
        if digest(file) != config['sha256']:
            raise ValueError('Source sidecar checksum mismatch: ' + str(relative))
        with np.load(file, allow_pickle=False) as data:
            if str(data['signature']) != config['signature']:
                raise ValueError('Source sidecar signature mismatch')
            if 'names' in data:
                names = list(data['names'])
                if names != list(source.tools):
                    raise ValueError('Source Chinese vector coverage mismatch')
                texts = [indexer.retrieval_tool_text(source.tools[n]) for n in names]
            else:
                texts = list(data['texts'])
                view = (indexer.english_retrieval_graph(source)
                        if config['model'] == model else source)
                expected = list(dict.fromkeys(t.description for t in view.tools.values() if t.description))
                if texts != expected:
                    raise ValueError('Source description vector coverage mismatch')
            add(config['model'], texts, data['vectors'])
    del source
    original_get_model = SentenceTransformerProvider._get_model
    original_encode = complete.encode_complete

    class CachedModel:
        def __init__(self, provider):
            self.provider = provider

    def encode(cached_model, texts, batch_size=64, audit=None):
        if not isinstance(cached_model, CachedModel):
            return original_encode(cached_model, texts, batch_size=batch_size, audit=audit)
        if audit is not None:
            raise ValueError('Token audit requires fresh encoding; cached vectors are not token evidence')
        provider = cached_model.provider
        bucket = cache.setdefault(provider.model_name, {})
        missing = list(dict.fromkeys(text for text in texts if text not in bucket))
        start = time.monotonic()
        if missing:
            fresh = original_encode(original_get_model(provider), missing, batch_size=batch_size)
            add(provider.model_name, missing, fresh)
        stats.append({'model': provider.model_name, 'documents': len(texts),
                      'newUniqueTexts': len(missing), 'seconds': round(time.monotonic() - start, 4)})
        return np.asarray([bucket[text] for text in texts], dtype=np.float32)

    SentenceTransformerProvider._get_model = lambda provider: CachedModel(provider)
    complete.encode_complete = encode
    config_file = a.codex_root / 'skill-registry/external-library-config.json'
    config = json.loads(config_file.read_text())
    registry = a.codex_root / 'skill-registry'
    inputs = [config_file, Path(config['catalog']), registry / 'mcp-tools.json',
              registry / 'resource-modules.json', *sorted((Path.home() / '.agents/skills').glob('*/SKILL.md')),
              *[hooks / name for name in hook_names]]
    before = {str(file): digest(file) for file in inputs}
    if any(before[file] != expected for file, expected in imported_sources.items()):
        raise ValueError('Indexer sources changed after import')
    stage_hooks = a.output.parent / 'hooks'
    stage_hooks.mkdir(parents=True, exist_ok=True)
    for name in hook_names:
        shutil.copy2(hooks / name, stage_hooks / name)
    indexer.build(SimpleNamespace(root=config['root'], catalog=config['catalog'],
        output=str(a.output), owned_root=str(Path.home() / '.agents/skills'),
        mcp_catalog=str(a.codex_root / 'skill-registry/mcp-tools.json'),
        resource_catalog=str(a.codex_root / 'skill-registry/resource-modules.json'),
        require_complete=True, embedding=True, chinese_embedding=config['chineseEmbedding']))
    if before != {str(file): digest(file) for file in inputs}:
        raise ValueError('Inputs changed during build; refusing publication receipt')
    built = json.loads(a.output.read_text())
    # Source declarations are graph inputs even though retrieval never reads
    # package bodies. Refuse publication if any changed after extraction.
    relation_sources = built['metadata'].get('artifact_relation_sources', {})
    if any(digest(file) != expected for file, expected in relation_sources.items()):
        raise ValueError('Artifact declaration source changed during build')
    before.update(relation_sources)
    files = [a.output, a.output.with_suffix('.manifest.json'), *stage_hooks.iterdir()]
    files += [a.output.parent / built['metadata']['chinese_embedding']['file']]
    files += [a.output.parent / x['file'] for x in built['metadata']['description_embeddings'].values()]
    build_report = {'schemaVersion': 'resource-graph-candidate/1',
                    'resourceModuleCount': built['metadata']['resource_module_count'],
                    'graphNodeCount': len(built['tools']), 'inputsSha256': before,
                    'publishFiles': {str(file): digest(file) for file in files}}
    (a.output.parent / 'build-report.json').write_text(json.dumps(build_report, indent=2) + '\n')
    report = {'schemaVersion': 'exact-text-vector-reuse/1', 'sourceSha256': a.source_sha256,
              'graphSha256': digest(a.output), 'seconds': round(time.monotonic() - began, 3),
              'encoding': stats, 'localIndexerUsed': True, 'sourceGraphUnchanged': digest(a.source_graph) == a.source_sha256}
    a.report.parent.mkdir(parents=True, exist_ok=True)
    a.report.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
