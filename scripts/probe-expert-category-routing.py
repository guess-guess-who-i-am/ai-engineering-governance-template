#!/usr/bin/env python3
"""Isolated full-graph diagnostic; never modify the deployed graph or worker."""
import importlib.util
import json
import os
from pathlib import Path
import time
import re
import sys

for key in ('HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE'):
    os.environ[key] = '1'
for key in ('OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'OPENBLAS_NUM_THREADS'):
    os.environ[key] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('indexer', root / 'codex-profile/mac/hooks/graph_skill_index.py')
indexer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(indexer)


def experimental_budget(engine):
    original = engine._build_candidates
    def build(final_scores, keyword_scores, graph_scores, embedding_scores, annotation_scores, semantic_scores, top_k):
        if top_k == 8:
            from graph_tool_call.retrieval.ranking import stable_score_items
            remaining = {'expert': 2, 'skill': 4, 'mcp': 2}
            selected = {}
            for name, score in stable_score_items(final_scores):
                tool = engine._tools.get(name)
                if tool is None or score <= 0:
                    continue
                kind = (tool.metadata or {}).get('kind', 'skill')
                category = 'mcp' if kind in ('mcp', 'mcp-service') else 'expert' if kind == 'expert' else 'skill'
                if remaining[category]:
                    selected[name] = score
                    remaining[category] -= 1
            final_scores = selected
        return original(final_scores, keyword_scores, graph_scores, embedding_scores, annotation_scores, semantic_scores, top_k)
    engine._build_candidates = build


worker = indexer._GraphWorker(Path.home() / '.codex/skill-registry/skills.graph.json')
worker._load_if_stale()
if '--category-budget' in sys.argv:
    for graph in (worker._graph, worker._english_graph):
        experimental_budget(graph._get_retrieval_engine())
primary = {}
parse_errors = []
if '--primary-descriptions' in sys.argv or '--han-first' in sys.argv:
    import yaml
    for name, tool in worker._graph.tools.items():
        if tool.metadata.get('kind') != 'expert':
            continue
        if '--han-first' in sys.argv:
            spans = list(dict.fromkeys(re.findall(r'[\u3400-\u9fff]{2,}', tool.description)))
            if spans:
                primary[name] = ' '.join(spans) + '\n' + tool.metadata.get('skill_name', '')
            continue
        text = Path(tool.metadata['skill_path']).read_text()
        if '[EXPERT_ENTRY_V1: ORIGINAL_ROLE_LOADED]' not in text:
            continue
        match = re.search(r'^---\s*\n([\s\S]*?)\n---', text, re.M)
        if match:
            try:
                description = yaml.safe_load(match[1]).get('description', '')
            except yaml.YAMLError as error:
                parse_errors.append({'name': tool.metadata.get('skill_name'), 'error': type(error).__name__})
                continue
            if isinstance(description, str) and description.strip():
                primary[name] = description.strip()
    print(json.dumps({'primaryDescriptions': len(primary), 'parseErrors': parse_errors}), flush=True)
    # Compare only vector alignment, not a claim of completed retrieval.
    for graph in (worker._graph, worker._english_graph):
        index = graph._get_retrieval_engine()._embedding_index
        provider = index._provider
        vectors = provider.encode_batch(list(primary.values()))
        for name, vector in zip(primary, vectors):
            index.add(name, vector)
queries = [
    '验收JSON格式错误，crossborder分支缺少搜索、执行命令、写文件和任务树写入工具，请修复IDE并测试。',
    '统一几个IDE发行副本的工具配置，修复运行时、输入交接和验收JSON格式错误，并完成集成验证。',
    'Fix the agent IDE tool registration and acceptance JSON bugs, reproduce failing tests then implement and verify integration.',
]
rows = []
for query in queries:
    graph = worker._graph if any('\u3400' <= c <= '\u9fff' for c in query) else worker._english_graph
    engine = graph._get_retrieval_engine()
    index = engine._embedding_index
    hits = index.search(index.encode(query), top_k=len(graph.tools))
    experts = [(name, score) for name, score in hits if graph.tools[name].metadata.get('kind') == 'expert']
    identity = lambda name: graph.tools[name].metadata.get('skill_name', name)
    row = {'query': query, 'expertVectorTop8': [{'name': identity(n), 'score': float(s)} for n, s in experts[:8]],
           'baseline': worker.query({'query': query, 'top_k': 8})}
    print(json.dumps({'query': query, 'expertVectorTop8': row['expertVectorTop8']}, ensure_ascii=False), flush=True)
    rows.append(row)
report = root / ('.reports/expert-han-first-probe.json' if '--han-first' in sys.argv else
    '.reports/expert-primary-description-probe.json' if primary else
    '.reports/expert-category-budget-probe.json' if '--category-budget' in sys.argv else '.reports/expert-category-baseline-probe.json')
report.write_text(json.dumps({'productionChanged': False, 'primaryDescriptions': len(primary), 'parseErrors': parse_errors, 'rows': rows}, ensure_ascii=False, indent=2) + '\n')
