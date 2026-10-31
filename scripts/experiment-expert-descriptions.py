#!/usr/bin/env python3
"""Isolate source-grounded expert descriptions in a full, offline graph copy.

Preserve all non-expert vectors, graph edges, scoring and category quotas.
This is a diagnostic builder, not a production publisher.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import time

for key in ('HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE'):
    os.environ[key] = '1'
for key in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
    os.environ[key] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--graph', type=Path, default=Path.home()/'.codex/skill-registry/skills.graph.json')
    parser.add_argument('--sources', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--mode', choices=['primary', 'primary-intro', 'scoped-aliases', 'source-labels', 'translated', 'translated-aliases', 'translated-examples', 'native-examples', 'native-queries', 'source-generated'], required=True)
    parser.add_argument('--translations', type=Path)
    parser.add_argument('--omit-expert-id', action='store_true')
    args = parser.parse_args()
    import numpy as np
    from graph_tool_call.retrieval.embedding import SentenceTransformerProvider
    began = time.perf_counter()
    graph = json.loads(args.graph.read_text())
    source = {row['id']: row for row in json.loads(args.sources.read_text()) if not row.get('error')}
    translations = {row['id']: row for row in json.loads(args.translations.read_text())} if args.translations else {}
    descriptions = {}
    for name, tool in graph['tools'].items():
        row = source.get(tool['metadata'].get('module_id'))
        if row is None:
            continue
        parts = [row['primary']]
        if args.mode == 'primary-intro' and row['intro'] not in parts:
            parts.append(row['intro'])
        original = '\n\n'.join(part for part in parts if part)
        chinese = row['name']+' '+original
        if args.mode in ('scoped-aliases', 'translated-aliases', 'source-labels'):
            original = '\n\n'.join(filter(None, [row['primary'], row['aliases_en']]))
            chinese = '\n\n'.join(filter(None, [row['name']+' '+row['aliases_zh'], row['primary'], row['aliases_en']]))
        if args.mode == 'source-labels':
            original = '\n\n'.join(filter(None, [row['primary'], row['labels_en']]))
            chinese = '\n\n'.join(filter(None, [row['name']+' '+row['labels_zh'], row['primary'], row['labels_en']]))
        if args.mode.startswith(('translated', 'native')):
            translation = translations[row['id']]
            assert translation['primarySha256'] == row['primarySha256']
            import re
            # A few Han trigger words after a long English scope do not make
            # that whole scope native Chinese. Prefer actual Chinese role prose.
            native = (row['intro'] if re.match(r'^[\u3400-\u9fff]', row['intro']) else
                row['primary'] if re.match(r'^[\u3400-\u9fff]', row['primary']) else translation['translation']) if args.mode.startswith('native') else (
                row['primary'] if re.search(r'[\u3400-\u9fff]', row['primary']) else translation['translation'])
            chinese = row['name']+' '+native
            if args.mode == 'translated-aliases':
                chinese += '\n\n'+row['aliases_zh']
            chinese += '\n\n'+row['primary']
        if args.mode in ('translated-examples', 'native-examples', 'native-queries'):
            original = '\n\n'.join(dict.fromkeys(filter(None, [row['primary'], row['all_en']])))
            chinese = '\n\n'.join(dict.fromkeys(filter(None, [row['name']+' '+native, row['all_zh'], row['primary']])))
        if args.mode == 'native-queries':
            original = '\n\n'.join(dict.fromkeys(filter(None, [row['primary'], row['queries_en'], row['aliases_en']])))
            chinese = '\n\n'.join(dict.fromkeys(filter(None, [row['name']+' '+native, row['queries_zh'], row['aliases_zh'], row['primary']])))
        if args.mode == 'source-generated':
            translation = translations[row['id']]
            assert translation['primarySha256'] == row['primarySha256']
            original = tool['metadata'].get('retrieval_original_description', tool['description'])
            chinese = '\n\n'.join(filter(None, [row['name']+' '+translation['translation'],
                row['primary'], tool['description']]))
        descriptions[name] = (chinese, original)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Resolve old English texts before changing metadata.
    old_english = {name: (tool['description'] if tool['metadata'].get('kind') == 'mcp-service'
        else tool['metadata'].get('retrieval_original_description', tool['description']))
        for name, tool in graph['tools'].items()}
    for name, (description, original) in descriptions.items():
        graph['tools'][name]['description'] = description
        graph['tools'][name]['metadata']['retrieval_original_description'] = original
    models = {}
    def encode(model_name, texts):
        if model_name not in models:
            models[model_name] = SentenceTransformerProvider(model_name)._get_model().to('cpu')
        return models[model_name].encode(texts, batch_size=32, convert_to_numpy=True, show_progress_bar=False)
    def sidecar(kind, model, names, texts, vectors):
        signature = hashlib.sha256(json.dumps([model, names, texts] if kind == 'zh' else [model, texts], ensure_ascii=False).encode()).hexdigest()
        file = args.output.parent/f'{args.output.stem}.{kind}.{signature[:20]}.npz'
        values = {'names': np.asarray(names)} if kind == 'zh' else {'texts': np.asarray(texts)}
        np.savez_compressed(file, **values, vectors=vectors, signature=signature)
        return {'file': file.name, 'model': model, 'signature': signature,
                'sha256': hashlib.sha256(file.read_bytes()).hexdigest()}
    names = list(graph['tools'])
    en_model = 'sentence-transformers/all-MiniLM-L6-v2'
    changed = list(descriptions)
    # Exactly match EmbeddingIndex._tool_text for these parameter-free resources.
    assert all(not graph['tools'][name]['parameters'] for name in changed)
    en_texts = [('' if args.omit_expert_id else name+' ')+descriptions[name][1]+('' if args.omit_expert_id else ' '+' '.join(graph['tools'][name]['tags'])) for name in changed]
    en_vectors = encode(en_model, en_texts)
    embeddings = graph['retrieval_state']['embedding_index']['embeddings']
    for name, vector in zip(changed, en_vectors):
        embeddings[name] = vector.tolist()
    config = graph['metadata']['chinese_embedding']
    zh_model = config['model']
    with np.load(args.graph.parent/config['file'], allow_pickle=False) as data:
        assert list(data['names']) == names
        zh_vectors = data['vectors'].copy()
    zh_texts = [('' if args.omit_expert_id and name in descriptions else name+' ')+graph['tools'][name]['description'] for name in names]
    new_vectors = encode(zh_model, [('' if args.omit_expert_id else name+' ')+descriptions[name][0] for name in changed])
    positions = {name: i for i, name in enumerate(names)}
    for name, vector in zip(changed, new_vectors):
        zh_vectors[positions[name]] = vector
    graph['metadata']['chinese_embedding'] = sidecar('zh', zh_model, names, zh_texts, zh_vectors)
    for language, model in [('en', en_model), ('zh', zh_model)]:
        config = graph['metadata']['description_embeddings'][language]
        with np.load(args.graph.parent/config['file'], allow_pickle=False) as data:
            cache = dict(zip(data['texts'], data['vectors']))
        texts = list(dict.fromkeys((descriptions[name][1 if language == 'en' else 0] if name in descriptions
            else old_english[name] if language == 'en' else tool['description']) for name, tool in graph['tools'].items()))
        missing = [text for text in texts if text not in cache]
        if missing:
            cache.update(zip(missing, encode(model, missing)))
        # Runtime checks this exact 'rerank' content-addressed name.
        graph['metadata']['description_embeddings'][language] = sidecar('rerank', model, names, texts,
            np.asarray([cache[text] for text in texts]))
    args.output.write_text(json.dumps(graph, ensure_ascii=False))
    report = {'mode': args.mode, 'expertsChanged': len(descriptions), 'nodes': len(names),
        'buildSeconds': time.perf_counter()-began, 'graph': str(args.output), 'productionChanged': False,
        'unchangedScoringAndEdges': True, 'originalPackagesWritten': False, 'omitExpertId': args.omit_expert_id}
    args.output.with_suffix('.probe.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
