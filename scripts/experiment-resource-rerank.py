#!/usr/bin/env python3
"""Offline diagnostic: hybrid candidates followed by a pinned multilingual model.

Never changes global graph, hooks, packages or auth. Identity labels are consumed
only after ranking. Runtime costs and failures remain in the report.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import statistics
import time

os.environ.setdefault('HF_HUB_OFFLINE', '1')
os.environ.setdefault('TRANSFORMERS_OFFLINE', '1')
os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')
os.environ.setdefault('OMP_NUM_THREADS', '1')
ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--graph', type=Path, default=Path.home() / '.codex/skill-registry/skills.graph.json')
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--cases', type=Path, nargs='+', default=[ROOT / 'scripts/resource-retrieval-holdout.json'])
    parser.add_argument('--depth', type=int, default=32, choices=[16, 32, 64])
    parser.add_argument('--limit', type=int, default=0)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    import numpy as np
    import torch
    from sentence_transformers import CrossEncoder
    torch.set_num_threads(1)
    spec = importlib.util.spec_from_file_location('rank_probe_indexer', ROOT / 'codex-profile/mac/hooks/graph_skill_index.py')
    indexer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(indexer)
    began = time.perf_counter()
    worker = indexer._GraphWorker(args.graph)
    worker._load_if_stale()
    channels = {'en': worker._english_graph, 'zh': worker._graph}
    names = list(worker._graph.tools)
    matrices = {}
    for lang, channel in channels.items():
        cache = channel._get_retrieval_engine()._embedding_index._provider._precomputed
        vectors = np.asarray([cache[channel.tools[name].description] for name in names], dtype=np.float32)
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        matrices[lang] = vectors / np.maximum(norms, 1e-12)
    model = CrossEncoder(str(args.model), max_length=256, device='cpu', local_files_only=True)
    model.predict([['find a document', 'Search relevant documentation.']], show_progress_bar=False)
    startup = time.perf_counter() - began
    tools = worker._graph.tools

    def identity(name):
        node = tools[name]
        return {'toolId': name, 'name': node.metadata.get('skill_name', node.metadata.get('mcp_original_name', name)),
                'kind': node.metadata.get('kind', 'skill'), 'moduleId': node.metadata.get('module_id')}

    def raw_rank(query, lang):
        engine = channels[lang]._get_retrieval_engine()
        # Query-selected lexical language plus full multilingual semantic corpus.
        sources = [[name for name, _ in sorted(engine._get_bm25().score(query).items(), key=lambda row: (-row[1], row[0]))[:100]]]
        for semantic_lang in (['en', 'zh'] if lang == 'en' else ['zh']):
            embedding = channels[semantic_lang]._get_retrieval_engine()._embedding_index
            q = np.asarray(embedding.encode(query), dtype=np.float32)
            q /= max(float(np.linalg.norm(q)), 1e-12)
            similarities = matrices[semantic_lang] @ q
            order = np.argsort(-similarities, kind='stable')[:100]
            sources.append([names[i] for i in order])
        scores = {}
        for source in sources:
            for rank, name in enumerate(source, 1):
                scores[name] = scores.get(name, 0) + 1 / (60 + rank)
        return sorted(scores, key=lambda name: (-scores[name], name))

    rows = []
    for file in args.cases:
        cases = json.loads(file.read_text())['cases']
        if args.limit:
            cases = cases[:args.limit]
        for case in cases:
            kind = case.get('kind')
            if kind is None:
                kind = {'expert-required': 'expert', 'bounded-skill': 'skill',
                        'bounded-tool': 'mcp-service'}[case['split']]
            for lang in ('en', 'zh'):
                query = case[lang]
                began = time.perf_counter()
                ranked = raw_rank(query, lang)
                pool_ms = (time.perf_counter() - began) * 1000
                selected = ranked[:args.depth]
                pairs = [[query, identity(name)['name'] + '. ' + tools[name].description[:2400]] for name in selected]
                began = time.perf_counter()
                values = model.predict(pairs, batch_size=8, show_progress_bar=False)
                rerank_ms = (time.perf_counter() - began) * 1000
                reranked = sorted(zip(selected, map(float, values)), key=lambda row: (-row[1], row[0]))
                def relevant(name):
                    item = identity(name)
                    return item['kind'] == kind and item['name'] in case['targets']
                row = {'set': file.name, 'case': case['id'], 'language': lang, 'kind': kind, 'query': query,
                       'expected': case['targets'], 'poolMs': round(pool_ms, 3), 'rerankMs': round(rerank_ms, 3),
                       'hybridRank': next((i + 1 for i, name in enumerate(ranked) if relevant(name)), None),
                       'rank': next((i + 1 for i, (name, _) in enumerate(reranked) if relevant(name)), None),
                       'returned': [{**identity(name), 'score': value, 'description': tools[name].description[:1000]} for name, value in reranked[:8]],
                       'candidateIds': selected}
                rows.append(row)
                print(json.dumps({key: row[key] for key in ['set', 'case', 'language', 'hybridRank', 'rank', 'poolMs', 'rerankMs']}), flush=True)
    summary = []
    for file in args.cases:
        for lang in ('en', 'zh'):
            chosen = [row for row in rows if row['set'] == file.name and row['language'] == lang]
            summary.append({'set': file.name, 'language': lang, 'n': len(chosen),
                'top4': sum(row['rank'] is not None and row['rank'] <= 4 for row in chosen),
                'top8': sum(row['rank'] is not None and row['rank'] <= 8 for row in chosen),
                'poolRecall': sum(row['hybridRank'] is not None and row['hybridRank'] <= args.depth for row in chosen),
                'medianPoolMs': round(statistics.median(row['poolMs'] for row in chosen), 3),
                'medianRerankMs': round(statistics.median(row['rerankMs'] for row in chosen), 3)})
    report = {'schemaVersion': 'resource-rerank-diagnostic/1', 'graphSha256': hashlib.sha256(args.graph.read_bytes()).hexdigest(),
              'casesSha256': {str(file): hashlib.sha256(file.read_bytes()).hexdigest() for file in args.cases},
              'model': str(args.model), 'depth': args.depth, 'startupSeconds': round(startup, 3), 'rows': rows, 'summary': summary,
              'productionChanged': False, 'paidCalls': 0,
              'limitations': ['Diagnostic identity recall, not business accuracy; equivalent alternatives may be valid',
                             'One pass, no claim of a controlled latency speedup or independent held-out result',
                             'All original module and production graph bytes remain unchanged']}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'report': str(args.report), 'summary': summary}), flush=True)


if __name__ == '__main__':
    main()
