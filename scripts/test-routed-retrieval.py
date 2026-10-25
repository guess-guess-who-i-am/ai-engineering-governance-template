#!/usr/bin/env python3
"""Source-grounded route-identity probes through the deployed worker class."""
import os
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
import hashlib
import importlib.util
import json
from pathlib import Path
import statistics
import time
from graph_tool_call import ToolGraph

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('cases', ROOT / 'scripts/test-chinese-graph-retrieval.py')
cases = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cases)
indexer = cases.indexer
path = ROOT / '.reports/retrieval-candidate/skill-registry/skills.graph.json'
worker = indexer._GraphWorker(path)
baseline = ToolGraph.load(Path.home() / '.codex/skill-registry/skills.graph.json')
indexer._cache_query_interpretation()
rows = []
for split, queries in [('development', cases.CASES), ('paraphrases', cases.HOLDOUT)]:
    for target, en, zh in queries:
        for lang, query in [('en', en), ('zh', zh)]:
            for arm in ('baseline', 'candidate'):
                begun = time.perf_counter()
                results = worker.query({'query': query, 'top_k': 8}) if arm == 'candidate' else indexer.result_records(baseline.retrieve_with_scores(query, top_k=8, max_graph_depth=2))
                names = [r['name'] for r in results]
                rows.append(dict(split=split, target=target, language=lang, arm=arm, query=query,
                    rank=names.index(target) + 1 if target in names else None, names=names,
                    ms=round((time.perf_counter() - begun) * 1000, 3)))
english_engine = worker._english_graph._get_retrieval_engine()
chinese_engine = worker._graph._get_retrieval_engine()
assert english_engine._embedding_index is not chinese_engine._embedding_index
assert english_engine._embedding_index._provider.model_name == 'all-MiniLM-L6-v2'
assert 'multilingual' in chinese_engine._embedding_index._provider.model_name
mcp_queries = [
    ('find_symbol', '按函数符号名称读取函数正文，返回源码路径和范围。'),
    ('get_symbols_overview', '先列出源码文件中有哪些类、函数和方法，了解符号结构。'),
    ('find_referencing_symbols', '找到这个函数的所有引用和调用方，追踪源码消费者。'),
    ('activate_project', '把源码导航切换到当前工作区，按绝对路径激活项目。'),
    ('get_current_config', '检查源码导航当前激活的工作区与项目配置。'),
    ('initial_instructions', '读取Serena代码导航的操作说明，建立会话。'),
    ('search_for_pattern', '不知道符号名，按模式搜索当前项目的源码片段。'),
]
mcp_rows = []
for target, query in mcp_queries:
    results = worker.query({'query': query, 'top_k': 8})
    names = [r['name'] for r in results if r['mcp_server'] == 'serena']
    mcp_rows.append(dict(target=target, query=query, hit=target in names, names=names))
summary = []
for arm in ('baseline', 'candidate'):
    for split in ('development', 'paraphrases'):
        for lang in ('en', 'zh'):
            selected = [r for r in rows if (r['arm'], r['split'], r['language']) == (arm, split, lang)]
            summary.append(dict(arm=arm, split=split, language=lang, n=len(selected),
                top1=sum(r['rank'] == 1 for r in selected),
                top4=sum(r['rank'] is not None and r['rank'] <= 4 for r in selected),
                top8=sum(r['rank'] is not None for r in selected), medianMs=statistics.median(r['ms'] for r in selected)))
report = dict(schema='routed-retrieval-evidence/1', graphSha256=hashlib.sha256(path.read_bytes()).hexdigest(),
    workerSha256=hashlib.sha256((ROOT / 'codex-profile/mac/hooks/graph_skill_index.py').read_bytes()).hexdigest(),
    summary=summary, mcpHits=sum(r['hit'] for r in mcp_rows), mcpTotal=len(mcp_rows), mcpRows=mcp_rows, rows=rows,
    limitations=['hand-labelled governance and Serena identity probes, not general relevance or task accuracy',
                 'same frozen queries used in development; paraphrases are not an independent benchmark',
                 'fixed order and shared caches; latency is not a fair speedup measurement'])
(ROOT / '.reports/routed-retrieval-final.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({k: v for k, v in report.items() if k not in ('rows', 'mcpRows')}, ensure_ascii=False), flush=True)
