#!/usr/bin/env python3
"""Offline full-corpus embedding comparison on frozen target-identity queries."""
import os
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
import importlib.util
import json
from pathlib import Path
import statistics
import time
import numpy as np
import torch
from graph_tool_call.retrieval.embedding import EmbeddingIndex, SentenceTransformerProvider

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('cases', ROOT / 'scripts/test-chinese-graph-retrieval.py')
cases = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cases)
indexer = cases.indexer
torch.set_num_threads(4)
worker = indexer._GraphWorker(ROOT / '.reports/retrieval-candidate/skill-registry/skills.graph.json')
graph = worker._load_if_stale()
engine = graph._get_retrieval_engine()
old = engine._embedding_index
snapshot = Path.home() / '.cache/huggingface/hub/models--sentence-transformers--paraphrase-multilingual-MiniLM-L12-v2/snapshots/e8f8c211226b894fcb81acc59f3b34ba3efd5f42'
names = list(graph.tools)
cache = ROOT / '.reports/multilingual-vectors.npz'
provider = SentenceTransformerProvider(str(snapshot))
begun = time.perf_counter()
if cache.exists():
    data = np.load(cache)
    assert list(data['names']) == names, 'Rebuild stale vector cache'
    vectors = data['vectors']
else:
    model = provider._get_model().to('cpu')
    vectors = model.encode([graph.tools[n].name + ' ' + graph.tools[n].description for n in names],
                           batch_size=64, convert_to_numpy=True, show_progress_bar=False)
    np.savez_compressed(cache, names=names, vectors=vectors)
multi = EmbeddingIndex(provider=provider)
for name, vector in zip(names, vectors):
    multi.add(name, vector.tolist())
print(json.dumps({'stage': 'vectors-ready', 'seconds': round(time.perf_counter() - begun, 3), 'count': len(names)}), flush=True)
rows = []
for label, embedding in [('english-model', old), ('multilingual-model', multi)]:
    engine.set_embedding_index(embedding)
    for split, queries in [('dev', cases.CASES), ('paraphrases', cases.HOLDOUT)]:
        for target, en, zh in queries:
            for lang, query in [('en', en), ('zh', zh)]:
                begun = time.perf_counter()
                results = indexer.result_records(graph.retrieve_with_scores(query, top_k=8, max_graph_depth=2))
                returned = [r['name'] for r in results]
                rows.append(dict(model=label, split=split, language=lang, target=target,
                    rank=returned.index(target) + 1 if target in returned else None,
                    ms=round((time.perf_counter() - begun) * 1000, 3)))
    print(json.dumps({'stage': label, 'done': True}), flush=True)
summary = []
for label in ('english-model', 'multilingual-model'):
    for split in ('dev', 'paraphrases'):
        for lang in ('en', 'zh'):
            selected = [r for r in rows if r['model'] == label and r['split'] == split and r['language'] == lang]
            summary.append(dict(model=label, split=split, language=lang, n=len(selected),
                top1=sum(r['rank'] == 1 for r in selected),
                top4=sum(r['rank'] is not None and r['rank'] <= 4 for r in selected),
                top8=sum(r['rank'] is not None for r in selected), medianMs=statistics.median(r['ms'] for r in selected)))
report = dict(schema='multilingual-embedding-comparison/1', summary=summary, rows=rows,
    limitations=['24 hand-labelled governance targets, not general task accuracy',
                 'Chinese bounded pipeline held fixed; English production pipeline unchanged',
                 'fixed order and shared caches; timing is diagnostic, not speedup evidence'])
(ROOT / '.reports/multilingual-embedding-retrieval.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(summary), flush=True)
