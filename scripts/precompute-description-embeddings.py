#!/usr/bin/env python3
"""Upgrade an existing graph with offline reranking vectors; keep graph scores."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--graph', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    spec = importlib.util.spec_from_file_location('description_indexer', root / 'codex-profile/mac/hooks/graph_skill_index.py')
    indexer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(indexer)
    original = args.graph.read_bytes()
    graph = json.loads(original)
    chinese = graph['metadata']['chinese_embedding']['model']

    def build(language):
        tools = {name: SimpleNamespace(description=(indexer.english_retrieval_description(
            SimpleNamespace(description=tool['description'], metadata=tool.get('metadata', {})))
            if language == 'en' else tool['description'])) for name, tool in graph['tools'].items()}
        model = 'sentence-transformers/all-MiniLM-L6-v2' if language == 'en' else chinese
        config = indexer.build_description_embeddings(SimpleNamespace(tools=tools), args.graph, model)
        return language, config

    # Independent language encodes can overlap; each writes a distinct sidecar.
    with ThreadPoolExecutor(max_workers=2) as pool:
        configs = dict(pool.map(build, ['en', 'zh']))
    if hashlib.sha256(args.graph.read_bytes()).digest() != hashlib.sha256(original).digest():
        raise RuntimeError('Graph changed during precompute; refusing to replace it')
    graph['metadata']['description_embeddings'] = configs
    temporary = args.graph.with_suffix(f'.{os.getpid()}.tmp')
    temporary.write_text(json.dumps(graph, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.chmod(args.graph.stat().st_mode & 0o777)
    temporary.replace(args.graph)
    print(json.dumps({'ready': True, 'languages': list(configs), 'descriptionEmbeddings': configs,
                      'graphSha256': hashlib.sha256(args.graph.read_bytes()).hexdigest()}))


if __name__ == '__main__':
    main()
